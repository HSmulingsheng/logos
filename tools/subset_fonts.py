#!/usr/bin/env python3
"""
Gentium Plus 字体子集化。

为什么做
--------
Gentium Plus 是 SIL 为语言学研究设计的字体，收录了上千个字形，
单个 TTF 就有 949 KB。但本项目实际用到的字符只有几百个：
希腊语（含多音调）、IPA、拉丁字母、常用标点。

首屏加载的 Regular 一档就要 949 KB —— 在慢网络上这比整个 JS 还大。
子集化 + 转 woff2 之后约 100 KB，**省掉约 85%**。

字符集怎么定
------------
**从真实数据里采集**，不凭猜：
  · data/ipa.json            —— 国际音标（含送气上标 ʰ、音节分隔 .）
  · data/greek.json          —— 词表词形
  · data/corpus_nt.json      —— 新约希腊语原文
  · app/public/data/reading  —— 古典文本原文与英译
  · 界面文案（中文由系统字体渲染，这里只取其中的拉丁字母与标点）
再补一组**安全字符**（数字、常用标点、数学符号、希腊字母全表等），
避免以后加文本时缺字。

用法
----
    tools/venvs/font/bin/python tools/subset_fonts.py            # 生成
    tools/venvs/font/bin/python tools/subset_fonts.py --report   # 只报告字符数与预估
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
# 源 TTF 放在 tools/fonts-src/（**不进 public**，否则 Vite 会把 2.9MB 原字体也打进部署包）；
# 子集产物放 app/public/fonts/，只有它会被打包。
SRC = ROOT / "tools/fonts-src"
OUT = APP / "public/fonts"
FACES = ["Regular", "Bold", "Italic"]

# 基础 ASCII + 西欧标点
SAFETY = (
    "".join(chr(c) for c in range(0x20, 0x7F))          # 基本拉丁
    + "".join(chr(c) for c in range(0xA0, 0x100))       # Latin-1 补充
    + "".join(chr(c) for c in range(0x100, 0x180))      # Latin Extended-A（含长音符号）
    + "".join(chr(c) for c in range(0x250, 0x2B0))      # IPA Extensions
    + "".join(chr(c) for c in range(0x2B0, 0x300))      # 修饰字母（送气上标 ʰ 等）
    + "".join(chr(c) for c in range(0x300, 0x370))      # 组合变音符号
    + "".join(chr(c) for c in range(0x370, 0x400))      # 希腊字母
    + "".join(chr(c) for c in range(0x1F00, 0x2000))    # 希腊字母扩展（多音调）
    + "".join(chr(c) for c in range(0x2000, 0x2070))    # 常用标点
    + "·—–…‘’“”«»†‡§¶°±×÷≈≠≤≥∞∅√∑∏∫µ"
)


def collect() -> tuple[set[str], dict[str, int]]:
    """从真实数据里采集字符，返回 (字符集, 各来源计数)"""
    chars: set[str] = set()
    counts: dict[str, int] = {}

    def add(name: str, text: str) -> None:
        before = len(chars)
        chars.update(text)
        counts[name] = len(chars) - before

    # 国际音标
    ipa = json.loads((ROOT / "data/ipa.json").read_text(encoding="utf-8"))
    add("IPA", "".join(ipa.values()))

    # 词表词形（含词条里带的语法标注）
    greek = json.loads((ROOT / "data/greek.json").read_text(encoding="utf-8"))
    add("词表", "".join((r.get("_raw") or {}).get("Greek", "") or "" for r in greek))

    # 新约原文 + 中文（中文不进子集，但顺带统计）
    nt = json.loads((ROOT / "data/corpus_nt.json").read_text(encoding="utf-8"))
    add("新约", "".join(v.get("g", "") for v in nt))
    add("和合本", "".join(v.get("z", "") for v in nt))

    # 古典文本原文与英译
    rd = APP / "public/data/reading"
    parts = []
    for f in sorted(rd.glob("tlg*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for ch in d.get("chapters", []):
            for p in ch.get("paras", []):
                parts.append(p.get("g", "") or "")
                parts.append(p.get("e", "") or "")
    add("古典文本", "".join(parts))

    # 界面文案里的拉丁字符（中文由系统字体渲染，不进子集）
    src = []
    for f in (APP / "src").rglob("*.ts*"):
        src.append(f.read_text(encoding="utf-8", errors="ignore"))
    add("界面文案", "".join(src))

    add("安全字符", SAFETY)
    # 去掉控制字符
    chars = {c for c in chars if c.isprintable() or c == " "}
    return chars, counts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="只报告，不写文件")
    a = ap.parse_args()

    chars, counts = collect()
    print("字符来源（新增数）:")
    for k, v in counts.items():
        print(f"  {k:<12} +{v}")
    print(f"  合计 {len(chars)} 个字符")

    # 只要希腊语/IPA/拉丁相关的，中文等交给系统字体
    keep = {c for c in chars if ord(c) < 0x3000 or 0x1F00 <= ord(c) < 0x2000}
    print(f"  进子集的 {len(keep)} 个（排除 CJK，由系统字体渲染）")

    text = "".join(sorted(keep))
    unicodes = ",".join(f"U+{ord(c):04X}" for c in sorted(keep))

    total_before = total_after = 0
    for face in FACES:
        src = SRC / f"GentiumPlus-{face}.ttf"
        if not src.exists():
            print(f"  ⚠️ 缺少 {src.name}")
            continue
        before = src.stat().st_size
        total_before += before
        if a.report:
            print(f"  {face}: 原 {before/1024:.0f} KB")
            continue
        dst = OUT / f"GentiumPlus-{face}.woff2"
        cmd = [
            sys.executable, "-m", "fontTools.subset", str(src),
            f"--unicodes={unicodes}",
            "--layout-features=*",       # 保留 locl 等排版特性
            "--flavor=woff2",
            "--with-zopfli",
            f"--output-file={dst}",
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ❌ {face} 失败: {r.stderr[-300:]}")
            continue
        after = dst.stat().st_size
        total_after += after
        print(f"  {face}: {before/1024:.0f} KB → {after/1024:.0f} KB  ({after/before*100:.0f}%)")

    if not a.report:
        print(f"  合计 {total_before/1024:.0f} KB → {total_after/1024:.0f} KB"
              f"  （省 {(1-total_after/max(total_before,1))*100:.0f}%）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
