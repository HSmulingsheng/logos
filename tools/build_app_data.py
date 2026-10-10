#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 data/ 下的原始抽取结果打包成前端可直接懒加载的分片。

产出（app/public/data/）:
  manifest.json    课程清单 + 全站统计
  lesson-NN.json   每课词条（含释义/词形变化/例句/词根词缀）
  index.json       轻量检索索引
  affix.json       词根词缀索引（前缀/后缀 -> 例词 id）
  corpus/nt-NN.json 新约中希对照（按卷分片，阅读模式用）

中文释义来自 data/zh.json（若存在）: {note_id: ["义项1", ...]}，缺失则留空由 App 回退英文。

用法: python3 tools/build_app_data.py [--app-dir app]
"""
from __future__ import annotations

import argparse
import json
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# shrink_word 是模块级函数，取不到 main() 里的局部量，所以走全局（同 AUDIO_MODE 的做法）
IPA: dict[str, str] = {}


def fold_key(s: str) -> str:
    """检索键：NFC → 去变音符号 → 小写 → 词尾 ς 折成 σ。
    必须与前端 lib/data.ts 的 fold 保持一致，否则希腊语搜索会全部落空。"""
    import unicodedata
    d = unicodedata.normalize("NFD", s)
    d = "".join(c for c in d if not unicodedata.combining(c))
    d = unicodedata.normalize("NFC", d)
    return d.lower().replace("ς", "σ")


POS_ZH = {
    "noun": "名词", "verb": "动词", "deponent verb": "异相动词", "adjective": "形容词",
    "adj": "形容词", "adverb": "副词", "adv": "副词", "preposition": "介词",
    "conjunction": "连词", "number": "数词", "pronoun": "代词", "particle": "小品词",
    "name": "专名", "proper": "专名", "interrogative": "疑问词", "article": "冠词",
    "definite article": "定冠词", "indefinite article": "不定冠词", "interjection": "感叹词",
    "relative pronoun": "关系代词", "demonstrative": "指示词", "infinitive": "不定式",
}
GENDER_ZH = {"masculine": "阳性", "feminine": "阴性", "neuter": "中性"}


AUDIO_MODE = "mixed"


def shrink_word(r: dict, zh: list[str], ex: list, forms: list, ex_tr: dict | None = None) -> dict:
    tags = r["tags"]
    prefixes = sorted({t[5:] for t in tags if t.startswith("pref:")})
    suffixes = sorted({t[4:] for t in tags if t.startswith("suf:")})
    gender = "".join(GENDER_ZH.get(t, "") for t in tags if t in GENDER_ZH)
    extra_tags = [t for t in tags if not (t.startswith("pref:") or t.startswith("suf:"))
                  and t not in POS_ZH and t not in GENDER_ZH and not t.startswith("d")]

    w = {
        "i": r["id"],
        "w": r["word"],
        "e": r["enhanced"] if r["enhanced"] != r["word"] else "",
        "ipa": IPA.get(str(r["id"]), ""),
        "s": r["senses"],
        "z": zh,
        "p": r["pos"],
        "pz": POS_ZH.get(r["pos"], ""),
        "g": gender,
        "fq": r["frequency"],
        "st": r["strongs"],
        "au": r["audio"],
        "bh": r["biblehub"],
        "lg": r["logeion"],
        "cp": r["components"],
        "af": ([prefixes, suffixes] if (prefixes or suffixes) else None),
        "tg": extra_tags[:6],
        "rl": r["related"][:6],
        "nt": r["notes"] or "",
    }
    if r["alt_forms"]:
        w["alt"] = [a["word"] for a in r["alt_forms"] if a["word"] != r["word"]][:4]
    if forms:
        w["fm"] = [[f["form"], f["count"], f["gram"]] for f in forms]
    if ex:
        packed = []
        for ei, e in enumerate(ex):
            hits = [i for i, t in enumerate(e["tokens"]) if t.get("hit")]
            hg = [e["tokens"][i]["gram"] for i in hits]
            src = {"deck": 0, "sblgnt": 1, "classical": 2}.get(e["source"], 1)
            # 古典例句没有现成译文，用批量翻译的结果补上
            cuv = e.get("cuv") or (ex_tr or {}).get(f"{r['id']}:{ei}", "")
            packed.append([
                e["greek"], e["ref"], e.get("ref_zh", ""), cuv,
                src, hits, hg,
            ])
        w["ex"] = packed
    return {k: v for k, v in w.items() if v not in ("", None, [], {}) or k in ("i", "w", "s", "z")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app-dir", default="app")
    ap.add_argument("--audio", choices=["mixed", "tts"], default="mixed",
                    help="mixed=原录音优先+TTS补齐（个人用）；tts=全部用自生成音频（公开发布用）")
    a = ap.parse_args()
    global AUDIO_MODE
    AUDIO_MODE = a.audio
    out = ROOT / a.app_dir / "public" / "data"
    out.mkdir(parents=True, exist_ok=True)

    words = json.load(open(DATA / "greek.json", encoding="utf-8"))
    examples = json.load(open(DATA / "examples.json", encoding="utf-8"))
    # 古典层（GLAUx）例句：只在词条还没有新约例句时补位
    cpath = DATA / "examples_classical.json"
    if cpath.exists():
        classical = json.load(open(cpath, encoding="utf-8"))
        added = 0
        for k, v in classical.items():
            if k not in examples:
                examples[k] = v
                added += 1
        print(f"已并入古典语料例句 {added} 条（GLAUx）")
    forms = json.load(open(DATA / "forms.json", encoding="utf-8"))
    lessons = json.load(open(DATA / "lessons.json", encoding="utf-8"))
    # 课程的中文名按**实际内容**命名：1–7 按新约词频递降、27/28/30 是纯新约、
    # 29/31 完全不含新约、8–26 是无区分特征的长尾（直接编号）。见 data/lesson-names.json
    lesson_zh = json.load(open(DATA / "lesson-names.json", encoding="utf-8"))
    # 国际音标（由 tools/build_ipa.py 用 CLTK 的 Probert 古典阿提卡重建生成）；
    # 文件缺失时只是不显示音标，不影响构建
    ipa_path = DATA / "ipa.json"
    global IPA
    IPA = json.load(open(ipa_path, encoding="utf-8")) if ipa_path.exists() else {}
    if IPA:
        print(f"已载入国际音标 {len(IPA)} 条")
    zh_path = DATA / "zh.json"
    zh = json.load(open(zh_path, encoding="utf-8")) if zh_path.exists() else {}
    if zh:
        print(f"已合并中文释义 {len(zh)} 条")
    tr_path = DATA / "zh_examples.json"
    ex_tr = json.load(open(tr_path, encoding="utf-8")) if tr_path.exists() else {}
    if ex_tr:
        print(f"已合并例句中文翻译 {len(ex_tr)} 条")

    lesson_of = {}
    for _seq, L in enumerate(lessons, 1):
        for wid in L["ids"]:
            lesson_of[wid] = L["order"]

    pub = ROOT / a.app_dir / "public"

    def audio_abs(f: str) -> Path:
        # au 可能是 'xxx.mp3'（原录音在 audio/）或 'audio-tts/xxx.m4a'
        return pub / f if "/" in f else pub / "audio" / f

    by_lesson: dict[int, list[dict]] = defaultdict(list)
    uncovered = 0
    # 新约词频排名（Frequency 字段是出现次数，这里换算成名次）
    ranked = sorted([r["frequency"] for r in words if r["frequency"]], reverse=True)
    rank_of = {c: i + 1 for i, c in enumerate(dict.fromkeys(ranked))}
    for r in words:
        o = lesson_of.get(r["id"])
        if o is None:
            continue
        wid = str(r["id"])
        w = shrink_word(r, zh.get(wid, []), examples.get(wid, []), forms.get(wid, []), ex_tr)
        if r["frequency"]:
            w["fr"] = rank_of[r["frequency"]]
        by_lesson[o].append(w)
        if not w.get("ex"):
            uncovered += 1

    # TTS 回填：原牌组没有录音的词，用 eSpeak-NG(grC) 生成的音频
    tts_path = DATA / "tts-index.json"
    tts = json.load(open(tts_path, encoding="utf-8")) if tts_path.exists() else {}
    tts_filled = 0
    for ws in by_lesson.values():
        for w in ws:
            f = tts.get(str(w["i"]))
            if AUDIO_MODE == "tts":
                # 公开发布模式：一律用自生成音频，避免再分发来源不明的原牌组录音
                if f:
                    w["au"] = f"audio-tts/{f}"
                    tts_filled += 1
                continue
            cur = w.get("au")
            # 本地模式：没有音频、或原录音文件实际不存在（牌组里有悬空引用）→ 用 TTS 顶上
            if cur and audio_abs(cur).exists():
                continue
            if f:
                w["au"] = f"audio-tts/{f}"
                tts_filled += 1
    print(f"音频（{AUDIO_MODE} 模式）处理 {tts_filled} 条")

    manifest_lessons = []
    for _seq, L in enumerate(lessons, 1):
        o = L["order"]
        ws = by_lesson.get(o, [])
        if not ws:
            continue
        name = f"lesson-{o:02d}.json"
        payload = {
            "order": o, "level": L["level"], "title": L["title"],
            "titleZh": lesson_zh.get(str(o), L["title"]),
            "words": ws,
        }
        (out / name).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        manifest_lessons.append({
            "order": o, "seq": _seq, "level": L["level"], "title": L["title"],
            "titleZh": lesson_zh.get(str(o), L["title"]),
            "file": name, "count": len(ws),
            "withExamples": sum(1 for w in ws if w.get("ex")),
            "withAudio": sum(1 for w in ws if w.get("au")),
            "withZh": sum(1 for w in ws if w.get("z")),
        })
        print(f"  第{o:02d}课 {L['level']:>3} {L['title']:<24} {len(ws):>5} 词 "
              f"例句{sum(1 for w in ws if w.get('ex')):>5} 音频{sum(1 for w in ws if w.get('au')):>5}")

    # 检索索引（词形 + 归一化键 + 首义）
    idx = []
    for r in words:
        o = lesson_of.get(r["id"])
        if o is None:
            continue
        z = zh.get(str(r["id"])) or r["senses"][:1]
        idx.append([r["id"], r["word"], fold_key(r["word"]), o,
                    (z[0] if z else "")[:40], IPA.get(str(r["id"]), "")])
    (out / "index.json").write_text(
        json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 词形反查索引：把语料中出现的屈折形式映射回词条（阅读模式点词查义用）
    fold = fold_key

    form_index: dict[str, list[int]] = {}
    for r in words:
        o = lesson_of.get(r["id"])
        if o is None:
            continue
        forms_of = forms.get(str(r["id"]), [])
        keys = {fold(r["word"])}
        for f in forms_of:
            keys.add(fold(f["form"]))
        for k in keys:
            if not k:
                continue
            form_index.setdefault(k, [r["id"], o])
    (out / "formindex.json").write_text(
        json.dumps(form_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"词形反查索引 {len(form_index)} 条")

    # 词根词缀索引
    afx = json.load(open(DATA / "affixes.json", encoding="utf-8"))
    affix = {
        "prefix": {k: v[:60] for k, v in sorted(afx["prefix"].items(), key=lambda x: -len(x[1]))},
        "suffix": {k: v[:60] for k, v in sorted(afx["suffix"].items(), key=lambda x: -len(x[1]))},
    }
    (out / "affix.json").write_text(
        json.dumps(affix, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


    # ---------------------------------------------------------------- 语法数据
    # 词尾速查 / 变格范例，全部从语料中「实际出现过的词形」聚合而来，不是抄来的表
    from collections import Counter as _C

    POS_ORDER = ["名词", "形容词", "动词", "异相动词", "定冠词", "代词",
                 "介词", "副词", "连词", "数词", "小品词"]

    def pos_of(r) -> str:
        """词性：优先用牌组标注；牌组里有一半词条 POS 为空，就按词形标签推断。
        不推断的话这些词的词形数据在语法板块里全被浪费（词尾统计只剩三分之一）。"""
        p = POS_ZH.get(r.get("pos") or "", "")
        if p:
            return p
        grams = [f.get("gram") or "" for f in forms.get(str(r["id"]), [])]
        joined = " ".join(grams)
        if not joined:
            return ""
        if any(k in joined for k in ("人称", "不定式", "分词", "现在", "未完成",
                                     "不定过去", "将来", "完成", "命令", "虚拟", "祈愿")):
            return "动词"
        if any(k in joined for k in ("主格", "属格", "与格", "宾格", "呼格")):
            genders = {g[-1] for g in grams if g and g[-1] in "阳性阴性中性"}
            return "形容词" if len(genders) >= 2 else "名词"
        return ""

    ending_groups: dict[tuple[str, str], _C] = defaultdict(_C)
    ending_examples: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    pos_inferred = 0

    for r in words:
        if lesson_of.get(r["id"]) is None:
            continue
        fms = forms.get(str(r["id"]), [])
        if not fms:
            continue
        pos = pos_of(r)
        if not pos:
            continue
        if not POS_ZH.get(r.get("pos") or "", ""):
            pos_inferred += 1
        for f in fms:
            gram = f.get("gram") or ""
            if not gram:
                continue
            key = fold_key(f["form"])
            if len(key) < 3:
                continue
            end = key[-2:]
            ending_groups[(pos, gram)][end] += f.get("count", 1)
            bucket = ending_examples[(pos, gram, end)]
            if len(bucket) < 4 and r["word"] not in bucket:
                bucket.append(r["word"])
    print(f"语法：其中 {pos_inferred} 个词条按词形标签推断了词性")

    endings_out = []
    for (pos, gram), counter in ending_groups.items():
        total = sum(counter.values())
        if total < 12:          # 样本太少的组合不进速查表，避免误导
            continue
        if len([c for c in counter.values() if c / total >= 0.01]) < 2:
            continue
        top = []
        for end, cnt in counter.most_common(8):
            if cnt / total < 0.01:      # 占比不足 1% 的不列，避免噪声
                break
            top.append({
                "end": end,
                "count": cnt,
                "share": round(cnt / total, 3),
                "words": ending_examples[(pos, gram, end)][:3],
            })
        endings_out.append({"pos": pos, "gram": gram, "total": total, "endings": top})
    endings_out.sort(key=lambda x: (POS_ORDER.index(x["pos"]) if x["pos"] in POS_ORDER else 99, -x["total"]))
    print(f"语法：词尾速查 {len(endings_out)} 组")

    # ---- 課程精选范例：按语法单元挑词，保证每个单元的变格/变位表都完整
    # 单元顺序即教学顺序：先冠词，再一次变格→二次→三次，然后形容词、代词，最后动词
    COURSE = [
        ("article", "定冠词", ["ὁ"]),
        ("noun2", "名词·第二变格", ["λόγος", "θεός", "κύριος", "ἄνθρωπος", "δοῦλος",
                                    "υἱός", "ἀδελφός", "τέκνον", "ἱμάτιον"]),
        ("noun1", "名词·第一变格", ["ἡμέρα", "φωνή", "ψυχή", "μαθητής", "προφήτης", "κριτής"]),
        ("noun3", "名词·第三变格", ["πατήρ", "μήτηρ", "πνεῦμα", "σάρξ", "πόλις", "ἀνήρ",
                                    "ὄνομα", "αἷμα", "χάρις", "γυνή", "βασιλεύς", "νύξ"]),
        ("adj", "形容词", ["πᾶς", "πολύς", "ἀγαθός", "κακός", "ἅγιος", "δίκαιος",
                           "μέγας", "πιστός", "μικρός"]),
        ("pron", "代词", ["αὐτός", "ἐγώ", "σύ", "ὅς", "οὗτος", "τίς"]),
        ("verb", "动词", ["λέγω", "ἔχω", "ποιέω", "ἀκούω", "πιστεύω", "μένω", "τηρέω",
                          "γινώσκω", "λαμβάνω", "γράφω", "βλέπω", "βάλλω", "σῴζω",
                          "διδάσκω", "ζητέω", "καλέω", "ἀγαπάω", "λύω"]),
        ("dep", "异相动词", ["γίνομαι", "ἔρχομαι", "πορεύομαι", "ἀποκρίνομαι", "δέχομαι", "βούλομαι"]),
    ]
    by_word: dict[str, dict] = {}
    for r in words:
        by_word.setdefault(r["word"], r)

    # 例句（含分词标注）→ 供「语料填空」题使用：把句中该词的真实词形挖空，让学习者填回来
    ex_data = examples          # 开头已加载（DATA/examples.json）

    def pick_examples(note_id: int, lemma: str, limit: int = 4):
        out = []
        for e in ex_data.get(str(note_id), []):
            toks = e.get("tokens") or []
            for i, tk in enumerate(toks):
                if tk.get("hit") and tk.get("lemma") == lemma and tk.get("form"):
                    if len(e.get("greek", "")) > 160:      # 太长的句子不适合做填空
                        continue
                    out.append({
                        "greek": e["greek"],
                        "zh": (e.get("cuv") or "")[:80],
                        "ref": e.get("ref_zh") or e.get("ref") or "",
                        "form": tk["form"],
                        "gram": tk.get("gram") or "",
                        "idx": i,
                    })
                    break
            if len(out) >= limit:
                break
        return out

    paradigms, missing = [], []
    for unit, bucket, lemmas in COURSE:
        for lemma in lemmas:
            r = by_word.get(lemma)
            if not r:
                missing.append(lemma)
                continue
            fms = forms.get(str(r["id"]), [])
            if len(fms) < 5:
                missing.append(lemma)
                continue
            paradigms.append({
                "word": r["word"],
                "pos": pos_of(r) or bucket,
                "unit": unit,
                "bucket": bucket,
                "senses": (zh.get(str(r["id"])) or r["senses"][:2])[:2],
                "freq": r.get("frequency"),
                "forms": [[f["form"], f.get("count", 0), f.get("gram", "")] for f in fms[:24]],
                "examples": pick_examples(r["id"], r["word"]),
            })
    with_ex = sum(1 for p in paradigms if p["examples"])
    print(f"语法：课程范例 {len(paradigms)} 个词（缺 {len(missing)}: {missing[:6]}），其中 {with_ex} 个带例句")

    # ---- 字母表（发音文件按下标对应 public/audio-tts/grammar-N.m4a）
    LETTERS = [
        ("Α", "α", "ἄλφα", "a（短）／aː（长）"), ("Β", "β", "βῆτα", "b"),
        ("Γ", "γ", "γάμμα", "g；在 γ/κ/χ 前读 ŋ"), ("Δ", "δ", "δέλτα", "d"),
        ("Ε", "ε", "ἔψιλόν", "e（短）"), ("Ζ", "ζ", "ζῆτα", "zd"),
        ("Η", "η", "ἦτα", "ɛː（长 e）"), ("Θ", "θ", "θῆτα", "tʰ（送气 t）"),
        ("Ι", "ι", "ἰῶτα", "i（短）／iː（长）"), ("Κ", "κ", "κάππα", "k"),
        ("Λ", "λ", "λάμβδα", "l"), ("Μ", "μ", "μῦ", "m"),
        ("Ν", "ν", "νῦ", "n"), ("Ξ", "ξ", "ξῖ", "ks"),
        ("Ο", "ο", "ὄμικρόν", "o（短）"), ("Π", "π", "πῖ", "p"),
        ("Ρ", "ρ", "ῥῶ", "r（颤音）"), ("Σ", "σ / ς", "σῖγμα", "s（词尾写作 ς）"),
        ("Τ", "τ", "ταῦ", "t"), ("Υ", "υ", "ὖ ψιλόν", "y（ü，长音 yː）"),
        ("Φ", "φ", "φῖ", "pʰ（送气 p）"), ("Χ", "χ", "χῖ", "kʰ（送气 k）"),
        ("Ψ", "ψ", "ψῖ", "ps"), ("Ω", "ω", "ὦ μέγα", "ɔː（长 o）"),
    ]
    letters_out = [
        {"up": u, "low": lo, "name": nm, "sound": sd, "audio": f"audio-tts/grammar-{i}.m4a"}
        for i, (u, lo, nm, sd) in enumerate(LETTERS)
    ]

    (out / "grammar.json").write_text(
        json.dumps({"endings": endings_out, "paradigms": paradigms, "letters": letters_out},
                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 教材例句：Smyth《A Greek Grammar for Colleges》(1920, 公有领域)
    # 由 tools/build_smyth.py 预先解析，这里只做搬运与体积检查
    smyth_src = DATA / "smyth.json"
    if smyth_src.exists():
        sm = json.loads(smyth_src.read_text(encoding="utf-8"))
        (out / "smyth.json").write_text(
            json.dumps(sm, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"教材：Smyth 小节 {len(sm['sections'])} 个 · 例句 {len(sm['examples'])} 条 "
              f"（{(out / 'smyth.json').stat().st_size / 1024:.0f} KB）")
    else:
        print("教材：未找到 data/smyth.json，跳过（先跑 tools/build_smyth.py）")

    # 音频清单（供「离线缓存全部资源」逐个拉取；只收实际存在的文件，避免 404）
    referenced = sorted({w["au"] for ws in by_lesson.values() for w in ws if w.get("au")})
    audio_index = [f for f in referenced
                   if audio_abs(f).exists() and audio_abs(f).stat().st_size > 400]
    dropped = len(referenced) - len(audio_index)
    (out / "audio-index.json").write_text(
        json.dumps(audio_index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"音频清单 {len(audio_index)} 个" + (f"（引用中 {dropped} 个文件缺失已剔除）" if dropped else ""))

    # 新约中希对照，按卷分片
    corpus = json.load(open(DATA / "corpus_nt.json", encoding="utf-8"))
    cdir = out / "corpus"
    cdir.mkdir(exist_ok=True)
    books: dict[str, list] = defaultdict(list)
    for v in corpus:
        books[v["be"]].append(v)
    book_manifest = []
    for i, (be, vs) in enumerate(books.items(), 1):
        name = f"nt-{i:02d}.json"
        (cdir / name).write_text(
            json.dumps({"book": vs[0]["b"], "bookEn": be, "verses": vs},
                       ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        book_manifest.append({"zh": vs[0]["b"], "en": be, "file": name, "count": len(vs)})
    # 保持正典顺序
    order = ["Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
             "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
             "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus",
             "Philemon", "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John",
             "3 John", "Jude", "Revelation"]
    book_manifest.sort(key=lambda x: order.index(x["en"]) if x["en"] in order else 99)
    for i, bm in enumerate(book_manifest):
        bm["file"] = f"nt-{i + 1:02d}.json"
    # 重命名以匹配排序
    tmp = {}
    for bm in book_manifest:
        tmp[bm["file"]] = (cdir / bm["file"]).read_text(encoding="utf-8")
    for old in list(cdir.glob("nt-*.json")):
        old.unlink()
    for i, bm in enumerate(book_manifest):
        name = f"nt-{i + 1:02d}.json"
        data = json.loads(tmp[bm["file"]])
        bm["file"] = name
        (cdir / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    manifest = {
        "version": 1,
        "source": "Anki「Ancient Greek Vocab」+ MorphGNT/SBLGNT + 和合本(CUV)",
        "totalWords": sum(m["count"] for m in manifest_lessons),
        "totalWithExamples": sum(m["withExamples"] for m in manifest_lessons),
        "totalWithAudio": sum(m["withAudio"] for m in manifest_lessons),
        "totalWithZh": sum(m["withZh"] for m in manifest_lessons),
        "levels": ["A2", "B1", "B2", "C1", "C2"],
        "lessons": manifest_lessons,
        "books": book_manifest,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")

    # 音频
    src_audio = DATA / "audio"
    dst_audio = ROOT / a.app_dir / "public" / "audio"
    if src_audio.exists():
        dst_audio.mkdir(parents=True, exist_ok=True)
        n = 0
        for p in src_audio.iterdir():
            d = dst_audio / p.name
            if not d.exists() or d.stat().st_size != p.stat().st_size:
                shutil.copy2(p, d)
            n += 1
        print(f"音频 {n} 个 -> {dst_audio}")

    print(json.dumps({k: v for k, v in manifest.items()
                      if k not in ("lessons", "books")}, ensure_ascii=False, indent=1))
    print(f"无例句词条: {uncovered}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
