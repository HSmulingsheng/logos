#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Perseus 的 LSJ XML 抽取释义，输出 data/lsj.json（按牌组词条 id 索引）。

来源与许可
----------
Liddell-Scott-Jones, *A Greek-English Lexicon*（9th ed.）
  Perseus Digital Library — https://github.com/PerseusDL/lexica
  **CC BY-SA 4.0**，引用格式见 NOTICE.md

格式要点（都是踩过的坑）
------------------------
1. LSJ 里凡 `lang="greek"` 的元素，内容**都不是希腊语字母而是 Beta Code**
   （词头 `lo/gos`、正文里的 `le/gw`）。**正文里的也必须转**，否则释义会长成
   「lo/gos , o( , verbal noun of le/gw」这样一半英文一半 beta code 的怪样子。
2. `key` 带同形异条编号（`e)/a1`、`e)/ar2`），要去掉尾部数字。
3. 释义混着大量 `<bibl>` 引文出处，对学习工具是噪音，整段剔除。
4. 匹配不上是**系统性的**，不是 bug：
   - 牌组词条带尾点（`ὑμεῖς.`）
   - 中动语态 vs 主动（牌组 `ἀποκρίνομαι` → LSJ `a)pokri/nw`）
   - 新约拼法 vs 阿提卡拼法（牌组 `γινώσκω` → LSJ `gignw/skw`）
   所以要用回退链逐级尝试。

用法
----
    tools/venvs/grc-ipa/bin/python tools/build_lsj.py            # 全量
    tools/venvs/grc-ipa/bin/python tools/build_lsj.py --check    # 只报覆盖率
    tools/venvs/grc-ipa/bin/python tools/build_lsj.py --sample λόγος
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from beta_code import beta_to_unicode, fold  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LSJ_DIR = ROOT / "语料调研/lsj-tar/lexica-master/CTS_XML_TEI/perseus/pdllex/grc/lsj"
OUT = ROOT / "data/lsj.json"
GREEK = ROOT / "data/greek.json"

MAX_LEN = 210          # 单条义项截断长度
MAX_SENSES = 5         # 每词保留的义项数（按语料相关度取前几名）
MAX_WORD_LEN = 780     # 每词释义总长上限，控制 data/lsj.json 的体积

# ---------------------------------------------------------------- 义项排序
#
# 为什么不照抄 LSJ 的顺序
# ----------------------
# LSJ 按「词义的历史/逻辑顺序」排列，首位常是词源义或本义。
# 例如 λόγος 的 I 是 "computation, reckoning"（算账、计算），
# 而读者在新约与古典文本里真正遇到的是 "verbal expression or utterance"（话、言语）。
# 对一个**阅读工具**来说，把读者最可能用到的义项排在前面才合理。
#
# 排序依据：每个义项下的**作者引用**，按「应用语料里会读到的作者」加权。
# 文学与历史两类权重最高（10 分档）——按用户要求，读文献时优先看到这两类的用法。
# 宗教（新约/七十士译本）为 6，哲学（柏拉图/亚里士多德）为 5。
# LSJ 的引用是用来举例的，不是频次统计，但「哪个义项被 Hdt./Th./Pl. 反复引来举例」
# 本身就是很强的相关度信号。
#
# `Id.` 是「同上作者」的缩写，要继承前一个作者的权重。
CORPUS_WEIGHT = {
    # ── 文学（本类权重最高）────────────────────────────────
    # 荷马史诗（含分别标注的 Il. / Od.）、三大悲剧家、阿里斯托芬
    'Hom.': 10, 'Il.': 10, 'Od.': 10, 'S.': 10, 'E.': 10, 'A.': 10, 'Ar.': 10,
    # 品达、赫西俄德、忒奥克里托斯、阿波罗尼俄斯、巴克基利得斯、卡利马科斯、米南德
    'Pi.': 8, 'Hes.': 8, 'Theoc.': 8, 'A.R.': 8, 'B.': 8, 'Call.': 8, 'Men.': 8,
    'Luc.': 7,
    # 抒情诗人与次要作者
    'Sapph.': 6, 'Alc.': 6, 'Simon.': 6, 'Anacr.': 6, 'Ibyc.': 6,
    'Babr.': 6, 'Mosch.': 6, 'Bion': 6,

    # ── 历史（本类权重最高）────────────────────────────────
    # 希罗多德、修昔底德、色诺芬、普鲁塔克
    'Hdt.': 10, 'Th.': 10, 'X.': 10, 'Plu.': 10,
    # 波利比乌斯、约瑟夫斯、狄奥多罗斯
    'Plb.': 8, 'J.': 8, 'D.S.': 8,
    # 阿里安、阿庇安、保萨尼亚斯、赫罗狄安
    'Arr.': 7, 'App.': 7, 'Paus.': 7, 'Hdn.': 7,
    # 晚期史家
    'Agath.': 6, 'Procop.': 6, 'Just.': 6, 'Eus.': 6, 'Zos.': 6,
    'Cass.': 5, 'Socr.': 5,

    # ── 宗教 ──────────────────────────────────────────────
    'NT': 6, 'LXX': 6, 'Ev.': 6, 'Ep.': 5, 'Act': 5, 'Apoc': 5,

    # ── 哲学 ──────────────────────────────────────────────
    'Pl.': 5, 'Arist.': 5,
}
OTHER_WEIGHT = 1       # 其余作者（辞书 Hsch.、医学 Gal. 等）给基础分

# 剔除的整段内容：
#   bibl  = 引文出处（Hdt. 7.32 之类）
#   cit   = 希腊语引例本身。对学习工具是噪音，且**极长**，不剔除释义会被淹没
#   quote = 同上，单独出现的引文
#   gramGrp/gram = 方言标注（Att. Ion. Dor.），保留会显得杂乱
DROP_TAGS = ["bibl", "note", "ptr", "anchor", "cit", "quote", "gramGrp", "gram"]
RE_ENTRY = re.compile(r"<entryFree\b([^>]*)>(.*?)</entryFree>", re.S)
RE_KEY = re.compile(r'key="([^"]*)"')
RE_SENSE = re.compile(r"<sense\b([^>]*)>", re.S)
RE_SENSE_N = re.compile(r'n="([^"]*)"')
RE_GREEK_EL = re.compile(r'<(\w+)\b[^>]*\blang="greek"[^>]*>(.*?)</\1>', re.S)


def convert_greek(xml: str) -> str:
    """
    把 XML 里所有 `lang="greek"` 元素的内容由 Beta Code 转成希腊语。
    反复几轮以处理嵌套（<foreign><itype>…</itype></foreign>）。
    """
    for _ in range(4):
        new = RE_GREEK_EL.sub(lambda m: beta_to_unicode(re.sub(r"<[^>]+>", "", m.group(2))), xml)
        if new == xml:
            break
        xml = new
    return xml


# 引例剔除后残留的英文连接词，对学习者无意义
FILLER = re.compile(
    r"\b(?:etc|ib|cf|al|v\.?\s*l|sq|ad\s*loc|ap|pass|poet|pros|att|ion|dor|aeol|ep|lyr|trag|com)\b\.?",
    re.I)


def drop_greek_examples(xml: str) -> str:
    """
    剔除 LSJ 用来举例的希腊语短语（`<foreign lang="greek">e)di/dosan to\n l.</foreign>`）。

    ⚠️ **必须在 convert_greek() 之前调用**。因为 convert_greek 会把
    `lang="greek"` 元素的**整个标签**替换成纯文本，之后 `<foreign>` 就不存在了，
    再想按标签剔除已经无从下手——那些例词就会混进释义里
    （实测「computation, reckoning … ἐδίδοσαν τὸν λ., συνᾶραι λόγον …」）。
    应用里单词页已有 IPA、变形表、新约例句，这些重复的例词只是干扰。
    """
    return re.sub(r'<foreign\b[^>]*lang="greek"[^>]*>.*?</foreign>', " ", xml, flags=re.S)


def strip_tags(xml: str) -> str:
    # 词头到第一个义项之间是形态学注记（「gen. εως, dat. πίστει, (πείθομαι):—」），
    # 对查词的人是噪音，直接从第一个 <sense> 开始。
    first = RE_SENSE.search(xml)
    if first:
        xml = xml[first.start():]
    for tag in DROP_TAGS:
        xml = re.sub(rf"<{tag}\b.*?</{tag}>", " ", xml, flags=re.S)
        xml = re.sub(rf"<{tag}\b[^>]*/>", " ", xml)
    # 义项编号保留成「A.」「1.」
    xml = RE_SENSE.sub(
        lambda m: " " + (RE_SENSE_N.search(m.group(1)).group(1) + ". "
                        if RE_SENSE_N.search(m.group(1)) else " "), xml)
    xml = re.sub(r"<[^>]+>", " ", xml)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'")):
        xml = xml.replace(a, b)
    xml = re.sub(r"\s+", " ", xml).strip()
    # 引例被剔除后会留下成串的 ", , ; :—" 碎片，压掉
    xml = re.sub(r"(?:\s*[,;:.·]\s*){2,}", ", ", xml)
    xml = re.sub(r"\s*[;,:.·]\s*(?=[;,.·])", "", xml)
    xml = re.sub(r"\(\s*[,;:.·]\s*\)", " ", xml)
    xml = re.sub(r"\s+([,;:.·])", r"\1", xml)
    xml = re.sub(r"([,;:.·])(?=[^\s\d])", r"\1 ", xml)
    xml = re.sub(r"\s{2,}", " ", xml)
    xml = FILLER.sub(" ", xml)
    xml = re.sub(r"\s+", " ", xml)
    # 剔除引例后剩下的空壳：空括号、光秃秃的缩写与标点
    for _ in range(4):
        xml = re.sub(r"\(\s*[,;:.·]?\s*\)", " ", xml)      # ( ) ( , )
        xml = re.sub(r"\(\s*[A-Za-z]{1,3}\.?\s*\)", " ", xml)   # ( Sch. ) ( B )
        xml = re.sub(r"\(\s*\)", " ", xml)
    xml = re.sub(r"\s*,\s*,+", ",", xml)
    xml = re.sub(r"\s*;\s*;+", ";", xml)
    xml = re.sub(r"\s*\.\s*\.+", ".", xml)
    xml = re.sub(r"\s*—\s*", " — ", xml)
    xml = re.sub(r"\s+([,;:.])", r"\1", xml)
    # 掉在开头的义项编号与标点
    xml = re.sub(r"^(?:[A-Z]\.\s*|[,;:.·\s])+", "", xml).strip()
    # 最后一道兜底：上面各步的先后顺序会互相制造新的重复标点
    # （例如「handled,, settle」——剔除 middle 的例词后两个逗号贴到了一起，
    #   而补空格的那步又把它们推开）。放在最后统一收口，比推导顺序可靠。
    for _ in range(3):
        xml = re.sub(r"\s*,\s*,+", ", ", xml)
        xml = re.sub(r"\s*;\s*;+", "; ", xml)
        xml = re.sub(r"\s+([,;:])", r"\1", xml)
        xml = re.sub(r"\s{2,}", " ", xml)
    xml = re.sub(r",\s*(?=[,;:.])", "", xml)
    xml = re.sub(r"\s+([,;:.])", r"\1", xml)
    xml = re.sub(r"\s{2,}", " ", xml)
    return xml.strip(" ,;:.·")


def truncate(text: str, limit: int = MAX_LEN) -> str:
    """在义项/句子边界处截断，避免把词切成两半。"""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "; ", ", "):
        i = cut.rfind(sep)
        if i > limit * 0.5:
            return cut[:i + 1].strip()
    return cut.rstrip() + "…"


