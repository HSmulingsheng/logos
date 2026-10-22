#!/usr/bin/env python3
"""
用大语言模型扩写中文释义。

## 现状

`data/index.json` 每条的 `z` 字段是中文义项，**中位只有 5 个字符**
（如 λόγος → ["话"]）。而 LSJ 里 λόγος 有 6 个主要义项：计算、账目、
论说、理性、道……对学习者来说信息量远远不够。

## 为什么必须用 LLM

古希腊语→中文的**专用机器翻译模型不存在**（HuggingFace 上 20 个
"ancient greek" 模型全是 BERT 编码器，没有翻译模型）。只能用大语言模型。

## 输出格式

保持与现有 `z: string[]` **完全兼容**，只是每项更厚、项数更多：

    ["话；言语", "论说；理性（哲学术语）", "账目；计算（LSJ 首义）"]

这样应用端**一行代码都不用改**。

## 用法

    export DEEPSEEK_KEY=sk-...
    python3 tools/expand_zh_gloss.py --limit 20 --out /tmp/sample.json   # 抽样看效果
    python3 tools/expand_zh_gloss.py                                     # 全量（断点续传）
    python3 tools/expand_zh_gloss.py --report                            # 只看进度

结果写 `data/zh-expanded.json`（**不覆盖** index.json）。
应用端读取逻辑见下方的 `--merge` 说明。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 中文释义的**源**是 data/zh.json（{note_id: ["义项", ...]}），
# 由 tools/build_app_data.py 合并进 app/public/data/index.json。
# 直接改 index.json 会在下次构建时被覆盖，所以这里处理的是源文件。
ZH = ROOT / "data" / "zh.json"
GREEK = ROOT / "data" / "greek.json"
LSJ = ROOT / "data" / "lsj.json"
OUT = ROOT / "data" / "zh-expanded.json"

API = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
BATCH = 25            # 每次请求的词数
RETRIES = 4

SYSTEM = """你是古希腊语词典编纂专家，为一部面向中文母语者的古希腊语学习应用撰写释义。

输入是一个 JSON 数组，每个元素含：
  w    古希腊语词形
  z    现有的中文义项（可能很简略）
  s    英文义项
  lsj  LSJ 词典的英文义项（可能为空）
  pos  词性
  fq   在应用语料中的出现次数

请为每个词输出**扩充后的中文义项**。

## 硬性要求（违反任何一条即为不合格）

1. **不许重复**。每条义项必须在语义上**与其它义项有实质区别**。
   反例：οὐ → ["不", "（用于否定句）不", "（用于条件句）不"]（三条同义）
   反例：ὑμεῖς → ["你们", "（宾格）你们"]（限定语不改变词义，等于废话）
2. **不许循环解释**。用同一个词的其它译法解释自己，等于没解释。
3. **宁缺勿滥**。如果原有义项已经准确且覆盖主要用法，就**原样返回**，
   不要为了凑数硬加。只出现一两个义项是完全可以的。
4. 限定语只在**真正改变词的所指或语域**时才加，且必须携带信息：
   ✅（哲学）（《新约》）（法律）（本义）（ὁ αὐτός）同一个
   ❌（宾格）（用于否定句）（系词）是（这些不增加信息）
5. 单条义项不超过 16 个汉字。
6. 用简体中文，术语取学界通行译法（ἀρετή → 德性，λόγος → 逻各斯，ψυχή → 灵魂）。

## 扩充方向（按价值从高到低）

- **先看 LSJ 有没有原释义漏掉的重要义项**——这是最有价值的补充（如 λέγω 的「收集」本义、λόγος 的「账目」）
- 补充该词在**应用语料里常见**的义项（fq 越大越要覆盖全）
- 补充**语法功能**层面的区别，前提是这个区别对理解文句有意义
  （如 ὅς 的「关系代词」用法、ὁ 的「指示代词」用法）

## 输出格式

