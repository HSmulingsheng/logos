#!/usr/bin/env python3
"""合并 Smyth 教材例句的中文译文，并严格校验序号对齐。

用法: python3 tools/merge_smyth_zh.py [--check]

校验：
  1. 每个输入批次的序号集合与输出批次完全一致（错位会静默产出错误译文，必须挡住）
  2. 译文非空、不含拉丁字母、不是英文原文的照搬
  3. 覆盖率：所有未标记 bad 的例句都要有译文
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMYTH = ROOT / "data" / "smyth.json"
BATCH = ROOT / "语料调研" / "smyth" / "zh_batches"

CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")


def read_tsv(path: Path) -> list[tuple[str, str]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        rows.append((parts[0].strip(), parts[1].strip()))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写入")
    a = ap.parse_args()

    data = json.loads(SMYTH.read_text(encoding="utf-8"))
    exs = data["examples"]

    problems: list[str] = []
    zh: dict[int, str] = {}

    for inp in sorted(BATCH.glob("batch-*.tsv")):
        if inp.name.endswith(".out.tsv"):
            continue
        out = inp.with_name(inp.stem + ".out.tsv")
        if not out.exists():
            problems.append(f"{inp.name}: 缺少输出文件")
            continue

        want = [i for i, _ in read_tsv(inp)]
        rows = read_tsv(out)
        got = [i for i, _ in rows]

        if set(want) != set(got):
            missing = sorted(set(want) - set(got))
            extra = sorted(set(got) - set(want))
            problems.append(f"{out.name}: 序号不匹配（缺 {missing[:5]}，多 {extra[:5]}）")
            continue
        if len(got) != len(set(got)):
            problems.append(f"{out.name}: 序号有重复")
            continue
        if want != got:
            problems.append(f"{out.name}: 序号顺序与输入不一致")

        for i, text in rows:
            idx = int(i)
            if not text:
                problems.append(f"{out.name} #{idx}: 译文为空")
                continue
            if not CJK.search(text):
                problems.append(f"{out.name} #{idx}: 译文里没有汉字 → {text[:40]}")
                continue
            if LATIN.search(text):
                problems.append(f"{out.name} #{idx}: 译文混入拉丁字母 → {text[:40]}")
            src = exs[idx]["en"] if idx < len(exs) else ""
            if src and text.strip().lower() == src.strip().lower():
                problems.append(f"{out.name} #{idx}: 译文与英文原文相同")
                continue
            zh[idx] = text

    missing = [i for i, e in enumerate(exs) if not e.get("bad") and i not in zh]
    if missing:
        problems.append(f"有 {len(missing)} 条干净例句没有译文，例如 {missing[:8]}")

    print(f"例句总数 {len(exs)}（bad {sum(1 for e in exs if e.get('bad'))}）")
    print(f"已获得译文 {len(zh)} 条，覆盖率 {len(zh) * 100 // max(len(exs), 1)}%")

    if problems:
        print(f"\n❌ {len(problems)} 个问题：")
        for p in problems[:20]:
            print("  · " + p)
        return 1

    print("✅ 序号对齐、译文非空、无拉丁字母混入")

    if not a.check:
        for i, e in enumerate(exs):
            if i in zh:
                e["zh"] = zh[i]
        SMYTH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")
        print(f"已合并写入 {SMYTH}  ({SMYTH.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