def clean_headword(orth_beta: str) -> str:
    w = re.sub(r"[\[\]{}]", "", orth_beta)
    w = w.split(",")[0].split("·")[0].strip()
    w = w.replace("-", "").replace(".", "")
    return beta_to_unicode(w)


def variants(folded: str) -> list[str]:
    """
    回退匹配键。都是新约希腊语与 LSJ 词头之间的**系统性**差异，不是碰运气：
      - 中动/被动 -ομαι ↔ 主动 -ω（ἀποκρίνομαι / ἀποκρίνω）
      - 新约 -ιν- ↔ 阿提卡 -ιγν-（γινώσκω / γιγνώσκω）
      - -σσ- ↔ -ττ-（θάλασσα / θάλαττα）
      - 词尾 -ν / -σ 脱落
    """
    out = [folded]
    if folded.endswith("ομαι") and len(folded) > 5:
        out.append(folded[:-4] + "ω")
    if "ιν" in folded:
        out.append(folded.replace("ιν", "ιγν"))
    if "ιγν" in folded:
        out.append(folded.replace("ιγν", "ιν"))
    if "σσ" in folded:
        out.append(folded.replace("σσ", "ττ"))
    if "ττ" in folded:
        out.append(folded.replace("ττ", "σσ"))
    if folded.endswith("ν") and len(folded) > 3:
        out.append(folded[:-1])
    if folded.endswith("σ") and len(folded) > 3:
        out.append(folded[:-1])
    seen, uniq = set(), []
    for v in out:
        if v and v not in seen:
            seen.add(v); uniq.append(v)
    return uniq


