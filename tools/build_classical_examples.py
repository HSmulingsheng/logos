#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用 GLAUx（CC BY 4.0 / CC BY-SA，1,985 万词、全部带 lemma）为**古典/阿提卡**词条补真实语料例句。

新约层（5,436 词）已由 MorphGNT/SBLGNT 覆盖；这里只处理剩下的约 10,250 条古典词。

输入（由调研阶段生成）:
  ../语料调研/glaux/glaux_lemma_examples.tsv   lemma \t 文本ID \t 行号 \t 例句
  ../语料调研/glaux/glaux_form_lemma.tsv       形式 \t lemma \t 频次
  ../语料调研/glaux/metadata.txt               文本ID -> 作者/作品/许可

产出:
  data/examples_classical.json   note_id -> [ {greek, ref, ref_zh, cuv, tokens, source} ]

用法: python3 tools/build_classical_examples.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textclean import clean_greek, is_corrupt   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GLAUX = ROOT.parent / "语料调研" / "glaux"

# 作者中文名（GLAUx 用拉丁名）
AUTHOR_ZH = {
    "Homerus": "荷马", "Hesiodus": "赫西俄德", "Plato": "柏拉图",
    "Aristoteles et Corpus Aristotelicum": "亚里士多德", "Xenophon": "色诺芬",
    "Thucydides": "修昔底德", "Herodotus": "希罗多德", "Lysias": "吕西阿斯",
    "Demosthenes": "德摩斯梯尼", "Isocrates": "伊索克拉底", "Isaeus": "伊赛俄斯",
    "Aeschylus": "埃斯库罗斯", "Sophocles": "索福克勒斯", "Euripides": "欧里庇得斯",
    "Aristophanes": "阿里斯托芬", "Menander": "米南德", "Plutarchus": "普鲁塔克",
    "Lucianus": "卢奇安", "Galenus": "盖伦", "Hippocrates et Corpus Hippocraticum": "希波克拉底",
    "Aelius Aristides": "阿里斯提德斯", "Appianus": "阿庇安", "Origenes": "奥利金",
    "Philo Judaeus": "斐洛", "Clemens Alexandrinus": "克莱门特", "Euclides": "欧几里得",
    "Archimedes": "阿基米德", "Heron": "希罗", "Dionysius Halicarnassensis": "哈利卡纳苏斯的狄奥尼修斯",
    "Pausanias": "保萨尼阿斯", "Strabo": "斯特拉波", "Polybius": "波利比乌斯",
    "Dio Cassius": "卡西乌斯·狄奥", "Josephus": "约瑟夫斯", "Epictetus": "爱比克泰德",
    "Marcus Aurelius": "马可·奥勒留", "Plotinus": "普罗提诺", "Callimachus": "卡利马科斯",
    "Theocritus": "忒奥克里托斯", "Pindarus": "品达", "Sappho": "萨福",
    "Hymni Homerici": "荷马颂歌", "Septuaginta": "七十士译本", "Novum Testamentum": "新约",
    "Pseudo-Apollodorus": "伪阿波罗多洛斯", "Aesopus": "伊索", "Democritus": "德谟克利特",
    "Epicurus": "伊壁鸠鲁", "Theophrastus": "泰奥弗拉斯托斯", "Hippolytus": "希波吕托斯",
    "Basilius Caesariensis": "该撒利亚的巴西流", "Gregorius Nyssenus": "尼撒的格里高利",
    "Ioannes Chrysostomus": "约翰·克里索斯托", "Athanasius": "亚他那修",
    "Eusebius": "优西比乌", "Porphyrius": "波菲利", "Iamblichus": "扬布里柯",
    "Apollonius Rhodius": "阿波罗尼俄斯", "Diogenes Laertius": "第欧根尼·拉尔修",
    "Theognis": "泰奥格尼斯", "Oppianus": "奥皮安", "Diodorus Siculus": "狄奥多罗斯",
    "Flavius Josephus": "约瑟夫斯", "Herodianus": "赫罗狄安", "Flavius Arrianus": "阿里安",
    "Sextus Empiricus": "塞克斯都·恩披里柯", "Dio Chrysostomus": "狄翁·克里索斯托姆",
    "Aelianus": "埃利安", "Athenaeus": "阿特纳奥斯", "Dio Cassius": "卡西乌斯·狄奥",
    "Bacchylides": "巴克基利得斯", "Simonides": "西摩尼得斯", "Alcaeus": "阿尔卡埃乌斯",
    "Anacreon": "阿那克里翁", "Empedocles": "恩培多克勒", "Parmenides": "巴门尼德",
    "Xenophanes": "色诺芬尼", "Heraclitus": "赫拉克利特", "Longinus": "朗吉努斯",
    "Heliodorus": "赫利奥多罗斯", "Achilles Tatius": "阿基里斯·塔提乌斯",
    "Chariton": "卡里同", "Babrius": "巴布里乌斯", "Artemidorus": "阿尔忒弥多罗斯",
    "Proclus": "普罗克洛斯", "Simplicius": "辛普里丘", "Olympiodorus": "奥林匹奥多罗斯",
    "Michael Psellus": "米海尔·普塞洛斯", "Anna Comnena": "安娜·科穆宁娜",
    "Aeschines": "埃斯基涅斯", "Andocides": "安多基德斯", "Antiphon": "安提丰",
    "Dinarchus": "狄那尔科斯", "Hyperides": "希佩里德斯", "Isaeus": "伊赛俄斯",
    "Xenophon Ephesius": "以弗所的色诺芬", "Soranus": "索拉努斯",
    "Dionysius Halicarnassensis": "哈利卡纳苏斯的狄奥尼修斯",
    "Pseudo-Longinus": "伪朗吉努斯", "Pseudo-Plutarchus": "伪普鲁塔克",
    "Pseudo-Apollodorus": "伪阿波罗多洛斯", "Apollodorus": "阿波罗多洛斯",
    "Marcus Aurelius": "马可·奥勒留", "Epictetus": "爱比克泰德",
    "Theophrastus": "泰奥弗拉斯托斯", "Democritus": "德谟克利特",
    "Hippolytus": "希波吕托斯", "Basilius Caesariensis": "该撒利亚的巴西流",
    "Gregorius Nyssenus": "尼撒的格里高利", "Ioannes Chrysostomus": "约翰·克里索斯托",
    "Athanasius": "亚他那修", "Eusebius": "优西比乌", "Porphyrius": "波菲利",
    "Iamblichus": "扬布里柯", "Clemens Alexandrinus": "克莱门特",
    "Hesiodus": "赫西俄德", "Hymni Homerici": "荷马颂歌", "Aesopus": "伊索",
    "Menander": "米南德", "Callimachus": "卡利马科斯", "Euclides": "欧几里得",
    "Archimedes": "阿基米德", "Heron": "希罗", "Strabo": "斯特拉波",
    "Polybius": "波利比乌斯", "Plotinus": "普罗提诺", "Pindarus": "品达",
    "Sappho": "萨福",
}

