#!/usr/bin/env python3
"""导出 iOS / macOS 系统自带的拉丁→希腊转写结果，作为实现时的对照基准。

应用里的输入转写要对齐「iOS 希腊语输入法」，但 Apple 并没有公开映射表。
与其凭印象写规则，不如**直接调用系统实现**把真实输出跑出来：

    CoreFoundation 的 CFStringTransform + kCFStringTransformLatinGreek（值即 "Latin-Greek"）

这是 iOS/macOS 上 `StringTransform.latinToGreek` 的同一套底层规则，
所以它的输出就是「iOS 会打出什么」的权威答案。

用法:
    python3 tools/apple_translit_ref.py            # 打印一批词的真实输出
    python3 tools/apple_translit_ref.py --json out.json

注意：只能在 macOS 上跑（依赖 CoreFoundation）。
`app/scripts/translit-test.ts` 里内嵌的那 143 条参考数据就是这么生成的；
换词表重跑后，把输出贴回那个文件即可。
"""
from __future__ import annotations

import ctypes
import json
import sys

CF = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
kUTF8 = 0x08000100

_cf = ctypes.CDLL(CF)
for _name, _restype, _argtypes in [
    ("CFStringCreateWithCString", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]),
    ("CFStringCreateMutableCopy", ctypes.c_void_p, [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p]),
    ("CFStringTransform", ctypes.c_bool, [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_bool]),
    ("CFStringGetCString", ctypes.c_bool, [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]),
]:
    getattr(_cf, _name).restype = _restype
    getattr(_cf, _name).argtypes = _argtypes


def latin_to_greek(s: str) -> str:
    """调用系统转写：拉丁 → 希腊（与 iOS 的 StringTransform.latinToGreek 同源）。"""
    src = _cf.CFStringCreateWithCString(None, s.encode("utf-8"), kUTF8)
    mut = _cf.CFStringCreateMutableCopy(None, 0, src)
    tr = _cf.CFStringCreateWithCString(None, b"Latin-Greek", kUTF8)
    _cf.CFStringTransform(mut, None, tr, False)
    buf = ctypes.create_string_buffer(4096)
    _cf.CFStringGetCString(mut, buf, 4096, kUTF8)
    return buf.value.decode("utf-8")


# 覆盖各类规则：气号、长短元音、双字母、词尾 ς、大写、下加字母
WORDS = """logos anthropos theos pater meter psyche philosophia christos onoma histor oida zoe
eirene adelphos angelos basileia doxa ekklesia pistis charis nomos soma logou basileus
polemos nyx hemera ouranos sophia kardia kosmos agape elpis dynamis ergon
phone kephale cheir pous ophthalmos stoma sarx pneuma nekros zao
grapho lego lysis poiesis protos deuteros tritos tetartos pemptos ekatos chilioi
mega mikros kalos kakos agathos dikaios alethinos hagios hieron prophetes apostolos
mathitis didaskalos kyrios patris huios thygater
thauma theoria praxis ethos pathos krisis gnosis time arete techne physis
Italien Hellas Athena Apollon Zeus Hera Poseidon Hermes Artemis
Achilleus Hektor Odysseus Penelope Agamemnon Menelaos Alexandros Philippos
Sokrates Platon Aristoteles Thoukydides Herodotos Xenophon Euripides Sophokles
Biblion gramma stoicheion syllabe lexis mythos ainos ainigma
houtos ekeinos toioutos posos tosos hosos hekastos allos heteros
poieo lambano echo legomen graphomen didomi histemi tithemi""".split()


def main() -> None:
    pairs = [[w, latin_to_greek(w)] for w in WORDS]
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(pairs, f, ensure_ascii=False, indent=0)
        print(f"已写出 {len(pairs)} 条 → {out}")
    else:
        for w, g in pairs:
            print(f"  {w:<16} → {g}")


if __name__ == "__main__":
    main()
