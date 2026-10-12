#!/usr/bin/env python3
"""
把子代理产出的中文译文合并进阅读数据。

流程
----
    make_reading_zh_batches.py   →  data/zh_reading/batches/*.json  （待译）
    子代理逐批翻译               →  data/zh_reading/out/*.json      （译好）
    merge_reading_zh.py          →  data/zh_reading/merged.json      （汇总 k→zh）
                                  →  app/public/data/reading/*.json  （注入 zh 字段）
                                  →  app/public/data/reading/index.json 补 zhParas 计数

`merged.json` 是关键中间产物：它让「哪些段已经译过」变成可查的事实，
所以重跑批处理时能用 `--skip-done` 跳过，不会重复劳动。

用法
----
    python3 tools/merge_reading_zh.py                # 合并并注入
    python3 tools/merge_reading_zh.py --check        # 只报告进度，不写文件
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path


def para_key(greek: str) -> str:
    """与 make_reading_zh_batches.py 完全一致的键算法（内容哈希）。"""
    t = unicodedata.normalize("NFC", greek)
    t = re.sub(r"\s+", " ", t).strip()
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]

ROOT = Path(__file__).resolve().parent.parent
READING = ROOT / "app/public/data/reading"
ZH = ROOT / "data/zh_reading"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只统计进度，不写文件")
    a = ap.parse_args()

    # 1. 汇总所有批次产出
    merged: dict[str, str] = {}
    bad: list[str] = []
    outdir = ZH / "out"
    files = sorted(outdir.glob("batch-*.json")) if outdir.exists() else []
    for f in files:
        try:
            for item in json.load(open(f, encoding="utf-8")):
                k, zh = item.get("k"), (item.get("zh") or "").strip()
                if k and zh:
                    merged[k] = zh
        except Exception as e:
            bad.append(f"{f.name}: {e}")

    print(f"读入 {len(files)} 个批次文件 · 有效译文 {len(merged):,} 段")
    for b in bad[:5]:
        print(f"  ⚠️ {b}")

    # 2. 统计进度（按作品）
    index = json.load(open(READING / "index.json", encoding="utf-8"))
    print()
    print(f"  {'体裁':<5}{'作品':<18}{'已译/总段':>12}{'进度':>8}")
    for w in sorted(index, key=lambda x: x["genre"]):
        f = READING / (w["id"].replace("/", ".") + ".json")
        if not f.exists():
            continue
        x = json.load(open(f, encoding="utf-8"))
        tot = done = 0
        for ch in x.get("chapters") or []:
            for p in ch.get("paras") or []:
                tot += 1
                if para_key(p.get("g") or "") in merged:
                    done += 1
        bar = "█" * int(done / tot * 10) if tot else ""
        title = w.get("titleZh") or w["title"]
        print(f"  {w['genre']:<5}{title[:16]:<18}{done:>6}/{tot:<6}{done / tot * 100:>7.1f}% {bar}")

    if a.check:
        return 0

    # 3. 写 merged.json（重跑批处理时用来跳过已完成）
    ZH.mkdir(parents=True, exist_ok=True)
    (ZH / "merged.json").write_text(
        json.dumps(merged, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    # 4. 注入到阅读数据
    injected = 0
    for w in index:
        f = READING / (w["id"].replace("/", ".") + ".json")
        if not f.exists():
            continue
        x = json.load(open(f, encoding="utf-8"))
        n = 0
        for ch in x.get("chapters") or []:
            for p in ch.get("paras") or []:
                zh = merged.get(para_key(p.get("g") or ""))
                if zh:
                    p["zh"] = zh
                    n += 1
                else:
                    p.pop("zh", None)      # 清掉可能残留的旧值
        injected += n
        f.write_text(json.dumps(x, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        # 索引里补一个中文段数，前端可据此显示「有中译」
        for meta in index:
            if meta["id"] == w["id"]:
                meta["zhParas"] = n

    (READING / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    print()
    print(f"✅ 已注入 {injected:,} 段中文译文 → {READING.relative_to(ROOT)}")
    print(f"   汇总表 → {(ZH / 'merged.json').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
