#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并各批中文释义为 data/zh.json，并做完整性校验。"""
from __future__ import annotations

import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

PAIRS = [
    (DATA / "zh_batches_1-6", DATA / "zh_out_1-6"),
    (DATA / "zh_batches", DATA / "zh_out"),
]


def main() -> int:
    zh: dict[str, list[str]] = {}
    total_in = total_out = 0
    problems: list[str] = []

    for bdir, odir in PAIRS:
        if not bdir.exists():
            continue
        for bp in sorted(glob.glob(str(bdir / "batch-*.json"))):
            name = Path(bp).stem
            op = odir / f"{name}.json"
            inb = json.load(open(bp, encoding="utf-8"))
            total_in += len(inb)
            if not op.exists():
                problems.append(f"{bdir.name}/{name}: 缺输出")
                continue
            out = json.load(open(op, encoding="utf-8"))["glosses"]
            total_out += len(out)
            ids_in = [x["id"] for x in inb]
            ids_out = [x["id"] for x in out]
            if ids_in != ids_out:
                problems.append(f"{bdir.name}/{name}: id 序列不一致")
            empty = 0
            for x in out:
                g = [t.strip() for t in x.get("zh", []) if t and t.strip()]
                if not g:
                    empty += 1
                    continue
                zh[str(x["id"])] = g
            if empty:
                problems.append(f"{bdir.name}/{name}: {empty} 条空释义")

    (DATA / "zh.json").write_text(
        json.dumps(zh, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    words = json.load(open(DATA / "greek.json", encoding="utf-8"))
    ids = {str(w["id"]) for w in words}
    covered = len(ids & set(zh))
    print(f"批次输入 {total_in} / 输出 {total_out}")
    print(f"zh.json 收录 {len(zh)} 条，覆盖词条 {covered}/{len(ids)} ({covered / len(ids) * 100:.1f}%)")
    if problems:
        print("问题：")
        for p in problems[:30]:
            print("  -", p)
    else:
        print("无问题")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
