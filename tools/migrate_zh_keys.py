#!/usr/bin/env python3
"""
把「下标键」的译文迁移成「内容哈希键」。

背景
----
早期批次用 `作品#章#段` 当下标键。后来把 Perseus 里 9,341 字符的超长段按句子切开，
段落下标整体平移，已译内容就对不上了。改成内容哈希后，只有**真正被改动的段**
会失配，其余译文全部保住。

本脚本靠**旧批次的备份**建立「下标键 → 原文」的映射，从而算出哈希键。
所以迁移前必须留有旧批次：

    cp -R data/zh_reading/batches /tmp/batches-idx     # 切分方式变更之前做

用法
----
    python3 tools/migrate_zh_keys.py --old-batches /tmp/batches-idx
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/zh_reading/out"


def para_key(greek: str) -> str:
    t = unicodedata.normalize("NFC", greek)
    t = re.sub(r"\s+", " ", t).strip()
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-batches", required=True, help="切分变更前的批次目录")
    a = ap.parse_args()

    idx2hash: dict[str, str] = {}
    for f in glob.glob(str(Path(a.old_batches) / "*.json")):
        for u in json.load(open(f, encoding="utf-8")):
            idx2hash[u["k"]] = para_key(u["g"])
    print(f"旧批次：建立 {len(idx2hash):,} 个「下标键 → 哈希键」映射")

    OUT.mkdir(parents=True, exist_ok=True)
    converted = already = lost = 0
    for f in sorted(OUT.glob("*.json")):
        out, changed = [], False
        for item in json.load(open(f, encoding="utf-8")):
            k, zh = item.get("k", ""), item.get("zh", "")
            if "#" in k:                       # 下标键 → 转哈希
                h = idx2hash.get(k)
                if h:
                    out.append({"k": h, "zh": zh}); converted += 1; changed = True
                else:
                    lost += 1
            else:                              # 已是哈希键
                out.append({"k": k, "zh": zh}); already += 1
        if changed:
            f.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"✅ 转换 {converted} 段 · 已是哈希键 {already} 段 · 无法映射 {lost} 段")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
