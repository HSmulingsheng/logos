#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把待翻译的词条切成批次文件，供子代理并行翻译中文释义。

产出: data/zh_batches/batch-XXX.json
  [{ "id": 123, "w": "λόγος", "pos": "名词", "en": "a word; account", "ex": "太初有道" }, ...]

用法:
  python3 tools/make_zh_batches.py --lessons 1-10 --size 220
  python3 tools/make_zh_batches.py --all --size 220
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

POS_ZH = {
    "noun": "名词", "verb": "动词", "deponent verb": "异相动词", "adjective": "形容词",
    "adj": "形容词", "adverb": "副词", "adv": "副词", "preposition": "介词",
    "conjunction": "连词", "number": "数词", "pronoun": "代词", "particle": "小品词",
    "name": "专名", "proper": "专名", "interrogative": "疑问词",
    "definite article": "定冠词", "article": "冠词",
}


def parse_range(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lessons", default="1-6")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--size", type=int, default=220)
    ap.add_argument("--out", default="data/zh_batches")
    a = ap.parse_args()

    words = json.load(open(DATA / "greek.json", encoding="utf-8"))
    lessons = json.load(open(DATA / "lessons.json", encoding="utf-8"))
    examples = json.load(open(DATA / "examples.json", encoding="utf-8"))

    want: set[int] | None = None
    if not a.all:
        want = set(parse_range(a.lessons))

    lesson_of: dict[int, int] = {}
    for L in lessons:
        if want is not None and L["order"] not in want:
            continue
        for wid in L["ids"]:
            lesson_of[wid] = L["order"]

    rows = []
    for r in words:
        if r["id"] not in lesson_of:
            continue
        ex = examples.get(str(r["id"]), [])
        ctx = ""
        for e in ex:
            if e.get("cuv"):
                ctx = e["cuv"][:40]
                break
        rows.append({
            "id": r["id"],
            "w": r["word"],
            "pos": POS_ZH.get(r["pos"], r["pos"] or ""),
            "en": "；".join(r["senses"][:4])[:120],
            "st": r["strongs"],
            "ex": ctx,
        })

    outdir = ROOT / a.out
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob("batch-*.json"):
        old.unlink()

    n = 0
    for i in range(0, len(rows), a.size):
        chunk = rows[i:i + a.size]
        n += 1
        (outdir / f"batch-{n:03d}.json").write_text(
            json.dumps(chunk, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"词条 {len(rows)} 条 -> {n} 个批次（每批 {a.size}）")
    print(f"目录: {outdir}")
    print(f"批次示例: {outdir / 'batch-001.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
