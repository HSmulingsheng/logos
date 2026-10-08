#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 MorphGNT/SBLGNT + 和合本(CUV) 构建真实语料例句库、词形变化表与新约语料库。

产出:
  data/examples.json   note_id -> [ {greek, ref, cuv, tokens:[...], source} ]
  data/forms.json      note_id -> [ {form, count, gram} ]   语料中实际出现的词形
  data/corpus_nt.json  新约全文中希对照（阅读 / 自由检索用）

用法: python3 tools/build_examples.py
"""
from __future__ import annotations

import glob
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textclean import clean_greek, is_corrupt   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / ".build"
DATA = ROOT / "data"

# MorphGNT 卷号（新约顺序 1-27）-> (OSIS 代码, 中文名, 英文名)
_NT = [
    ("MAT", "马太福音", "Matthew"), ("MRK", "马可福音", "Mark"),
    ("LUK", "路加福音", "Luke"), ("JHN", "约翰福音", "John"),
    ("ACT", "使徒行传", "Acts"), ("ROM", "罗马书", "Romans"),
    ("1CO", "哥林多前书", "1 Corinthians"), ("2CO", "哥林多后书", "2 Corinthians"),
    ("GAL", "加拉太书", "Galatians"), ("EPH", "以弗所书", "Ephesians"),
    ("PHP", "腓立比书", "Philippians"), ("COL", "歌罗西书", "Colossians"),
    ("1TH", "帖撒罗尼迦前书", "1 Thessalonians"), ("2TH", "帖撒罗尼迦后书", "2 Thessalonians"),
    ("1TI", "提摩太前书", "1 Timothy"), ("2TI", "提摩太后书", "2 Timothy"),
    ("TIT", "提多书", "Titus"), ("PHM", "腓利门书", "Philemon"),
    ("HEB", "希伯来书", "Hebrews"), ("JAS", "雅各书", "James"),
    ("1PE", "彼得前书", "1 Peter"), ("2PE", "彼得后书", "2 Peter"),
    ("1JN", "约翰一书", "1 John"), ("2JN", "约翰二书", "2 John"),
    ("3JN", "约翰三书", "3 John"), ("JUD", "犹大书", "Jude"),
    ("REV", "启示录", "Revelation"),
]
BOOKS = {i + 1: v for i, v in enumerate(_NT)}

CASE = {"N": "主格", "G": "属格", "D": "与格", "A": "宾格", "V": "呼格"}
NUM = {"S": "单数", "P": "复数"}
GEN = {"M": "阳性", "F": "阴性", "N": "中性"}
TENSE = {"P": "现在", "I": "未完成", "F": "将来", "A": "不定过去", "X": "完成", "Y": "过去完成"}
VOICE = {"A": "主动", "M": "中间", "P": "被动"}
MOOD = {"I": "直陈", "D": "祈使", "S": "虚拟", "O": "希求", "N": "不定式", "P": "分词"}
PERSON = {"1": "第一人称", "2": "第二人称", "3": "第三人称"}
DEGREE = {"C": "比较级", "S": "最高级"}


def norm(s: str) -> str:
    """去变音符号 + 统一 sigma，用于宽松匹配。"""
    d = unicodedata.normalize("NFD", s)
    d = "".join(c for c in d if not unicodedata.combining(c))
    return d.lower().replace("ς", "σ").replace("’", "").replace("'", "").strip()


def clean_token(s: str) -> str:
    return norm(re.sub(r"[^\w\s]", "", s, flags=re.UNICODE))


def parse_code(pos: str, code: str) -> str:
    """把 MorphGNT 的 parse code 转成中文语法说明。"""
    out = []
    c = code.ljust(8, "-")
    if pos == "V-":
        if c[0] in PERSON:
            out.append(PERSON[c[0]])
        if c[1] in TENSE:
            out.append(TENSE[c[1]])
        if c[2] in VOICE:
            out.append(VOICE[c[2]])
        if c[3] in MOOD:
            out.append(MOOD[c[3]])
        if c[3] == "P":
            for tbl, i in ((CASE, 4), (NUM, 5), (GEN, 6)):
                if c[i] in tbl:
                    out.append(tbl[c[i]])
    else:
        for tbl, i in ((CASE, 4), (NUM, 5), (GEN, 6), (DEGREE, 7)):
            if c[i] in tbl:
                out.append(tbl[c[i]])
    return "·".join(out)


# ---------------------------------------------------------------- CUV
def load_cuv(path: Path) -> dict[str, dict[int, dict[int, str]]]:
    xml = path.read_text(encoding="utf-8")
    out: dict[str, dict[int, dict[int, str]]] = {}
    for bm in re.finditer(r'<book id="([A-Z0-9]+)">(.*?)</book>', xml, re.S):
        bid, body = bm.group(1), bm.group(2)
        chaps: dict[int, dict[int, str]] = {}
        for cm in re.finditer(r'<c id="(\d+)"/>(.*?)(?=<c id="|\Z)', body, re.S):
            cid, cbody = int(cm.group(1)), cm.group(2)
            verses: dict[int, str] = {}
            for vm in re.finditer(r'<v id="(\d+)"/>(.*?)(?=<v id="|\Z)', cbody, re.S):
                vid, vtext = int(vm.group(1)), vm.group(2)
                vtext = vtext.split("<ve/>")[0]
                vtext = re.sub(r"<[^>]+>", "", vtext)
                vtext = re.sub(r"\\[a-z]+\*?", "", vtext)
                verses[vid] = vtext.strip()
            chaps[cid] = verses
        out[bid] = chaps
    return out


# ---------------------------------------------------------------- MorphGNT
def load_morphgnt(directory: Path):
    verses: dict[tuple[int, int, int], list[dict]] = {}
    lemma_index: dict[str, set] = defaultdict(set)
    forms: dict[str, Counter] = defaultdict(Counter)
    parse_of: dict[tuple[str, str], Counter] = defaultdict(Counter)

    for path in sorted(glob.glob(str(directory / "*-morphgnt.txt"))):
        for line in open(path, encoding="utf-8"):
            p = line.split()
            if len(p) < 7:
                continue
            loc, pos, code = p[0], p[1], p[2]
            # MorphGNT 的 surface form 带 SBLGNT 校勘符号（⸀⸁⸂⸃），
            # 在这里就先清掉：后面所有分词与命中下标都基于清理后的文本，保持一致
            text = clean_greek(p[3])
            word, lemma = p[4], p[6]
            if not text:
                continue
            bk, ch, vs = int(loc[:2]), int(loc[2:4]), int(loc[4:6])
            tok = {"form": text, "clean": word, "lemma": lemma, "pos": pos,
                   "parse": code, "gram": parse_code(pos, code)}
            verses.setdefault((bk, ch, vs), []).append(tok)
            lemma_index[norm(lemma)].add((bk, ch, vs))
            forms[norm(lemma)][word] += 1
            parse_of[(norm(lemma), word)][parse_code(pos, code)] += 1
    return verses, lemma_index, forms, parse_of


SENT_END = re.compile(r"[.;·]\s*$")


def split_sentences(tokens: list[dict]):
    sents, cur = [], []
    for t in tokens:
        cur.append(t)
        if SENT_END.search(t["form"]) and len(cur) >= 3:
            sents.append(cur)
            cur = []
    if cur:
        if sents:
            sents[-1].extend(cur)
        else:
            sents.append(cur)
    return sents


def sent_text(tokens: list[dict]) -> str:
    return " ".join(t["form"] for t in tokens).strip()


def main() -> int:
    DATA.mkdir(exist_ok=True)
    cuv = load_cuv(BUILD / "cuv-simp.usfx.xml")
    verses, lemma_index, forms, parse_of = load_morphgnt(BUILD / "morphgnt")
    print(f"MorphGNT: {len(verses)} 节, {len(lemma_index)} lemma")

    def cuv_of(bk: int, ch: int, vs: int) -> str:
        return cuv.get(BOOKS[bk][0], {}).get(ch, {}).get(vs, "")

    # 反向索引：节 -> 词集合、词 -> 节集合，用于卡内经文例句的模糊定位
    verse_words: dict[tuple, set] = {}
    word_verses: dict[str, set] = defaultdict(set)
    for k, toks in verses.items():
        ws = {clean_token(t["clean"]) for t in toks}
        ws.discard("")
        verse_words[k] = ws
        for w in ws:
            word_verses[w].add(k)

    def locate(text: str):
        """在 SBLGNT 中按文本模糊反查一节经文，返回 (key, score)。"""
        qs = [clean_token(x) for x in text.split()]
        qs = [x for x in qs if x]
        if len(qs) < 3:
            return None, 0.0
        qset = set(qs)
        rare = sorted(qset, key=lambda w: len(word_verses.get(w, ())))[:3]
        cands: set = set()
        for w in rare:
            cands |= word_verses.get(w, set())
        best, bs = None, 0.0
        for k in cands:
            ws = verse_words[k]
            inter = len(qset & ws)
            if inter < 3:
                continue
            score = inter / max(len(qset), len(ws))
            if score > bs:
                best, bs = k, score
        return best, bs

    words = json.load(open(DATA / "greek.json", encoding="utf-8"))
    examples: dict[str, list] = {}
    stats = Counter()

    for w in words:
        key = w["search"].replace("ς", "σ")
        cands: list[dict] = []

        # 1) 卡片自带的经文例句：模糊反查以取得权威出处与和合本译文
        if w["verse"]:
            k, score = locate(w["verse"])
            if k and score >= 0.55:
                bk, ch, vs = k
                cands.append({
                    "greek": sent_text(verses[k]),
                    "ref": f"{BOOKS[bk][2]} {ch}:{vs}",
                    "ref_zh": f"{BOOKS[bk][1]} {ch}:{vs}",
                    "cuv": cuv_of(bk, ch, vs),
                    "tokens": [{"form": t["form"], "lemma": t["lemma"], "gram": t["gram"],
                                "hit": norm(t["lemma"]) == key} for t in verses[k]],
                    "source": "deck",
                })
                stats["deck_located"] += 1
            elif w["reference"]:
                cands.append({
                    "greek": w["verse"], "ref": w["reference"], "ref_zh": w["reference"],
                    "cuv": "", "tokens": [], "source": "deck",
                })
                stats["deck_unlocated"] += 1

        # 2) SBLGNT 自动检索
        seen_ref = {c["ref"] for c in cands}
        scored = []
        for (bk, ch, vs) in lemma_index.get(key, ()):  # type: ignore[arg-type]
            ref = f"{BOOKS[bk][2]} {ch}:{vs}"
            if ref in seen_ref:
                continue
            for s in split_sentences(verses[(bk, ch, vs)]):
                if not any(norm(t["lemma"]) == key for t in s):
                    continue
                n = len(s)
                if n < 4 or n > 26:
                    continue
                hit = [t for t in s if norm(t["lemma"]) == key]
                sc = -abs(n - 11) * 0.12
                for t in hit:
                    if "主格" in t["gram"] or "直陈" in t["gram"]:
                        sc += 1.2
                sc += min(len(hit), 1) * 0.4        # 只奖励首次出现
                sc -= max(0, len(hit) - 2) * 0.9    # 反复出现多为清单式句子，压低
                if bk in (4, 1, 3, 5):     # 约翰 / 马太 / 路加 / 使徒
                    sc += 0.6
                sc += (1 - (bk - 1) / 26) * 0.5     # 偏好正典靠前的书卷
                scored.append((sc, bk, ch, vs, s, ref))
        scored.sort(key=lambda x: -x[0])
        picked_books: set[int] = set()
        for sc, bk, ch, vs, s, ref in scored:
            if len(cands) >= 3:
                break
            if bk in picked_books and len(cands) >= 2:
                continue
            picked_books.add(bk)
            cands.append({
                "greek": sent_text(s), "ref": ref,
                "ref_zh": f"{BOOKS[bk][1]} {ch}:{vs}",
                "cuv": cuv_of(bk, ch, vs),
                "tokens": [{"form": t["form"], "lemma": t["lemma"], "gram": t["gram"],
                            "hit": norm(t["lemma"]) == key} for t in s],
                "source": "sblgnt",
            })
        if cands:
            examples[str(w["id"])] = cands[:3]
            stats["with_examples"] += 1

    (DATA / "examples.json").write_text(
        json.dumps(examples, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 词形变化表
    lemma_forms = {}
    for w in words:
        key = w["search"].replace("ς", "σ")
        if key in forms:
            fl = []
            for f, n in forms[key].most_common(24):
                g = parse_of[(key, f)].most_common(1)
                fl.append({"form": f, "count": n, "gram": g[0][0] if g else ""})
            lemma_forms[str(w["id"])] = fl
    (DATA / "forms.json").write_text(
        json.dumps(lemma_forms, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 新约全文中希对照
    corpus = []
    for (bk, ch, vs), toks in sorted(verses.items()):
        corpus.append({
            "b": BOOKS[bk][1], "be": BOOKS[bk][2], "c": ch, "v": vs,
            "g": sent_text(toks), "z": cuv_of(bk, ch, vs),
        })
    (DATA / "corpus_nt.json").write_text(
        json.dumps(corpus, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    stats["total_words"] = len(words)
    stats["with_forms"] = len(lemma_forms)
    stats["nt_verses"] = len(corpus)
    print(json.dumps(stats, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