def top_level_senses(body: str) -> list[tuple[str, str]]:
    """
    切出**顶层**义项。层级属性并不统一——λόγος 的顶层是 level=2，
    ἄνθρωπος 是 level=1——所以取该词条内出现的最小 level 作为顶层。
    子义项留在父项内一起呈现，保住层次。
    """
    levels = [int(x) for x in re.findall(r'<sense\b[^>]*level="(\d+)"', body)]
    if not levels:
        return []
    top = min(levels)
    idx = [m.start() for m in re.finditer(rf'<sense\b[^>]*level="{top}"', body)]
    out = []
    for i, st in enumerate(idx):
        en = idx[i + 1] if i + 1 < len(idx) else len(body)
        seg = body[st:en]
        nm = re.search(r'<sense\b[^>]*\bn="([^"]*)"', seg)
        out.append((nm.group(1) if nm else '', seg))
    return out


def sense_score(seg: str) -> int:
    """按语料作者加权统计引文数；`Id.` 继承上一个作者的权重。"""
    sc = 0
    last = None
    for m in re.finditer(r"<author[^>]*>(.*?)</author>", seg, re.S):
        a = m.group(1).strip()
        if a == "Id." and last:
            w = CORPUS_WEIGHT.get(last, OTHER_WEIGHT)
        else:
            w = CORPUS_WEIGHT.get(a, OTHER_WEIGHT)
        if a != "Id.":
            last = a
        sc += w
    return sc


