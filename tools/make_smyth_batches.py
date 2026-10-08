#!/usr/bin/env python3
"""把 Smyth 教材例句切成待翻译批次。

产出 语料调研/smyth/zh_batches/batch-NN.tsv，每行:
    <序号>\t<希腊语>\t<英文（Smyth 原书译文）>

用法: python3 tools/make_smyth_batches.py [--per-batch 50]
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMYTH = ROOT / "data" / "smyth.json"
OUT = ROOT / "语料调研" / "smyth" / "zh_batches"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-batch", type=int, default=50)
    a = ap.parse_args()

    data = json.loads(SMYTH.read_text(encoding="utf-8"))
    # 只译干净的例句；序号保持原始下标，合并时按下标对齐
    exs = [(i, e) for i, e in enumerate(data["examples"]) if not e.get("bad")]
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("batch-*.tsv"):
        old.unlink()

    total = len(data["examples"])
    n = math.ceil(len(exs) / a.per_batch)
    for b in range(n):
        chunk = exs[b * a.per_batch:(b + 1) * a.per_batch]
        lines = []
        for idx, e in chunk:
            lines.append(f"{idx}\t{e['greek']}\t{e['en'].replace(chr(9), ' ')}")
        (OUT / f"batch-{b:02d}.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"例句共 {total} 条，其中待译 {len(exs)} 条 → {n} 个批次（每批 {a.per_batch} 条）")
    print(f"目录 {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
