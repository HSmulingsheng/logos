#!/usr/bin/env python3
"""希腊语语料的文本清理。

语料里有几类噪声，既影响显示也影响朗读：

1. **HTML 实体没反转义**：GLAUx 古典语料里有 1,274 条例句带着字面量 ``&quot;``，
   反转义后即可，其中的拉丁字母也就不会再被 eSpeak 念出来。
2. **SBLGNT 校勘符号**：新约正文带 ``⸀⸁⸂⸃`` 等编辑标记（6,600 余处），
   属于校勘记号而非正文。
3. **尾部编辑标记 ``E``**：3,250 条古典例句以孤立的 ``E`` 结尾，
   且 97% 紧跟句末标点（``.`` 2009 处、``·`` 866 处、``;`` 135 处），是标记而非正文。
4. **字模损坏**：极少数例句形如 ``G3ωοῦμεδG6GβοσινG?``，希腊字母被替换成「G+数字」，
   无法修复，应当整条丢弃。

⚠️ **不要用 ``[A-Za-z]`` 一刀切**：希腊大写字母 Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ
与拉丁字母同形，若某份语料把希腊大写编码成了 ASCII，一刀切会把正确的希腊语删掉。

本模块的处理原则：
* 希腊字母按 **Unicode 码位**判定（大写 U+0391–U+03A9、小写 U+03B1–U+03C9、
  带附加符号区 U+1F00–U+1FFF），**绝不**用形近的 ASCII 判断；
* 只删除**已核实过**的具体噪声（校勘符号、尾部 E/G 标记、实体残名）；
* 判断不了的（如中段出现 ASCII），**整条例句丢弃**而不是就地删字符；
* ``assert_greek_caps_intact`` 用于回归校验：清理不得减少希腊大写字母。
"""
from __future__ import annotations

import html
import re

# ---- 码位范围（注意：不要用形近的 ASCII 判断）
#
# 必须按「连续区间」判定，不能用 0x03B1–0x03C9 这种想当然的范围：
#   * 词尾 ς 是 U+03C2（在 0x03B1–0x03C9 之内，没问题）
#   * 但带重音的 ά έ ή ί ό ύ ώ 在 **U+03AC–U+03CE**，落在外面
#   * 大写带重音（Ά Έ Ή Ί Ό Ύ Ώ）在 U+0386、U+0388–U+038A、U+038C、U+038E–U+038F
#   * 多音调形式（ᾳ ῃ ῳ ἀ ἁ …）在 U+1F00–U+1FFF
# 之前把范围写窄，导致「τίμιον」这类正常词被判成非希腊语而误删。
GREEK_UPPER_RANGES = (
    (0x0386, 0x0386), (0x0388, 0x038A), (0x038C, 0x038C), (0x038E, 0x038F),
    (0x0391, 0x03A1), (0x03A3, 0x03A9),
    # 多音调大写：Ἀ Ἁ Ἂ Ἃ … ᾈ ῌ ῼ，分布在扩展区的若干段
    (0x1F08, 0x1F0F), (0x1F18, 0x1F1D), (0x1F28, 0x1F2F), (0x1F38, 0x1F3F),
    (0x1F48, 0x1F4D), (0x1F68, 0x1F6F),
    (0x1FB8, 0x1FBC), (0x1FC8, 0x1FCC), (0x1FD8, 0x1FDC),
    (0x1FE8, 0x1FEC), (0x1FF8, 0x1FFC),
)
GREEK_LOWER_RANGES = (
    (0x03B1, 0x03C9),     # 含词尾 ς U+03C2
    (0x03AC, 0x03CE),     # 带重音的小写
)
GREEK_EXT_RANGES = ((0x1F00, 0x1FFF),)   # 多音调


def _in(ch: str, ranges) -> bool:
    o = ord(ch)
    return any(lo <= o <= hi for lo, hi in ranges)

# 校勘符号、剑标、省略号、修饰符
_APPARATUS = re.compile(r"[\u2E00-\u2E0F\u2020\u2021\u2026\u02B9\u02BC]")
# 编辑用括号（[] 表示存疑，<> 表示增补）
_BRACKETS = re.compile(r"[\[\]{}<>]")
# 编辑标记：语料里只出现过 ASCII 的 E 和 G，且都是独立 token。
# 之所以敢删：已核实本语料的希腊大写全部是 Unicode（Α=U+0391、Ε=U+0395、Γ=U+0393），
# ASCII 的 E/G 不可能是「被编成拉丁的希腊大写」。希腊大写不受影响。
_ASCII_SIGLA = re.compile(r"(?<![A-Za-z])[EG](?![A-Za-z])")
_TRAILING_SIGLA = re.compile(r"(?:[\s.;·:,]*\b[EG]\b)+[\s.;·:,]*$")
# 反转义没做干净时残留的实体名
_ENTITY_LEFTOVER = re.compile(r"\b(?:quot|amp|lt|gt|nbsp|apos|mdash|ndash|hellip|#\d{2,5})\b")
# 字模损坏特征：字母紧挨数字或问号（G3、G6、G?…）
_CORRUPT = re.compile(r"[A-Za-z][\d?]|[\d?][A-Za-z]")
# 被窗口截断而残留的实体碎片，如行尾的 "&qu"
_BROKEN_ENTITY = re.compile(r"&[A-Za-z]{0,6}$")
_WS = re.compile(r"\s+")


def is_greek(ch: str) -> bool:
    """按码位判断是否为希腊字母（含重音与多音调形式）。"""
    return (_in(ch, GREEK_UPPER_RANGES) or _in(ch, GREEK_LOWER_RANGES)
            or _in(ch, GREEK_EXT_RANGES))


def greek_caps(s: str) -> list[str]:
    """希腊大写字母（含带重音的大写）。"""
    return [c for c in s if _in(c, GREEK_UPPER_RANGES)]


def is_corrupt(s: str) -> bool:
    """字模损坏、或希腊字母占比过低 —— 这类整条丢弃，不要就地删字符。"""
    if not s:
        return True
    if _CORRUPT.search(s):
        return True
    greek = sum(1 for c in s if is_greek(c))
    letters = sum(1 for c in s if c.isalpha())
    return letters == 0 or greek < letters * 0.9


def clean_greek(s: str) -> str:
    """去实体、去校勘符号、去尾部编辑标记、归一化空白。

    只处理已核实的噪声；希腊大写字母（Unicode）不受影响。
    """
    if not s:
        return ""
    s = html.unescape(s)
    s = _APPARATUS.sub(" ", s)
    s = _BRACKETS.sub(" ", s)
    s = _ENTITY_LEFTOVER.sub(" ", s)
    s = _TRAILING_SIGLA.sub("", s)
    s = _ASCII_SIGLA.sub(" ", s)
    s = _BROKEN_ENTITY.sub("", s)
    s = re.sub(r"\s+([,.;·:!?])", r"\1", s)
    s = re.sub(r"([,.;·:!?])(?=[^\s])", r"\1 ", s)   # 标点后补空格，便于分词
    return _WS.sub(" ", s).strip(" ,;·").strip()


def assert_greek_caps_intact(before: str, after: str) -> None:
    """回归校验：清理不得弄丢希腊大写字母。"""
    b, a = greek_caps(before), greek_caps(after)
    if len(a) < len(b):
        lost = [c for c in b if c not in a]
        raise AssertionError(f"清理把希腊大写字母弄丢了：{''.join(b)} → {''.join(a)}（丢失 {lost}）")
