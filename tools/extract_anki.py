#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Anki collection.anki2 抽取古希腊语（Koine / 新约）与拉丁语词卡，
产出结构化 JSON + 需要用的媒体文件。

用法:
    python3 tools/extract_anki.py [--collection PATH] [--out DIR]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

GREEK_MID = 1627330639348
LATIN_MID = 1421950416556

GREEK_FIELDS = [
    "Greek", "Label", "Definition", "Frequency", "Strongs", "PartOfSpeech",
    "Related", "Notes", "Language", "Enhanced1", "AltWord", "AltEnhanced",
    "AltStrongs", "Alt3", "AltFreq", "AltURL", "Audio", "URL",
    "Components", "Verse", "Reference", "LogeionURL",
]
LATIN_FIELDS = [
    "Latin", "English", "Audio", "Gender", "Derivatives", "Notes",
]

SND_RE = re.compile(r"\[sound:([^\]]+)\]")
HTML_RE = re.compile(r"<[^>]+>")


def strip_html(s: str) -> str:
    s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    s = re.sub(r"&nbsp;", " ", s)
    s = re.sub(r"&amp;", "&", s)
    s = re.sub(r"&lt;", "<", s)
    s = re.sub(r"&gt;", ">", s)
    s = HTML_RE.sub("", s)
    return s.strip()


def split_field(s: str) -> list[str]:
    """把 Anki 字段里的 <br>/; 分隔的多义项拆成列表。"""
    s = strip_html(s)
    parts: list[str] = []
    for line in s.split("\n"):
        for chunk in line.split(";"):
            chunk = chunk.strip(" ,;·")
            if chunk:
                parts.append(chunk)
    # 去重保序
    seen, out = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def is_greek(s: str) -> bool:
    return any("\u0370" <= ch <= "\u03ff" or "\u1f00" <= ch <= "\u1fff" for ch in s)


def nfd_key(s: str) -> str:
    """去掉变音符号做检索键（古希腊语 polytonic 去重/搜索用）。"""
    d = unicodedata.normalize("NFD", s)
    return "".join(c for c in d if not unicodedata.combining(c)).lower()


def connect(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path))
    # Anki 用自定义 collation
    con.create_collation(
        "unicase", lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold())
    )
    return con


def parse_level(deck_path: str) -> tuple[str, int | None, str]:
    """'Ancient Greek Vocab\x1fA2 - Intro to NT\x1f01: Core words' -> ('A2', 1, 'Core words')"""
    parts = deck_path.split("\x1f")
    level = ""
    order = None
    title = ""
    if len(parts) >= 3:
        level = parts[-2].split(" - ")[0].strip()
        m = re.match(r"^(\d+)\s*:\s*(.*)$", parts[-1])
        if m:
            order = int(m.group(1))
            title = m.group(2)
        else:
            title = parts[-1]
    elif parts:
        title = parts[-1]
    return level, order, title


