#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并古典例句中文翻译为 data/zh_examples.json，并做完整性校验。"""
from __future__ import annotations

import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main() -> int:
    src = DATA / "ex_tr_batches"
    out = DATA / "ex_tr_out"
    if not src.exists():
        print("没有待译批次")
        return 1

    zh: dict[str, str] = {}
    total_in = total_out = 0
    problems: list[str] = []
    missing_batches: list[str] = []

    for bp in sorted(glob.glob(str(src / "batch-*.json"))):
        name = Path(bp).stem
        inb = json.load(open(bp, encoding="utf-8"))
        total_in += len(inb)
        op = out / f"{name}.json"
        if not op.exists():
            missing_batches.append(name)
            continue
        try:
            got = json.load(open(op, encoding="utf-8"))["translations"]
        except Exception as e:
            problems.append(f"{name}: 解析失败 {e}")
            continue
        total_out += len(got)
        keys_in = [x["k"] for x in inb]
        keys_out = [x["k"] for x in got]
        if keys_in != keys_out:
            bad = len(set(keys_in) ^ set(keys_out))
            problems.append(f"{name}: k 序列不一致（差异 {bad}）")
        for x in got:
            t = (x.get("zh") or "").strip()
            if t:
                zh[x["k"]] = t

    (DATA / "zh_examples.json").write_text(
        json.dumps(zh, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(f"批次输入 {total_in} / 输出 {total_out}，合并 {len(zh)} 条")
    if missing_batches:
        print(f"缺输出批次 {len(missing_batches)} 个: {missing_batches[:12]}{' …' if len(missing_batches) > 12 else ''}")
    if problems:
        print("问题：")
        for p in problems[:15]:
            print("  -", p)
    if not problems and not missing_batches:
        print("无问题")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
