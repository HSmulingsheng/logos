#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为古典语料例句切分翻译批次（古希腊语 → 中文）。

产出: data/ex_tr_batches/batch-XXX.json
  [{"k": "noteid:idx", "w": "λόγος", "en": "a word", "zh": "话；言语；道",
    "g": "古希腊语例句", "r": "荷马《伊利亚特》1.1"}, ...]

用法: python3 tools/make_ex_tr_batches.py --size 150
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=150)
    ap.add_argument("--out", default="data/ex_tr_batches")
    a = ap.parse_args()

    words = {str(r["id"]): r for r in json.load(open(DATA / "greek.json", encoding="utf-8"))}
    zh = json.load(open(DATA / "zh.json", encoding="utf-8"))
    classical = json.load(open(DATA / "examples_classical.json", encoding="utf-8"))
    nt = json.load(open(DATA / "examples.json", encoding="utf-8"))

    rows = []
    for wid, exs in classical.items():
        if wid in nt:
            continue  # 已有新约例句（含和合本译文），不会用到古典例句
        w = words.get(wid)
        if not w:
            continue
        for i, e in enumerate(exs):
            g = e.get("greek", "").strip()
            if not g:
                continue
            rows.append({
                "k": f"{wid}:{i}",
                "w": w["word"],
                "en": "；".join(w["senses"][:2]),
                "zh": "；".join(zh.get(wid, [])[:2]),
                "g": g,
                "r": e.get("ref_zh") or e.get("ref", ""),
            })

    outdir = ROOT / a.out
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("batch-*.json"):
        old.unlink()

    n = 0
    for i in range(0, len(rows), a.size):
        n += 1
        (outdir / f"batch-{n:03d}.json").write_text(
            json.dumps(rows[i:i + a.size], ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"待译例句 {len(rows)} 条 -> {n} 个批次（每批 {a.size}）")
    print(f"目录: {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
