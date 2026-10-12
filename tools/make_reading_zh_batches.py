#!/usr/bin/env python3
"""
把古典阅读文本切成翻译批次，供子代理并行翻译成中文。

为什么按「段」而不是按字符切
--------------------------
段落是天然的语义单位，也是界面上的显示单位；跨段切断会毁掉上下文，
译文质量明显下降。每批控制在约 3.5 万字符，既够一个子代理一次处理完，
又能保证它读得到足够的上下文。

产出
----
    data/zh_reading/batches/batch-000.json
        [
          {"k": "tlg0059.tlg001#3#12",     # 作品#章序#段序，唯一键
           "ctx": "柏拉图《申辩篇》· 章 3",  # 给译者定位用
           "g": "古希腊语原文",
           "e": "英译（供参考，不要照抄）"},
          ...
        ]

用法
----
    python3 tools/make_reading_zh_batches.py                 # 全部
    python3 tools/make_reading_zh_batches.py --works 克里同篇,申辩篇
    python3 tools/make_reading_zh_batches.py --size 30000
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path


def para_key(greek: str) -> str:
    """
    段落的键 = **内容哈希**，而不是「作品#章#段」下标。

    下标键很脆：一旦段落切分方式变了（比如把 Perseus 里 9,341 字符的超长段
    按句子切开），后面所有段落下标平移，已译好的内容就对不上、白费。
    用内容哈希则只有**真正被改动的那些段**会失配，其余译文全部保留。
    """
    t = unicodedata.normalize("NFC", greek)
    t = re.sub(r"\s+", " ", t).strip()
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]

ROOT = Path(__file__).resolve().parent.parent
READING = ROOT / "app/public/data/reading"
OUTDIR = ROOT / "data/zh_reading/batches"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=35000, help="每批目标字符数（按希腊语原文计）")
    ap.add_argument("--works", default="", help="只处理这些作品（中文名，逗号分隔）")
    ap.add_argument("--skip-done", action="store_true", help="跳过已翻译的段")
    a = ap.parse_args()

    only = {x.strip() for x in a.works.split(",") if x.strip()}
    index = json.load(open(READING / "index.json", encoding="utf-8"))

    # 已有译文（用于 --skip-done）
    done: set[str] = set()
    merged = ROOT / "data/zh_reading/merged.json"
    if a.skip_done and merged.exists():
        done = set(json.load(open(merged, encoding="utf-8")))

    # 短篇优先：先做完几部**完整**的作品，比摊开半部史诗有用得多。
    # 先数各部作品的段落数，再按从小到大排。
    def para_count(w) -> int:
        f = READING / (w["id"].replace("/", ".") + ".json")
        if not f.exists():
            return 0
        x = json.load(open(f, encoding="utf-8"))
        return sum(len(c.get("paras") or []) for c in x.get("chapters") or [])

    ordered = sorted(index, key=para_count)

    units: list[dict] = []
    for w in ordered:
        title = w.get("titleZh") or w.get("title")
        if only and title not in only:
            continue
        f = READING / (w["id"].replace("/", ".") + ".json")
        if not f.exists():
            continue
        x = json.load(open(f, encoding="utf-8"))
        author = w.get("authorZh") or w.get("author") or ""
        for ci, ch in enumerate(x.get("chapters") or []):
            label = ch.get("label") or f"第 {ci + 1} 章"
            for pi, p in enumerate(ch.get("paras") or []):
                g = (p.get("g") or "").strip()
                if not g:
                    continue
                k = para_key(g)
                if k in done:
                    continue
                units.append({
                    "k": k,
                    "ctx": f"{author}《{title}》· {label}",
                    "g": g,
                    "e": (p.get("e") or "").strip(),
                })

    OUTDIR.mkdir(parents=True, exist_ok=True)
    # ⚠️ 不要清空目录，也不要用序号当文件名。
    #    曾经用 batch-000/001… 编号，一旦用 --skip-done 重建（已译的段被跳过），
    #    编号整体平移，新批次就会**覆盖**先前译好的同名文件——实测把已经 100%
    #    完成的《安提戈涅》《美狄亚》冲成了 0%。
    #    改用「批次内容哈希」命名：文件名只取决于内容，重建多少次都不会撞。
    for old in OUTDIR.glob("batch-*.json"):
        old.unlink()

    batches, cur, size = [], [], 0
    for u in units:
        cur.append(u)
        size += len(u["g"])
        if size >= a.size:
            batches.append(cur)
            cur, size = [], 0
    if cur:
        batches.append(cur)

    names = []
    for b in batches:
        h = hashlib.sha1("".join(u["k"] for u in b).encode("utf-8")).hexdigest()[:10]
        (OUTDIR / f"batch-{h}.json").write_text(
            json.dumps(b, ensure_ascii=False, indent=1), encoding="utf-8")
        names.append(f"batch-{h}.json")

    total_chars = sum(len(u["g"]) for u in units)
    print(f"待翻译 {len(units):,} 段 · 希腊语 {total_chars:,} 字符")
    print(f"切成 {len(batches)} 批（每批约 {a.size:,} 字符）→ {OUTDIR.relative_to(ROOT)}")
    if batches:
        print(f"  首批 {names[0]}（{len(batches[0])} 段） · 末批 {names[-1]}（{len(batches[-1])} 段）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