只输出一个 JSON 对象，形如：
{"结果": [{"i": 输入的下标, "z": ["义项1", "义项2"]}, ...]}
数组长度必须与输入相同，`i` 严格对应。不要 markdown 代码块，不要任何其它文字。
"""



def load_inputs() -> list[dict]:
    zh = json.loads(ZH.read_text(encoding="utf-8")) if ZH.exists() else {}
    greek_rows = json.loads(GREEK.read_text(encoding="utf-8"))
    lsj = json.loads(LSJ.read_text(encoding="utf-8")) if LSJ.exists() else {}
    items = []
    for r in greek_rows:
        raw = r.get("_raw") or {}
        wid = str(r["id"])
        w = raw.get("Greek") or ""
        if not w:
            continue
        z = zh.get(wid) or []
        s = [x for x in (raw.get("Definition") or "").replace("<br>", ";").split(";") if x.strip()]
        pos = raw.get("PartOfSpeech") or ""
        try:
            fq = int(raw.get("Frequency") or 0)
        except (TypeError, ValueError):
            fq = 0
        lsj_txt = ""
        for sec in (lsj.get(wid) or [])[:3]:
            t = (sec.get("t") or "").strip()
            if t:
                lsj_txt += (t[:220] + " ")
        items.append({
            "i": wid, "w": w,
            "z": [x for x in (z if isinstance(z, list) else [z]) if x][:4],
            "s": [x for x in (s if isinstance(s, list) else [s]) if x][:4],
            "pos": pos or "",
            "fq": fq or 0,
            "lsj": lsj_txt.strip()[:500],
        })
    return items


def call(key: str, batch: list[dict]) -> dict[str, list[str]] | None:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": json.dumps(
                [{"w": b["w"], "z": b["z"], "s": b["s"], "lsj": b["lsj"],
                  "pos": b["pos"], "fq": b["fq"]} for b in batch],
                ensure_ascii=False)},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }
    body = json.dumps(payload).encode("utf-8")
    for attempt in range(RETRIES):
        req = urllib.request.Request(API, data=body, headers={
            "content-type": "application/json",
            "authorization": f"Bearer {key}",
        })
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.loads(r.read().decode("utf-8"))
            raw = d["choices"][0]["message"]["content"]
            return parse(raw, batch)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                print(f"  ❌ Key 无效或无权限（HTTP {e.code}）")
                return None
            if e.code == 400 and attempt == 0 and "response_format" in payload:
                payload.pop("response_format")     # 有的模型不认这个参数
                body = json.dumps(payload).encode("utf-8")
                continue
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            time.sleep(2 * (attempt + 1))
        except Exception:                          # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return None


def parse(raw: str, batch: list[dict]) -> dict[str, list[str]] | None:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```")[1]
        if s.startswith("json"):
            s = s[4:]
        s = s.strip()
    try:
        d = json.loads(s)
    except Exception:                              # noqa: BLE001
        a, b = s.find("{"), s.rfind("}")
        if a < 0 or b <= a:
            return None
        try:
            d = json.loads(s[a:b + 1])
        except Exception:                          # noqa: BLE001
            return None
    arr = d.get("结果") or d.get("result") or d.get("data") or []
    out: dict[str, list[str]] = {}
    if isinstance(arr, list):
        for item in arr:
            if not isinstance(item, dict):
                continue
            i = item.get("i")
            z = item.get("z")
            if i is None or not isinstance(z, list):
                continue
            try:
                k = int(i)
            except (TypeError, ValueError):
                continue
            if 0 <= k < len(batch) and z:
                out[batch[k]["i"]] = [str(x).strip() for x in z if str(x).strip()][:5]
    return out or None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个（抽样试看）")
    ap.add_argument("--out", default=str(OUT), help="输出文件")
    ap.add_argument("--report", action="store_true", help="只看进度")
    ap.add_argument("--batch", type=int, default=BATCH)
    a = ap.parse_args()

    items = load_inputs()
    out_path = Path(a.out)
    done: dict[str, list[str]] = {}
    if out_path.exists():
        try:
            done = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:                          # noqa: BLE001
            done = {}

    todo = [x for x in items if x["i"] not in done]
    print(f"  总词数 {len(items)} · 已完成 {len(done)} · 待处理 {len(todo)}")
    if a.report or not todo:
        return 0

    if a.limit:
        todo = todo[:a.limit]
        print(f"  本次处理 {len(todo)} 个（抽样）")

    key = os.environ.get("DEEPSEEK_KEY", "").strip()
    if not key:
        print("  ❌ 没有设置 DEEPSEEK_KEY 环境变量")
        return 2

    ok = fail = 0
    t0 = time.time()
    for n in range(0, len(todo), a.batch):
        chunk = todo[n:n + a.batch]
        got = call(key, chunk)
        if not got:
            fail += len(chunk)
            print(f"  ⚠️ 第 {n // a.batch + 1} 批失败（{len(chunk)} 个）")
            continue
        done.update(got)
        ok += len(got)
        # 每批都落盘：中断后能续
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(done, ensure_ascii=False, indent=0), encoding="utf-8")
        el = time.time() - t0
        rate = ok / max(el, 1e-6)
        left = (len(todo) - ok - fail) / max(rate, 1e-6) / 60
        print(f"  {ok + fail}/{len(todo)} · 成功 {ok} 失败 {fail} · {rate:.1f} 词/秒 · 剩余约 {left:.0f} 分钟")

    print(f"\n完成：成功 {ok} · 失败 {fail} · 累计 {len(done)}/{len(items)} → {out_path}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