# 常见作品中文名
WORK_ZH = {
    "Ilias": "伊利亚特", "Odyssea": "奥德赛", "Respublica": "理想国",
    "Apologia": "申辩篇", "Symposium": "会饮篇", "Phaedo": "斐多篇",
    "Phaedrus": "斐德罗篇", "Gorgias": "高尔吉亚篇", "Protagoras": "普罗泰戈拉篇",
    "Crito": "克里同篇", "Euthyphro": "欧悌甫戎篇", "Menon": "美诺篇",
    "Timaeus": "蒂迈欧篇", "Leges": "法律篇", "Theaetetus": "泰阿泰德篇",
    "Sophista": "智者篇", "Parmenides": "巴门尼德篇", "Anabasis": "远征记",
    "Historiae": "历史", "De bello Peloponnesiaco": "伯罗奔尼撒战争史",
    "Ethica Nicomachea": "尼各马可伦理学", "De anima": "论灵魂",
    "Metaphysica": "形而上学", "Poetica": "诗学", "Rhetorica": "修辞学",
    "Politica": "政治学", "Bibliotheca": "书库", "De mysteriis": "论秘仪",
    "Argonautica": "阿尔戈英雄纪", "Theogonia": "神谱",
    "Opera et dies": "工作与时日", "Sententiae": "格言集",
    "Vitae parallelae": "平行列传", "Moralia": "道德论集",
    "De natura deorum": "论神性", "Epistulae": "书信集",
    "Anthologia Graeca": "希腊诗选",
    "Vitae philosophorum": "名哲言行录", "Idyllia": "田园诗",
    "Quaestiones": "问题集", "Alcestis": "阿尔刻提斯", "Medea": "美狄亚",
    "Cyclops": "独眼巨人", "Hippolytus": "希波吕托斯", "Andromacha": "安德洛玛刻",
    "Hecuba": "赫卡柏", "Ion": "伊翁", "Hercules": "赫拉克勒斯",
    "Phoenisae": "腓尼基妇女", "Supplices": "乞援人", "Heraclidae": "赫拉克勒斯的后裔",
    "Helena": "海伦", "Electra": "厄勒克特拉", "Bacchae": "酒神的伴侣",
    "Troiades": "特洛伊妇女", "Iphigenia Taurica": "陶里斯的伊菲革涅亚",
    "Iphigenia Aulidensis": "奥利斯的伊菲革涅亚", "Orestes": "俄瑞斯忒斯",
    "Rhesus": "瑞索斯", "Cato": "加图传", "Aemilius": "埃米利乌斯传",
    "Fabius": "法比乌斯传", "De Iside et Osiride": "论伊西斯与奥西里斯",
    "Graeciae descriptio": "希腊道里志", "Bibliotheca historica": "历史丛书",
    "Anabasis Alexandri": "亚历山大远征记", "Cyropaedia": "居鲁士的教育",
    "Memorabilia": "回忆苏格拉底", "Hellenica": "希腊史", "Oeconomicus": "经济论",
    "Apologia Socratis": "苏格拉底的申辩", "Contra Celsum": "驳塞尔苏斯",
    "Stromata": "杂记", "Paedagogus": "导师", "Protrepticus": "劝勉希腊人",
    "De principiis": "论首要原理", "Antiquitates Judaicae": "犹太古史",
    "De bello Judaico": "犹太战记", "Legum allegoriae": "寓意解经",
    "De opificio mundi": "论世界的创造", "Naturales quaestiones": "自然问题",
    "Epistulae morales": "道德书简", "De beneficiis": "论恩惠",
    "Enneades": "九章集", "Geographica": "地理学",
    "De natura animalium": "论动物的本性", "Varia historia": "杂闻录",
    "Oneirocritica": "解梦书", "Anthologia Palatina": "帕拉丁诗选",
    "Sententiae": "格言集", "Elegiae": "哀歌集", "Opera et dies": "工作与时日", "Theogonia": "神谱",
    "De mysteriis": "论秘仪", "Argonautica": "阿尔戈英雄纪",
    "Respublica": "理想国", "Leges": "法律篇", "Timaeus": "蒂迈欧篇",
    "Phaedo": "斐多篇", "Phaedrus": "斐德罗篇", "Gorgias": "高尔吉亚篇",
    "Protagoras": "普罗泰戈拉篇", "Crito": "克里同篇", "Euthyphro": "欧悌甫戎篇",
    "Menon": "美诺篇", "Theaetetus": "泰阿泰德篇", "Sophista": "智者篇",
    "Parmenides": "巴门尼德篇", "Symposium": "会饮篇", "Apologia": "申辩篇",
    "Historiae": "历史", "De bello Peloponnesiaco": "伯罗奔尼撒战争史",
    "Ethica Nicomachea": "尼各马可伦理学", "De anima": "论灵魂",
    "Metaphysica": "形而上学", "Poetica": "诗学", "Rhetorica": "修辞学",
    "Politica": "政治学", "Ilias": "伊利亚特", "Odyssea": "奥德赛",
    "Deipnosophistae": "智者之宴", "Bibliotheca": "书库",
}

