#!/usr/bin/env python3
# 用法：把下面 ZH 列表按顺序填好（数量 == 索引区间长度），运行本脚本即写出 chunk JSON。
import json, sys

START = int(sys.argv[1])   # 起始索引（含）
END = int(sys.argv[2])     # 结束索引（不含）
OUT = sys.argv[3]

SRC = "data/zh_reading/batches/batch-e3b8918813.json"

# ==== 在这里填入译文，按索引顺序，每项一个字符串 ====
ZH = [
]
# ==================================================

items = json.load(open(SRC, encoding="utf-8"))[START:END]
if len(ZH) != len(items):
    sys.exit(f"长度不符: ZH={len(ZH)} 应为 {len(items)} (索引 {START}..{END})")
out = [{"k": it["k"], "zh": zh} for it, zh in zip(items, ZH)]
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT, len(out))
