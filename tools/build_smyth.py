#!/usr/bin/env python3
"""把 Smyth《A Greek Grammar for Colleges》(1920, 公有领域) 的 TEI XML
拆成结构化的小节与例句，供语法板块查阅与出题。

用法:
    python3 tools/build_smyth.py [--report]

产出 data/smyth.json:
    {"sections": [...], "examples": [...]}

来源与许可：
    底本 Smyth, A Greek Grammar for Colleges, American Book Company, 1920 —— 公有领域。
    TEI 数字版来自 neelsmith/smyth（依 Perseus 开放 XML 重编）。
    希腊语原文为 Beta Code，转换使用 MIT 许可的 beta-code（.tools/py）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent
sys.path.insert(0, str(WORKSPACE / ".tools" / "py"))

from lxml import etree  # noqa: E402
import beta_code  # noqa: E402

XML = ROOT / "语料调研" / "smyth" / "smyth-HEAD" / "editions" / "Smyth-1920.xml"
DATA = ROOT / "data"

DIACRITIC = set("/\\()=|+*'`^~")
BETA_TOKEN = re.compile(r"^[a-zA-Z*()/\\|=+'_^~]+$")
PUNCT_ONLY = re.compile(r"^[.,;:·!?—–\-()\[\]{}<>«»\"'‘’“”]+$")
STOPWORDS = {
    "a", "an", "as", "at", "be", "by", "do", "he", "if", "in", "is", "it",
    "me", "my", "no", "of", "on", "or", "so", "to", "up", "us", "we",
    "the", "and", "not", "but", "for", "his", "her", "him", "they", "them",
    "was", "were", "are", "had", "has", "have", "with", "that", "this",
}


def fold(s: str) -> str:
    d = unicodedata.normalize("NFD", s)
    d = "".join(c for c in d if not unicodedata.combining(c))
    return unicodedata.normalize("NFC", d).lower().replace("ς", "σ")


def beta_to_greek(s: str) -> str:
    """Beta Code → Unicode。

    `_` 是 Perseus 数字版的转义噪声（ta\\_s 实为 τὰς），先去掉。
    """
    out = beta_code.beta_code_to_greek(s.replace("_", ""))
    # beta_code 不处理词尾 sigma，补上：词末的 σ 写成 ς
    return re.sub(r"σ\b", "ς", out)


def load_folded_forms() -> set[str]:
    """全部已知识别词形的折叠集合，用来判断一个 ASCII token 是不是希腊语。"""
    forms = json.loads((DATA / "forms.json").read_text(encoding="utf-8"))
    return {fold(f["form"]) for v in forms.values() for f in v if f.get("form")}


def is_greek_token(tok: str, folded: set[str]) -> bool:
    core = tok.strip(".,;:!?·()[]{}<>«»—–\"'‘’“”")
    if len(core) < 2 or core.lower() in STOPWORDS:
        return False
    if any(c in DIACRITIC for c in core):
        return True
    if not BETA_TOKEN.match(core):
        return False
    # 没有附加符号的词（tina / kai）用词形表验证，避免把英文当希腊语
    return fold(beta_to_greek(core)) in folded


def split_quote(raw: str, folded: set[str]) -> tuple[str, str] | None:
    """把 <quote> 的内容切成（希腊语, 译文）。希腊语一定在前面。"""
    toks = raw.split()
    if not toks:
        return None
    greek: list[str] = []
    i = 0
    while i < len(toks):
        tok = toks[i]
        if is_greek_token(tok, folded):
            greek.append(tok)
        elif PUNCT_ONLY.match(tok):
            if greek:
                greek.append(tok)
        else:
            break
        i += 1
    if not greek:
        return None
    return " ".join(greek), " ".join(toks[i:])


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" .;,—-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--out", default="data/smyth.json")
    a = ap.parse_args()

    if not XML.exists():
        print(f"找不到 {XML}", file=sys.stderr)
        return 1

    folded = load_folded_forms()
    root = etree.parse(str(XML)).getroot()

    def text_of(el) -> str:
        return re.sub(r"\s+", " ", "".join(el.itertext())).strip()

    sections, examples = [], []
    seen = set()
    dropped = 0

    for pdiv in root.findall('.//div[@type="smythp"]'):
        n = pdiv.get("n")
        if not n or not n.isdigit():
            continue
        num = int(n)
        head = pdiv.find("head")
        title = text_of(head) if head is not None else ""

        part = chapter = group = ""
        anc = pdiv.getparent()
        while anc is not None:
            t = anc.get("type")
            h = anc.find("head")
            label = text_of(h) if h is not None else ""
            if t == "Section":
                group = label
            elif t == "Chapter":
                chapter = label
            elif t == "Part":
                part = label
            anc = anc.getparent()

        body = text_of(pdiv)
        sections.append({
            "n": num, "part": part, "chapter": chapter,
            "group": group, "title": title, "en": body[:2000],
        })

        for cit in pdiv.iter("cit"):
            q = cit.find("quote")
            if q is None:
                continue
            raw = text_of(q)
            if not raw:
                continue
            got = split_quote(raw, folded)
            if not got:
                dropped += 1
                continue
            grc_raw, trans = got
            if not (6 <= len(grc_raw) <= 160):
                dropped += 1
                continue
            greek = beta_to_greek(grc_raw).strip(" .,;:")
            if len(greek.split()) < 2:
                dropped += 1
                continue
            bibl = cit.find("bibl")
            key = (greek, num)
            if key in seen:
                continue
            seen.add(key)
            # 转换后若还残留 ASCII 字母或 Beta Code 符号，说明原始 XML 本身有讹误
            # （内嵌 <quote lang="greek"> 边界、源文本脱字等）。这类例句不能进题库，
            # 但保留在数据里并打标记，避免序号漂移。
            bad = bool(re.search(r"[a-zA-Z/\\()|=+*]", greek))
            en = clean(trans)[:200]
            # Smyth 的英文栏里混进了 Beta Code（如 "w) th e)kei/nwn"），这种译文不可读，
            # 直接丢掉 —— 宁可不显示英文，也不要显示乱码
            if re.search(r"[A-Za-z][)\\/|]|[)\\/|][A-Za-z]", en):
                en = ""
            examples.append({
                "n": num,
                "greek": greek,
                "en": en,
                "src": clean(text_of(bibl))[:40] if bibl is not None else "",
                "bad": bad,
            })

    # ---- 把例句归属到课程单元，并为每条挑一个「可解析且无歧义」的目标词
    # 课程单元 ↔ Smyth 小节区间（中文标签由我们加，便于中文读者定位）
    UNITS: dict[str, tuple[str, list[tuple[int, int, str]]]] = {
        "letters": ("字母与书写", [
            (1, 3, "字母表"), (4, 8, "元音与双元音"), (9, 14, "气号（送气 / 不送气）"),
            (15, 22, "辅音"), (133, 133, "词尾辅音与词尾 ς"), (149, 178, "重音通则"),
            (179, 187, "前附词与后附词"),
        ]),
        "article": ("定冠词 ὁ ἡ τό", [
            (1118, 1121, "冠词的基本用法"), (1122, 1124, "类指用法"),
            (1150, 1152, "冠词与述语名词"), (1154, 1189, "冠词的位置（定语位）"),
        ]),
        "noun1": ("第一变格", [(211, 227, "第一变格（-α / -η 词干）")]),
        "noun2": ("第二变格", [(228, 236, "第二变格（-ο 词干）")]),
        "noun3": ("第三变格", [(237, 239, "阿提卡变格"), (240, 285, "第三变格与不规则变格")]),
        "adj": ("形容词", [(286, 312, "形容词变格"), (313, 324, "形容词的比较级")]),
        "pron": ("代词", [
            (325, 340, "代词的变格"), (1190, 1203, "人称与物主代词"),
        ]),
        "verb": ("动词", [
            (355, 495, "动词变位总表"), (496, 700, "动词词干与时态词干"),
            (1703, 1800, "语态"), (1966, 2038, "动词性名词（不定式）"),
        ]),
        "dep": ("异相动词", [(355, 495, "动词变位总表（异相动词的形式）")]),
        "endings": ("格与数", [
            (194, 204, "变格总论"), (1279, 1400, "格的用法"),
        ]),
    }

    # 折叠词形 → [(note_id, gram)]
    forms = json.loads((DATA / "forms.json").read_text(encoding="utf-8"))
    form_index: dict[str, list[tuple[str, str]]] = {}
    for wid, flist in forms.items():
        for f in flist:
            if not f.get("form"):
                continue
            form_index.setdefault(fold(f["form"]), []).append((wid, f.get("gram", "")))

    TOKEN = re.compile(r"[^\s.,;·:!?()\[\]«»—–]+")

    def target_of(greek: str):
        """挑一个目标词：能解析、语法标签唯一、且同词条词形足够多（好出干扰项）"""
        best = None
        for tok in TOKEN.findall(greek):
            key = fold(tok)
            cands = form_index.get(key)
            if not cands:
                continue
            wids = {w for w, _ in cands}
            if len(wids) != 1:
                continue                     # 同形不同词，歧义
            wid = wids.pop()
            grams = {g for _, g in cands if g}
            if len(grams) != 1:
                continue                     # 同形不同语法分析，歧义
            flist = forms.get(wid, [])
            distinct = [(f["form"], f.get("gram", "")) for f in flist if f.get("form") and f.get("gram")]
            # 去重后至少 4 个形式，才能凑出 4 个选项
            uniq = []
            seenf = set()
            for fm, gr in distinct:
                if fm in seenf:
                    continue
                seenf.add(fm)
                uniq.append([fm, gr])
            if len(uniq) < 4:
                continue
            score = len(tok) + (2 if any(c in DIACRITIC for c in tok) else 0)
            if best is None or score > best[0]:
                best = (score, {"form": tok.strip(".,;:·"), "gram": grams.pop(), "wid": wid, "tf": uniq[:12]})
        return best[1] if best else None

    # 按目标词的形态归属单元 —— 变格/变位那一章在 Smyth 里是表格、没有例句，
    # 只靠小节区间的话 noun1/noun2/noun3/adj 会一条都分不到。
    greek_words = json.loads((DATA / "greek.json").read_text(encoding="utf-8"))
    wlist = greek_words["words"] if isinstance(greek_words, dict) else greek_words
    by_id = {str(w["id"]): w for w in wlist}
    POS_UNIT = {
        "noun": "noun", "verb": "verb", "deponent verb": "dep", "adjective": "adj",
        "adj": "adj", "pronoun": "pron", "relative pronoun": "pron",
        "demonstrative": "pron", "interrogative": "pron",
        "definite article": "article", "article": "article",
    }

    def unit_by_target(wid: str, gram: str) -> str:
        w = by_id.get(str(wid))
        if not w:
            return ""
        pos = POS_UNIT.get(w.get("pos") or "", "")
        lemma = fold(w["word"])
        if pos == "noun":
            if lemma.endswith(("οσ", "ον")):
                return "noun2"
            if lemma.endswith("μα"):
                return "noun3"
            if lemma.endswith(("η", "α", "ησ", "ασ")):
                return "noun1"
            return "noun3"
        if pos:
            return pos
        # 词性为空时按语法标签猜
        if any(k in gram for k in ("人称", "不定式", "分词", "现在", "未完成",
                                   "不定过去", "将来", "完成", "命令", "虚拟", "祈愿")):
            return "verb"
        return ""

    def unit_of(n: int) -> str:
        for uid, (_, ranges) in UNITS.items():
            for lo, hi, _label in ranges:
                if lo <= n <= hi:
                    return uid
        return ""

    kept = []
    for e in examples:
        t = target_of(e["greek"])
        if not t:
            continue
        u = unit_by_target(t["wid"], t["gram"]) or unit_of(e["n"])
        if not u or u == "letters":
            continue          # 字母单元不出例句题（靠字母表本身的题目）
        kept.append({**e, "u": u, "t": t})
    # 每个单元最多留这么多条，避免数据过大
    per_unit: dict[str, int] = {}
    final = []
    for e in kept:
        per_unit[e["u"]] = per_unit.get(e["u"], 0)
        if per_unit[e["u"]] >= 160:
            continue
        per_unit[e["u"]] += 1
        final.append(e)
    examples = final
    print(f"可用例句 {len(examples)} 条，按单元: {per_unit}")

    # 只保留被引用到的小节正文，控制体积
    used = set()
    for _uid, (_zh, ranges) in UNITS.items():
        for lo, hi, _label in ranges:
            for n in range(lo, hi + 1):
                used.add(n)
    sections = [s for s in sections if s["n"] in used]
    units_out = {uid: {"zh": zh, "ranges": [{"a": lo, "b": hi, "zh": lab} for lo, hi, lab in rs]}
                 for uid, (zh, rs) in UNITS.items()}

    print(f"小节 {len(sections)} 个")
    print(f"例句 {len(examples)} 条（放弃 {dropped} 条）")
    print(f"  带出处 {sum(1 for e in examples if e['src'])}，带译文 {sum(1 for e in examples if len(e['en']) > 3)}")

    if a.report:
        for e in examples[40:50]:
            print(f"  §{e['n']:<5} {e['greek'][:52]:<54} | {e['en'][:36]:<38} | {e['src']}")
        return 0

    out = ROOT / a.out
    out.write_text(json.dumps({"units": units_out, "sections": sections, "examples": examples},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"已写入 {out}  ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
