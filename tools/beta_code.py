#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Beta Code → 希腊语 Unicode 转换。

**为什么自己写**：CLTK 的 `BetaCodeReplacer` 在当前 Python 上会崩——
`cltk/alphabet/grc/beta_to_unicode.py:134` 里 `for (beta_regex, repl) in pattern`
报 `TypeError: '_UnionGenericAlias' object is not iterable`（类型注解写错，
新版 Python 直接求值了）。映射本身是确定且公开的，重写比绕开更快。

为什么需要它
------------
Perseus 的 LSJ XML 里，`<orth lang="greek">` 的内容**其实不是希腊语字母，
而是 Beta Code**（如 `e)\\ yilo/n` = ἔ ψιλόν，`lo/gos` = λόγος）。
要拿 LSJ 的释义去对牌组的希腊语词条，就得先把 key 转成希腊语。

映射规则（TLG / Perseus 通用）
    a b g d e z h q i k l m n c o p r s t u f x y w
    α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω
    * 前缀 = 大写
    / = 尖音  \\ = 抑音  = = 扬抑音（长音）
    ( = 粗气  ) = 柔气  + = 分音  | = 下附 ι
    其它（' ^ _ 数字）为韵律或编号标记，丢弃

实现要点：先输出**组合字符**（U+0314 粗气、U+0301 尖音…），
最后统一 NFC 归一化成预组合的希腊语字母——这样才能得到 ᾳ ἕ ῷ 这类字符。
"""
from __future__ import annotations

import re
import unicodedata

# 字母
LETTERS = {
    "a": "α", "b": "β", "g": "γ", "d": "δ", "e": "ε", "z": "ζ", "h": "η",
    "q": "θ", "i": "ι", "k": "κ", "l": "λ", "m": "μ", "n": "ν", "c": "ξ",
    "o": "ο", "p": "π", "r": "ρ", "s": "σ", "t": "τ", "u": "υ", "f": "φ",
    "x": "χ", "y": "ψ", "w": "ω",
}

# 附标 → 组合字符
MARKS = {
    "/": "\u0301",   # 尖音
    "\\": "\u0300",  # 抑音
    "=": "\u0342",   # 扬抑音
    "(": "\u0314",   # 粗气
    ")": "\u0313",   # 柔气
    "+": "\u0308",   # 分音
    "|": "\u0345",   # 下附 ι
}

# 丢弃的标记：韵律符号、编号、括号、角括号。
# ⚠️ **不能丢空格与 , ; .**——LSJ 正文里的希腊语是**短语**（`a)qana/twn te qew=n`），
#    丢掉空格会粘成 `ἀθανάτωντεθεῶν`。词头里的标点由 clean_headword 另行清理。
DROP = set("'^_!?0123456789[]{}<>«»*·\t\n\r")

# 需要特殊处理的 σ：词尾写作 ς
_ACUTE = "\u0301"


def beta_to_unicode(beta: str) -> str:
    """
    把 Beta Code 转成希腊语 Unicode；无法识别的字符原样保留。
    """
    s = beta.strip()
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "*":                       # 大写标记
            # 附标可能夹在 `*` 与字母之间（Perseus 写 *)/ilias 这种），先收着
            j = i + 1
            pending: list[str] = []
            while j < n and s[j] in MARKS:
                pending.append(MARKS[s[j]]); j += 1
            if j < n and s[j].lower() in LETTERS:
                base = LETTERS[s[j].lower()].upper()
                out.append(base)
                out.extend(pending)
                j += 1
                while j < n and s[j] in MARKS:
                    out.append(MARKS[s[j]]); j += 1
                i = j
                continue
            out.append("*"); i += 1
            continue
        low = c.lower()
        if low in LETTERS:
            base = LETTERS[low]
            if c.isupper():
                base = base.upper()
            out.append(base)
            i += 1
            # 收集紧随的附标
            while i < n and s[i] in MARKS:
                out.append(MARKS[s[i]]); i += 1
            continue
        if c in MARKS:                     # 落单的附标，挂到上一个字符
            out.append(MARKS[c]); i += 1; continue
        if c in DROP:
            i += 1; continue
        out.append(c); i += 1

    text = unicodedata.normalize("NFC", "".join(out))
    # 词尾 σ → ς（重音等已由 NFC 处理，这里只看最后一个字母）
    if text.endswith("σ"):
        text = text[:-1] + "ς"
    return text


def fold(greek: str) -> str:
    """
    折叠成匹配用的键：去附标、小写、ς→σ、末尾 * 与数字去掉。
    与前端 `foldGreek()` 的口径保持一致。
    """
    s = unicodedata.normalize("NFD", greek).lower()
    s = s.replace("ς", "σ")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip()


if __name__ == "__main__":
    cases = [
        ("lo/gos", "λόγος"), ("a)/nqrwpos", "ἄνθρωπος"), ("mh=nis", "μῆνις"),
        ("qeo/s", "θεός"), ("sofi/a", "σοφία"), ("e)n", "ἐν"), ("ou)=s", "οὖς"),
        ("a)nqrw/pou", "ἀνθρώπου"), ("po/lis", "πόλις"), ("a)gaqo/s", "ἀγαθός"),
        ("*)/ilias", "Ἴλιας"), ("*i(/lios", "Ἴλιος"), ("basileu/s", "βασιλεύς"), ("dh=mos", "δῆμος"),
    ]
    ok = bad = 0
    for beta, want in cases:
        got = beta_to_unicode(beta)
        good = got == want or fold(got) == fold(want)
        ok, bad = (ok + 1, bad) if good else (ok, bad + 1)
        print(f"{'✅' if good else '❌'} {beta:<14} -> {got:<16} 期望 {want}")
    print(f"\n{ok} 通过 / {bad} 失败")
