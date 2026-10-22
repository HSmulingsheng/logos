#!/usr/bin/env python3
"""把 Perseus 的 TEI 文本解析成应用内的分级阅读数据。

来源：`语料调研/perseus/`（由 tools/fetch_perseus.py 下载）
      —— PerseusDL/canonical-greekLit，CC BY-SA 4.0。

TEI 的结构在不同作品里不一样，但都遵循同一套约定：
  * 最深一层 ``div[@type='edition']``
  * 其下第一层 ``div[@subtype]`` 是 Book / book / section
  * 更深处依次是 chapter、section
希腊语与英译本使用**同一套 @n 编号**，所以按下标路径对齐即可。

产出：app/public/data/reading/<id>.json 与 reading-index.json
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "语料调研" / "perseus"
OUT = ROOT / "app" / "public" / "data" / "reading"
NS = "{http://www.tei-c.org/ns/1.0}"

# 作者/作品的希腊语与中文名。希腊语名取自文本自身的题署或标准拼写，
# 中文名用学界通行译名。
ZH = {
    "tlg0012": ("Ὅμηρος", "荷马"),
    "tlg0011": ("Σοφοκλῆς", "索福克勒斯"),
    "tlg0006": ("Εὐριπίδης", "欧里庇得斯"),
    "tlg0085": ("Αἰσχύλος", "埃斯库罗斯"),
    "tlg0020": ("Ἡσίοδος", "赫西俄德"),
    "tlg0016": ("Ἡρόδοτος", "希罗多德"),
    "tlg0003": ("Θουκυδίδης", "修昔底德"),
    "tlg0032": ("Ξενοφῶν", "色诺芬"),
    "tlg0059": ("Πλάτων", "柏拉图"),
    "tlg0086": ("Ἀριστοτέλης", "亚里士多德"),
    "tlg0557": ("Ἐπίκτητος", "爱比克泰德"),
}
TITLE_ZH = {
    "tlg0012.tlg001": "伊利亚特", "tlg0012.tlg002": "奥德赛",
    "tlg0011.tlg004": "俄狄浦斯王", "tlg0011.tlg002": "安提戈涅",
    "tlg0006.tlg003": "美狄亚", "tlg0020.tlg001": "神谱",
    # 埃斯库罗斯（tlg0085）：传世 7 剧，经 GitHub API 补入（见 fetch_perseus_api.py）
    "tlg0085.tlg001": "乞援人", "tlg0085.tlg002": "波斯人",
    "tlg0085.tlg003": "被缚的普罗米修斯", "tlg0085.tlg004": "七将攻忒拜",
    "tlg0085.tlg005": "阿伽门农", "tlg0085.tlg006": "奠酒人",
    "tlg0085.tlg007": "欧墨尼得斯",
    "tlg0016.tlg001": "历史", "tlg0003.tlg001": "伯罗奔尼撒战争史",
    "tlg0032.tlg006": "远征记", "tlg0032.tlg001": "希腊史",
    "tlg0059.tlg001": "欧悌甫戎篇", "tlg0059.tlg002": "申辩篇",
    "tlg0059.tlg003": "克里同篇", "tlg0059.tlg004": "斐多篇",
    "tlg0086.tlg010": "尼各马可伦理学", "tlg0557.tlg002": "手册",
}
GENRE_ZH = {"哲学": "哲学", "文学": "文学", "历史": "历史", "宗教": "宗教"}


def text_of(el: ET.Element, skip_head: bool = True) -> str:
    """取元素的纯文本，跳过注释元素（Perseus 在里面塞了坐标和地名注解）。"""
    out: list[str] = []

    def walk(e: ET.Element) -> None:
        tag = e.tag.replace(NS, "")
        if tag in ("note", "bibl", "ptr", "ref"):
            if e.tail:
                out.append(e.tail)
            return
        if tag == "head" and skip_head:
            if e.tail:
                out.append(e.tail)
            return
        if e.text:
            out.append(e.text)
        for c in e:
            walk(c)
        if e.tail:
            out.append(e.tail)

    walk(el)
    s = "".join(out)
    s = s.replace("\u00ad", "")
    return re.sub(r"\s+", " ", s).strip()


def divs(body: ET.Element) -> ET.Element:
    """找到最外层的 edition div。"""
    for c in body:
        if c.tag == f"{NS}div":
            return c
    raise ValueError("没有 div")


def top_children(edition: ET.Element) -> list[ET.Element]:
    return [c for c in edition if c.tag == f"{NS}div"]


def has_verse(el: ET.Element) -> bool:
    """判断是否韵文体。

    ⚠️ 不能用「有没有 <l>」来判断：希罗多德、修昔底德正文里也夹着引用诗行
    （希罗多德有 151 个 <l>，却有 4347 个 <p>），那样会把整部散文误判成韵文、
    正文全丢。按两者的数量比例判断才可靠。
    """
    n_l = len(list(el.iter(f"{NS}l")))
    n_p = len(list(el.iter(f"{NS}p")))
    if n_l == 0:
        return False
    if n_p == 0:
        return True
    return n_l > n_p * 3


def verse_blocks(el: ET.Element, size: int = 20) -> list[tuple[str, str]]:
    """把诗行按固定行数分组，返回 [(起始行号, 文本)]。"""
    lines = [x for x in el.iter(f"{NS}l")]
    blocks: list[tuple[str, str]] = []
    for i in range(0, len(lines), size):
        chunk = lines[i:i + size]
        num = chunk[0].get("n") or str(i + 1)
        body = " ".join(text_of(x) for x in chunk)
        if body.strip():
            blocks.append((num, body.strip()))
    return blocks


def align_by_ratio(g_blocks: list[tuple[str, str]],
                   e_blocks: list[tuple[str, str]]) -> list[dict]:
    """按累计字符占比对齐两套不同切分的文本。

    荷马的希腊语是诗行（15687 个 <l>），英译本却是散文段落（每卷 17 个 <p>），
    没有共同的编号可对齐，只能按长度比例映射。

    ⚠️ 每个英文块**只归属一个希腊语块**（按其中点落在哪一块决定）。
    早先的写法是「区间有重叠就取」，结果一个英文段落被相邻的好几个希腊语块
    各取一遍，英译总量膨胀到实际的 4 倍。
    """
    out: list[dict] = [{"g": g, "e": ""} for _, g in g_blocks]
    if not e_blocks:
        return out
    gl = [len(g) for _, g in g_blocks]
    total_g = sum(gl) or 1
    # 每个希腊语块的累计区间
    bounds: list[tuple[float, float]] = []
    acc = 0
    for n in gl:
        bounds.append((acc / total_g, (acc + n) / total_g))
        acc += n
    el_ = [len(e) for _, e in e_blocks]
    total_e = sum(el_) or 1
    acc = 0
    for (_, e), m in zip(e_blocks, el_, strict=False):
        mid = (acc + m / 2) / total_e          # 该英文块的中点（按比例）
        acc += m
        idx = 0
        for i, (lo, hi) in enumerate(bounds):
            if mid >= lo:
                idx = i
            if lo <= mid < hi:
                idx = i
                break
        if out[idx]["e"]:
            out[idx]["e"] += " " + e
        else:
            out[idx]["e"] = e
    return out


def prose_paras(el: ET.Element) -> list[tuple[str, str]]:
    """
    散文段落：逐 <p> 成段。

    ⚠️ 曾经「没有子 div 时把本 div 内所有 <p> 并成一段」，于是色诺芬的
    《希腊史》《远征记》被压成 38 / 51 段——单段最长 25,005 字符，
    阅读时是一堵墙、翻译也没法处理。TEI 里其实有 1,149 个 <p>。
    """
    def ps_of(node: ET.Element) -> list[str]:
        return [t for t in (text_of(p).strip() for p in node.iter(f"{NS}p")) if t]

    subs = [c for c in el if c.tag == f"{NS}div"]
    if subs:
        out: list[tuple[str, str]] = []
        for c in subs:
            num = c.get("n") or ""
            ps = ps_of(c)
            if len(ps) <= 1:
                t = (ps[0] if ps else text_of(c)).strip()
                if t:
                    out.append((num, t))
            else:
                # 子 div 里还有多个 <p>：逐个成段，编号带上序号以免键冲突
                for j, t in enumerate(ps, 1):
                    out.append((f"{num}.{j}" if num else str(j), t))
        return out
    ps = ps_of(el)
    if ps:
        return [(str(i), t) for i, t in enumerate(ps, 1)]
    t = text_of(el).strip()
    return [("", t)] if t else []



def split_long_paras(paras: list[dict], limit: int = 1800) -> list[dict]:
    """
    把超长段落按句子边界切开。

    Perseus 的 TEI 偶尔整节只用一个 <p> 包住（《尼各马可伦理学》最长的有 9,341 字符），
    界面上是一堵墙，翻译时也超出单次处理的合适尺度。按句子切既好读又好译。
    希腊语与英译各自按自己的句子边界切，再按累计长度比例配对。
    """
    out: list[dict] = []
    for p in paras:
        g, e = p.get("g") or "", p.get("e") or ""
        if len(g) <= limit:
            out.append(p)
            continue

        def sentences(t: str) -> list[str]:
            # 在句末标点（. ; · ! ?）后切，保留标点
            parts = re.split(r"(?<=[.;·!?])\s+", t)
            chunks: list[str] = []
            for part in parts:
                if chunks and len(chunks[-1]) + len(part) <= limit:
                    chunks[-1] += " " + part
                else:
                    chunks.append(part)
            return [c for c in chunks if c.strip()]

        gs = sentences(g)
        es = sentences(e) if e else []
        if len(gs) <= 1:
            out.append(p)
            continue
        if len(es) == len(gs):
            out.extend({"g": a, "e": b} for a, b in zip(gs, es, strict=False))
        elif es:
            out.extend(align_by_ratio([(str(i), a) for i, a in enumerate(gs)],
                                      [(str(i), b) for i, b in enumerate(es)]))
        else:
            out.extend({"g": a, "e": ""} for a in gs)
    return out

def build(work_id: str, info: dict) -> dict | None:
    grc_path = SRC / info["grc"]
    eng_path = SRC / info.get("eng") or ""
    if not grc_path.exists():
        print(f"  跳过 {work_id}: 缺希腊语原文")
        return None
    # work_id 形如 "tlg0012/tlg001"（斜杠），而 ZH / TITLE_ZH 的键用点号。
    # 早先用 split(".")[0] 取不到作者号，作者名就回退成了整串 id。
    key = work_id.replace("/", ".")
    tlg = key.split(".")[0]
    grc_body = ET.parse(grc_path).getroot().find(f"{NS}text/{NS}body")
    eng_body = ET.parse(eng_path).getroot().find(f"{NS}text/{NS}body") if eng_path.exists() else None
    grc_top = top_children(divs(grc_body))
    eng_top = top_children(divs(eng_body)) if eng_body is not None else []
    # 只登记**非空**的 @n。否则当所有章节的 @n 都是 None 时，
    # 字典里只剩一个空串键，查找会「成功」地返回最后一章，
    # 位置回退永远不会触发（《安提戈涅》就是这个坑）。
    eng_by_n = {c.get("n"): c for c in eng_top if c.get("n")}
    # 有些作品的英译本章节编号与希腊语不同（如《安提戈涅》），
    # 按编号找不到时退回按位置匹配 —— 两版顺序一致，位置对齐是可靠的
    eng_by_pos = {i: c for i, c in enumerate(eng_top)}

    verse = any(has_verse(c) for c in grc_top[:3])
    chapters = []
    epi_n = 0

    # ── 兜底：edition div 下面一个子 div 都没有的作品
    #
    # 赫西俄德《神谱》就是这样：1,042 个 <l> 诗行直接挂在 edition 上，
    # `top_children()` 返回空 → chapters 为空 → build() 返回 None →
    # **整部作品被静默跳过**（16 部源只建出 15 部，而且没有任何提示）。
    #
    # 这里按行数切节（每 100 行一节），节内每 10 行合一段。
    # 既不会只剩一个巨型章节，也不至于一行一段太碎。
    if not grc_top:
        flat = [(l.get("n") or str(i + 1), text_of(l))
                for i, l in enumerate(grc_body.iter(f"{NS}l"))]
        flat = [(n, t) for n, t in flat if t.strip()]
        if not flat:
            return None
        eng_flat = [(l.get("n") or str(i + 1), text_of(l))
                    for i, l in enumerate(eng_body.iter(f"{NS}l"))] if eng_body is not None else []
        e_by_n = {n: t for n, t in eng_flat}
        e_by_pos = [t for _, t in eng_flat]
        # 一行一个 <l> 的作品显然是韵文。`verse` 之前是按 grc_top[:3] 算的，
        # 而这里 grc_top 是空的，所以会被误判成散文（《神谱》曾显示「散文」）。
        verse = True
        PER_CH, LINES_PER_PARA = 100, 10
        for start in range(0, len(flat), PER_CH):
            chunk = flat[start:start + PER_CH]
            paras = []
            for k in range(0, len(chunk), LINES_PER_PARA):
                group = chunk[k:k + LINES_PER_PARA]
                g = " ".join(t for _, t in group)
                e = " ".join(
                    e_by_n.get(n) or (e_by_pos[start + k + j] if start + k + j < len(e_by_pos) else "")
                    for j, (n, _) in enumerate(group)
                ).strip()
                paras.append({"g": g, "e": e})
            paras = split_long_paras([q for q in paras if q["g"].strip()])
            if not paras:
                continue
            a, b = start + 1, start + len(chunk)
            chapters.append({
                "n": str(a), "label": f"行 {a}–{b}", "paras": paras, "subtype": "lines",
            })
        _flat_done = True
    else:
        _flat_done = False
    choral_n = 0
    if not _flat_done:
      for i, c in enumerate(grc_top):
        sub_i = (c.get("subtype") or "").lower()
        if sub_i == "episode":
            epi_n += 1
        elif sub_i in ("choral", "kommos", "parodos", "exodos"):
            choral_n += 1
        n = c.get("n") or ""
        eng = eng_by_n.get(n) if n else None
        if eng is None and len(eng_top) == len(grc_top):
            eng = eng_by_pos.get(i)
        if verse:
            gb = verse_blocks(c)
            eb_lines = verse_blocks(eng) if eng is not None else []
            if eb_lines and sum(1 for num, _ in gb if num in dict(eb_lines)) >= len(gb) * 0.5:
                # 英译也有诗行号且能对上：按行号对齐
                e_by = dict(eb_lines)
                paras = [{"g": g, "e": e_by.get(num, "")} for num, g in gb]
            elif eng is not None:
                # 英译切分不同（散文段落，或诗行号对不上），按累计长度比例对齐。
                # 优先用它自己的诗行，没有则用段落。
                eb = eb_lines or [(str(i), text_of(p)) for i, p in enumerate(eng.iter(f"{NS}p"))]
                eb = [(a, b) for a, b in eb if b.strip()]
                paras = align_by_ratio(gb, eb) if eb else [{"g": g, "e": ""} for _, g in gb]
            else:
                paras = [{"g": g, "e": ""} for _, g in gb]
        else:
            gp = prose_paras(c)
            ep = prose_paras(eng) if eng is not None else []
            e_by = {a: b for a, b in ep}
            if len(gp) == len(ep) and gp:
                paras = [{"g": g, "e": e} for (_, g), (_, e) in zip(gp, ep, strict=False)]
            elif ep and len(gp) != len(ep):
                # 两边切段方式不同（如希英版本段落划分不一致）时按累计长度比例对齐；
                # 只按编号查会大量落空
                paras = align_by_ratio(gp, ep)
            else:
                paras = [{"g": g, "e": e_by.get(num, "")} for num, g in gp]
        paras = split_long_paras(paras)
        gtext = " ".join(p["g"] for p in paras)
        if len(gtext) < 20:
            continue
        # 章节标签。古典作品的层级含义差别很大：史书/史诗是「卷」，柏拉图是
        # 「节」，而悲剧用的是 episode / strophe / antistrophe / choral 这套戏剧结构，
        # 且这些 div 的 n 常为空——曾经一律兜底成「全文」，于是《俄狄浦斯王》的
        # 章节列表出现 15 个一模一样的「全文」按钮。
        sub = (c.get("subtype") or "").lower()
        if sub == "book":
            label = f"卷 {n}" if n else f"卷 {len(chapters) + 1}"
        elif sub == "episode":
            label = f"第 {epi_n} 场"
        elif sub in ("strophe", "antistrophe"):
            side = "正" if sub == "strophe" else "反"
            label = f"第 {n} 曲（{side}）" if n else f"合唱歌（{side}）"
        elif sub in ("choral", "kommos", "parodos", "exodos"):
            base = {"choral": "合唱歌", "kommos": "哀歌", "parodos": "进场歌", "exodos": "退场"}[sub]
            # 悲剧里合唱歌有好几段，不编号就会出现一串相同的「合唱歌」按钮
            label = f"第 {choral_n} {base}" if choral_n else base
        elif sub == "close":
            label = "收场"
        elif n:
            label = f"第 {n} 节"
        else:
            label = f"第 {len(chapters) + 1} 部分"
        chapters.append({"n": n, "label": label, "paras": paras, "subtype": sub})

    if not chapters:
        return None
    author_grc, author_zh = ZH.get(tlg, (key, key))
    return {
        "id": work_id,
        "genre": info["genre"],
        "author": author_grc,
        "authorZh": author_zh,
        "title": info["title"],
        "titleZh": TITLE_ZH.get(key, info["title"]),
        "source": "Perseus Digital Library (PerseusDL/canonical-greekLit)",
        "license": "CC BY-SA 4.0",
        "verse": verse,
        "chapters": chapters,
    }


def main() -> None:
    meta = json.loads((SRC / "meta.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for work_id, info in meta.items():
        data = build(work_id, info)
        if not data:
            continue
        (OUT / f"{work_id.replace(chr(47), chr(46))}.json").write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        nch = len(data["chapters"])
        npar = sum(len(c["paras"]) for c in data["chapters"])
        gchars = sum(len(p["g"]) for c in data["chapters"] for p in c["paras"])
        echars = sum(len(p["e"]) for c in data["chapters"] for p in c["paras"])
        size = (OUT / f"{work_id.replace(chr(47), chr(46))}.json").stat().st_size
        index.append({"id": work_id, "genre": data["genre"], "author": data["author"],
                      "authorZh": data["authorZh"], "title": data["title"],
                      "titleZh": data["titleZh"], "verse": data["verse"],
                      "chapters": nch, "paras": npar,
                      "source": data["source"], "license": data["license"]})
        print(f"  {work_id:<18} {data['authorZh']}《{data['titleZh']}》 "
              f"{nch} 章 / {npar} 段 · 希 {gchars // 1000}k 字 · 英 {echars // 1000}k 字 · {size // 1024} KB"
              + ("  ⚠️ 缺英译" if echars == 0 else ""))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n共 {len(index)} 部 → {OUT}")


if __name__ == "__main__":
    main()