def rank_senses(body: str) -> list[dict]:
    """
    把词条拆成若干义项，按语料相关度排序后返回前 MAX_SENSES 条。
    输出 [{n: 编号, t: 释义, s: 相关度分}]。
    """
    rows = []
    for n, seg in top_level_senses(body):
        text = truncate(strip_tags(convert_greek(drop_greek_examples(seg))), MAX_LEN)
        if len(text) < 4:
            continue
        rows.append({"n": n, "t": text, "s": sense_score(seg)})
    rows.sort(key=lambda r: -r["s"])
    # 截到每词的总长上限，避免体积失控
    out, total = [], 0
    for r in rows[:MAX_SENSES]:
        if total + len(r["t"]) > MAX_WORD_LEN and out:
            break
        out.append(r)
        total += len(r["t"])
    return out


def cleanup_deck_word(raw: str) -> str:
    """去掉方括号语法标注、首尾标点。牌组里大量词条带尾点（`ὑμεῖς.`）。"""
    w = re.sub(r"\[[^\]]*\]", "", raw)
    return w.strip().strip(".,·;:").strip()


def deck_words() -> dict[str, list[str]]:
    greek = json.load(open(GREEK, encoding="utf-8"))
    deck: dict[str, list[str]] = {}
    for r in greek:
        w = cleanup_deck_word((r.get("_raw") or {}).get("Greek", ""))
        if w:
            deck.setdefault(fold(w), []).append(w)
    return deck


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--sample", default=None, help="打印某个词的 LSJ 释义")
    args = ap.parse_args()

    if not LSJ_DIR.exists():
        print(f"❌ 找不到 LSJ 目录：{LSJ_DIR}", file=sys.stderr)
        return 1

    files = sorted(LSJ_DIR.glob("grc.lsj.perseus-eng*.xml"))
    print(f"LSJ 文件 {len(files)} 个")

    index: dict[str, tuple[int, list[dict]]] = {}
    total = 0
    for f in files:
        text = f.read_text(encoding="utf-8", errors="ignore")
        for attrs, body in RE_ENTRY.findall(text):
            total += 1
            m = RE_KEY.search(attrs)
            if not m:
                continue
            key = re.sub(r"\d+$", "", m.group(1))
            o = re.search(r"<orth[^>]*>(.*?)</orth>", body, re.S)
            head = clean_headword(o.group(1)) if o else beta_to_unicode(key)
            if not head:
                head = beta_to_unicode(key)
            if not head:
                continue
            k = fold(head)
            if not k:
                continue
            # 先按「义项排序后的总长」挑更完整的那条同形词条
            ranked = rank_senses(body)
            if not ranked:
                # 少数词条（短语、只给变格表或只有词头的）没有 <sense> 层级，
                # 退回整段抽取，避免白白丢掉 200 多个词条
                flat = truncate(strip_tags(convert_greek(drop_greek_examples(body))), MAX_WORD_LEN)
                if len(flat) < 3:
                    continue
                ranked = [{"n": "", "t": flat, "s": 0}]
            size = sum(len(r["t"]) for r in ranked)
            if k not in index or size > index[k][0]:
                index[k] = (size, ranked)
        print(f"  {f.name:<34} 词条 {total:>7,} · 索引 {len(index):>7,}")

    if args.sample:
        k = fold(args.sample)
        print(f"\n=== {args.sample} ===")
        for v in variants(k):
            if v in index:
                print(f"  [{v}] 相关度排序，共 {len(index[v][1])} 条：")
                for r in index[v][1]:
                    print(f"    [{r['n']:<4} 分{r['s']:<5}] {r['t'][:120]}")
                break
        else:
            print("  未找到")

    deck = deck_words()
    print(f"\n牌组词条 {len(deck):,} 个（折叠去重后）")

    matched: dict[str, str] = {}
    direct = 0
    for k in deck:
        vs = variants(k)
        for i, v in enumerate(vs):
            if v in index:
                matched[k] = index[v]
                if i == 0:
                    direct += 1
                break

    print(f"\n=== 覆盖率 ===")
    print(f"  LSJ 词条     {total:,}")
    print(f"  索引         {len(index):,}")
    print(f"  牌组词条     {len(deck):,}")
    print(f"  匹配上       {len(matched):,}  ({len(matched)/len(deck)*100:.1f}%)")
    print(f"    其中直接命中 {direct:,} · 靠回退 {len(matched)-direct:,}")

    miss = [k for k in deck if k not in matched]
    print(f"\n  未匹配 {len(miss)} 个，示例（前 20）:")
    for k in miss[:20]:
        print(f"    {deck[k][0]}")

    if args.check or args.sample:
        return 0

    # 按牌组词条 id 输出，前端可直接取
    greek = json.load(open(GREEK, encoding="utf-8"))
    out: dict[str, list[dict]] = {}
    for r in greek:
        w = cleanup_deck_word((r.get("_raw") or {}).get("Greek", ""))
        if not w:
            continue
        k = fold(w)
        if k not in matched:
            continue
        # 同形词条可能对应多个 id，各自取自己那份
        out[str(r["id"])] = matched[k][1]
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\n✅ {OUT.relative_to(ROOT)} · {len(out):,} 条 · {OUT.stat().st_size/1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