# 允许再分发的许可（排除 NC / ND / 不明）
def license_ok(s: str) -> bool:
    s = (s or "").strip()
    if not s or s.upper() == "NA":
        return False
    if "NC" in s.upper() or "ND" in s.upper():
        return False
    if "OpenEdition" in s or "GNU" in s.upper():
        return False
    return "CC" in s.upper() or "PUBLIC DOMAIN" in s.upper()


def fold(s: str) -> str:
    """NFC 归一化 + 去变音符号 + 统一 sigma（GLAUx 是 NFD，务必先统一）"""
    d = unicodedata.normalize("NFD", s)
    d = "".join(c for c in d if not unicodedata.combining(c))
    d = unicodedata.normalize("NFC", d)
    return d.lower().replace("ς", "σ").strip()


def main() -> int:
    if not (GLAUX / "glaux_lemma_examples.tsv").exists():
        print(f"缺少 GLAUx 数据: {GLAUX}")
        return 1

    # ---- 元数据
    meta: dict[str, dict] = {}
    with open(GLAUX / "metadata.txt", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            meta[r["TLG"]] = r
    print(f"元数据 {len(meta)} 篇")

    # ---- 形式 -> lemma（用于例句内高亮）
    form2lemma: dict[str, str] = {}
    with open(GLAUX / "glaux_form_lemma.tsv", encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 3:
                continue
            k = fold(p[0])
            if k and k not in form2lemma:
                form2lemma[k] = fold(p[1])
    print(f"形式->lemma {len(form2lemma)} 条")

    # ---- lemma -> 例句
    lemma_ex: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    with open(GLAUX / "glaux_lemma_examples.tsv", encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 4:
                continue
            lemma_ex[fold(p[0])].append((p[1], p[2], p[3]))
    print(f"有例句的 lemma {len(lemma_ex)} 个")

    words = json.load(open(DATA / "greek.json", encoding="utf-8"))
    have = set(json.load(open(DATA / "examples.json", encoding="utf-8")).keys())
    print(f"词条 {len(words)}，已有新约例句 {len(have)}")

    out: dict[str, list] = {}
    stats = defaultdict(int)
    for w in words:
        wid = str(w["id"])
        if wid in have:
            continue
        key = fold(w["word"])
        cands = lemma_ex.get(key)
        if not cands:
            stats["no_lemma"] += 1
            continue
        picked = []
        seen_work = set()
        for tlg, line, sent in cands:
            m = meta.get(tlg)
            if not m or not license_ok(m["SOURCE_LICENSE"]):
                stats["license_skip"] += 1
                continue
            work = m["TITLE_STANDARD"] or ""
            if work in seen_work:
                continue
            # 去 HTML 实体、校勘符号、尾部编辑标记；损坏的句子整条丢弃
            sent = clean_greek(sent)
            if is_corrupt(sent):
                stats["corrupt"] = stats.get("corrupt", 0) + 1
                continue
            toks = sent.split()
            hits = [i for i, t in enumerate(toks) if form2lemma.get(fold(t)) == key]
            if not hits:
                stats["no_hit"] += 1
                continue
            # 句子过长时截取命中词附近的窗口
            if len(toks) > 40:
                c = hits[0]
                a = max(0, c - 18)
                b = min(len(toks), c + 18)
                toks = toks[a:b]
                hits = [h - a for h in hits if a <= h < b]
            seen_work.add(work)
            author = m["AUTHOR_STANDARD"] or ""
            ref = f"{author}, {work} {line}".strip(", ")
            ref_zh = f"{AUTHOR_ZH.get(author, author)}《{WORK_ZH.get(work, work)}》{line}"
            picked.append({
                "greek": " ".join(toks),
                "ref": ref,
                "ref_zh": ref_zh,
                "cuv": "",
                "tokens": [{"form": t, "lemma": form2lemma.get(fold(t), ""), "gram": "",
                            "hit": i in hits} for i, t in enumerate(toks)],
                "source": "classical",
            })
            if len(picked) >= 2:
                break
        if picked:
            out[wid] = picked
            stats["with_classical"] += 1

    (DATA / "examples_classical.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(dict(stats), ensure_ascii=False, indent=1))
    print(f"产出 {len(out)} 条词条的古典例句 -> data/examples_classical.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
