#!/usr/bin/env python3
"""
为词表生成国际音标（IPA）。

用 CLTK 的 `cltk.phonology.grc.transcription.Transcriber`，
重建方案是 **Probert (2010)**（*A Companion to the Ancient Greek Language*）的
**古典阿提卡（Attic）** 读音。它是学术界的通行做法，且已处理好这些细节：

  - 气号：粗气号 → h（ὁ → [ho]）
  - 高调位置：重音/扬抑符 → IPA 声调符号（λόγος → [ló.gos]、πρᾶγμα → [prɑ̂ŋ.mɑ]）
  - 连读音变：r 清化、s 浊化、鼻音同化（ἄγγελος → [ɑ́ŋ.ge.los]）
  - 音节切分（用 `.` 分隔）
  - ζ = [zd]、θ = [tʰ]、υ = [y]、η = [ɛː]、ω = [ɔː] 等阿提卡特征

自己写规则也能覆盖，但发音重建是有学术争议的领域，用成熟实现更稳妥。

输出 data/ipa.json：`{ "词条id": "ló.gos", ... }`（**不含方括号**，由界面按需添加）。
build_app_data.py 只读取这个文件，因此重建数据不需要装 CLTK。

用法（CLTK 会在 HOME 下建数据目录，沙箱环境需重定向 HOME）：
    HOME=$PWD/.cltk-home tools/venvs/grc-ipa/bin/python tools/build_ipa.py
    ... --check          # 只统计覆盖率，不写文件
    ... --sample 30      # 顺便打印 30 个样例
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GREEK = ROOT / "data/greek.json"
OUT = ROOT / "data/ipa.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只统计，不写文件")
    ap.add_argument("--sample", type=int, default=12, help="打印样例条数")
    a = ap.parse_args()

    import warnings
    warnings.filterwarnings("ignore")
    from cltk.phonology.grc.transcription import Transcriber

    tr = Transcriber("Attic", "Probert")
    rows = json.load(open(GREEK, encoding="utf-8"))

    out: dict[str, str] = {}
    failed: list[tuple[str, str]] = []
    for r in rows:
        wid = str(r["id"])
        raw_word = ((r.get("_raw") or {}).get("Greek") or "").strip()
        # 词条里有些是「介词 + 格标注」的写法（如 `ἐπί [+acc]`、`διά [+gen]`），
        # 方括号是语法说明不是词的一部分，转写前必须剥掉，否则音标里会混进 "[+ acc"。
        word = re.sub(r"\[[^\]]*\]", "", raw_word).strip()
        if not word:
            failed.append((wid, "(无词形)"))
            continue
        try:
            ipa = tr.transcribe(word)
            # CLTK 返回带方括号的串；也可能一次返回多个词（词条里偶有空格）
            ipa = ipa.strip()
            if ipa.startswith("[") and ipa.endswith("]"):
                ipa = ipa[1:-1]
            ipa = ipa.strip()
            if not ipa:
                failed.append((wid, word))
                continue
            out[wid] = ipa
        except Exception as e:                       # 单个词失败不该中断整批
            failed.append((wid, f"{raw_word} ({type(e).__name__})"))

    total = len(rows)
    print(f"生成 {len(out)} / {total}  （{len(out)/total*100:.2f}%）")
    if failed:
        print(f"未生成 {len(failed)} 个，前 10：")
        for wid, why in failed[:10]:
            print(f"  {wid}  {why}")

    if a.sample:
        print(f"\n样例（{a.sample} 个）：")
        by_id = {str(r["id"]): (r.get("_raw") or {}).get("Greek", "") for r in rows}
        for wid in list(out)[: a.sample]:
            print(f"  {by_id.get(wid,''):<16} [{out[wid]}]")

    if a.check:
        print("\n（--check 模式，未写文件）")
        return 0
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, sort_keys=True)
    print(f"\n已写入 {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