def extract(collection: Path, outdir: Path, media: Path) -> dict:
    con = connect(collection)
    cur = con.cursor()
    decks = dict(cur.execute("select id, name from decks"))

    # note id -> deck ids
    note_decks: dict[int, list[int]] = defaultdict(list)
    for nid, did in cur.execute("select nid, did from cards"):
        note_decks[nid].append(did)

    stats = {}

    def build(mid: int, fields: list[str], key: str, kind: str) -> list[dict]:
        used_media: set[str] = set()
        out: list[dict] = []
        for nid, flds, tags in cur.execute(
            "select id, flds, tags from notes where mid=?", (mid,)
        ):
            vals = flds.split("\x1f")
            vals += [""] * (len(fields) - len(vals))
            raw = dict(zip(fields, vals))
            rec: dict = {"id": nid, "_raw": raw, "tags": tags.split()}

            dids = note_decks.get(nid, [])
            dp = decks.get(dids[0], "") if dids else ""
            level, order, title = parse_level(dp)
            rec["deck"] = {
                "path": dp,
                "level": level,
                "order": order,
                "title": title,
            }
            rec["decks"] = [decks.get(d, str(d)) for d in dids]

            if kind == "greek":
                rec["word"] = strip_html(raw["Greek"])
                rec["enhanced"] = strip_html(raw["Enhanced1"]) or rec["word"]
                rec["senses"] = split_field(raw["Definition"])
                rec["frequency"] = int(raw["Frequency"]) if raw["Frequency"].strip().isdigit() else None
                rec["strongs"] = raw["Strongs"].strip()
                rec["pos"] = raw["PartOfSpeech"].strip()
                rec["related"] = [x.strip() for x in strip_html(raw["Related"]).split(",") if x.strip()]
                rec["notes"] = strip_html(raw["Notes"])
                rec["components"] = [
                    x.strip() for x in strip_html(raw["Components"]).split(",") if x.strip()
                ]
                rec["verse"] = strip_html(raw["Verse"])
                rec["reference"] = strip_html(raw["Reference"])
                rec["biblehub"] = raw["URL"].strip()
                rec["logeion"] = raw["LogeionURL"].strip()
                alt = []
                for w, e, s in [
                    (raw["AltWord"], raw["AltEnhanced"], raw["AltStrongs"]),
                    (raw["Alt3"], "", ""),
                ]:
                    if strip_html(w):
                        alt.append({"word": strip_html(w), "enhanced": strip_html(e) or strip_html(w), "strongs": s.strip()})
                rec["alt_forms"] = alt
                rec["extra"] = {
                    "label": strip_html(raw["Label"]),
                    "language": strip_html(raw["Language"]),
                    "alt_url": raw["AltURL"].strip(),
                    "alt_freq": raw["AltFreq"].strip(),
                }
            else:
                rec["word"] = strip_html(raw["Latin"])
                rec["senses"] = split_field(raw["English"])
                rec["gender"] = strip_html(raw["Gender"])
                rec["related"] = [x.strip() for x in strip_html(raw["Derivatives"]).split(",") if x.strip()]
                rec["notes"] = strip_html(raw["Notes"])

            # 音频
            m = SND_RE.search(raw["Audio"])
            rec["audio"] = m.group(1) if m else ""
            if rec["audio"]:
                used_media.add(rec["audio"])
            rec["search"] = nfd_key(rec["word"])
            out.append(rec)

        # 收集词根词缀（来自 tags）
        pref, suf, misc = defaultdict(list), defaultdict(list), defaultdict(list)
        for r in out:
            for t in r["tags"]:
                if t.startswith("pref:"):
                    pref[t[5:]].append(r["id"])
                elif t.startswith("suf:"):
                    suf[t[4:]].append(r["id"])
        stats[kind] = {
            "notes": len(out),
            "with_audio": sum(1 for r in out if r["audio"]),
            "media": used_media,
        }
        return out

    greek = build(GREEK_MID, GREEK_FIELDS, "greek", "greek")
    latin = build(LATIN_MID, LATIN_FIELDS, "latin", "latin")

    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "greek.json").write_text(
        json.dumps(greek, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (outdir / "latin.json").write_text(
        json.dumps(latin, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    # 词根词缀索引
    affix: dict[str, dict] = {"prefix": defaultdict(list), "suffix": defaultdict(list)}
    for r in greek:
        for t in r["tags"]:
            if t.startswith("pref:"):
                affix["prefix"][t[5:]].append(r["id"])
            elif t.startswith("suf:"):
                affix["suffix"][t[4:]].append(r["id"])
    (outdir / "affixes.json").write_text(
        json.dumps(affix, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    # 课程结构
    lessons: dict[str, dict] = {}
    for r in greek:
        d = r["deck"]
        if not d["order"]:
            continue
        k = str(d["order"])
        L = lessons.setdefault(
            k, {"order": d["order"], "title": d["title"], "level": d["level"], "ids": []}
        )
        L["ids"].append(r["id"])
    for L in lessons.values():
        L["ids"].sort()
        L["count"] = len(L["ids"])
    (outdir / "lessons.json").write_text(
        json.dumps(sorted(lessons.values(), key=lambda x: x["order"]), ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    # 复制音频
    if media and media.exists():
        adir = outdir / "audio"
        adir.mkdir(exist_ok=True)
        need = stats["greek"]["media"] | stats["latin"]["media"]
        copied = 0
        for name in sorted(need):
            src = media / name
            if src.exists():
                dst = adir / name
                if not dst.exists() or dst.stat().st_size != src.stat().st_size:
                    shutil.copy2(src, dst)
                copied += 1
        stats["audio_copied"] = copied
        stats["audio_missing"] = sorted(n for n in need if not (media / n).exists())

    stats["greek"]["media"] = len(stats["greek"]["media"])
    stats["latin"]["media"] = len(stats["latin"]["media"])
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default="_ankibak/collection.anki2")
    ap.add_argument("--media", default=str(Path.home() / "Library/Application Support/Anki2/账户 1/collection.media"))
    ap.add_argument("--out", default="data")
    a = ap.parse_args()
    stats = extract(Path(a.collection), Path(a.out), Path(a.media))
    print(json.dumps({k: v for k, v in stats.items() if k != "audio_missing"}, ensure_ascii=False, indent=1))
    if stats.get("audio_missing"):
        print("missing audio:", stats["audio_missing"][:10], "...", len(stats["audio_missing"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
