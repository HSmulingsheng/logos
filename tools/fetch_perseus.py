#!/usr/bin/env python3
"""从 Perseus 抓取古典希腊语文本（含英文译本）。

来源：`PerseusDL/canonical-greekLit`（CC BY-SA 4.0）与仓库内自带的英译本。
这是古典学界长期使用的标准数字语料库，不自行编造文本。

用法:
    python3 tools/fetch_perseus.py catalog          # 只看有哪些作品
    python3 tools/fetch_perseus.py fetch <清单.json>
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# 主源用 jsDelivr：它镜像 GitHub 且走 CDN，实测 2 秒响应；
# raw.githubusercontent.com 在本环境经常几十秒不响应甚至超时。
RAW = "https://cdn.jsdelivr.net/gh/PerseusDL/canonical-greekLit@master/data"
RAW_FALLBACK = "https://raw.githubusercontent.com/PerseusDL/canonical-greekLit/master/data"
API = "https://api.github.com/repos/PerseusDL/canonical-greekLit/contents/data"
OUT = Path(__file__).resolve().parent.parent / "语料调研" / "perseus"

# 按「哲学 / 文学 / 历史」三类挑作者。TLG 编号来自 Perseus 自己的目录，
# 不是猜的：先用 API 列出作者目录，再逐个读 __cts__.xml 拿作品名。
AUTHORS = {
    # 文学
    "tlg0012": "荷马", "tlg0011": "索福克勒斯", "tlg0006": "欧里庇得斯",
    "tlg0085": "埃斯库罗斯", "tlg0020": "赫西俄德", "tlg0005": "忒奥克里托斯",
    # 历史
    "tlg0016": "希罗多德", "tlg0003": "修昔底德", "tlg0032": "色诺芬",
    "tlg0543": "波利比乌斯", "tlg0004": "狄奥多罗斯",
    # 哲学
    "tlg0059": "柏拉图", "tlg0086": "亚里士多德", "tlg0557": "爱比克泰德",
    "tlg0565": "马可·奥勒留", "tlg0013": "荷马颂歌",
}


def get(url: str, tries: int = 3, timeout: int = 60) -> str | None:
    """取文本。失败时自动切到备用源重试。"""
    urls = [url]
    if RAW_FALLBACK in url.replace(RAW, ""):
        pass
    if url.startswith(RAW):
        urls.append(url.replace(RAW, RAW_FALLBACK, 1))
    for u in urls:
        for i in range(tries):
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "greek-reader/1.0"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.read().decode("utf-8", "replace")
            except Exception:                                 # noqa: BLE001
                if i < tries - 1:
                    time.sleep(1.0 * (i + 1))
    return None


def work_dirs(tlg: str) -> list[str]:
    txt = get(f"{API}/{tlg}")
    if not txt:
        return []
    try:
        return [x["name"] for x in json.loads(txt) if x["type"] == "dir"]
    except Exception:                                         # noqa: BLE001
        return []


def work_title(tlg: str, work: str) -> str:
    x = get(f"{RAW}/{tlg}/{work}/__cts__.xml")
    if not x:
        return "?"
    m = re.search(r"<ti:title[^>]*>(.*?)</ti:title>", x, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else "?"


def list_works(tlg: str, work: str) -> list[dict]:
    txt = get(f"{API}/{tlg}/{work}")
    if not txt:
        return []
    try:
        return json.loads(txt)
    except Exception:                                         # noqa: BLE001
        return []


def catalog() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict] = {}
    for tlg, zh in AUTHORS.items():
        dirs = work_dirs(tlg)
        if not dirs:
            print(f"{zh} ({tlg}): 取不到")
            continue
        with ThreadPoolExecutor(4) as ex:
            titles = list(ex.map(lambda w: work_title(tlg, w), dirs))
        result[tlg] = {"zh": zh, "works": dict(zip(dirs, titles, strict=False))}
        print(f"\n{zh} ({tlg})  共 {len(dirs)} 部")
        for w, t in list(result[tlg]["works"].items())[:12]:
            print(f"    {w}  {t[:56]}")
    (OUT / "catalog.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n目录已存到 {OUT / 'catalog.json'}")


def fetch(picks: dict[str, list[str]]) -> None:
    """picks: { "tlg0059/tlg001": "哲学", ... }"""
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for key, genre in picks.items():
        tlg, work = key.split("/")
        files = list_works(tlg, work)
        grc = [f["name"] for f in files if "grc" in f["name"] and f["name"].endswith(".xml")]
        eng = [f["name"] for f in files if "eng" in f["name"] and f["name"].endswith(".xml")]
        if not grc:
            print(f"{key}: 没有希腊语原文")
            continue
        for url, dest in ((grc[0], f"{tlg}.{work}.grc.xml"),
                          (eng[0] if eng else None, f"{tlg}.{work}.eng.xml")):
            if not url:
                continue
            body = get(f"{RAW}/{tlg}/{work}/{url}")
            if body:
                (OUT / dest).write_text(body, encoding="utf-8")
                print(f"  ✅ {key} {dest}  {len(body) // 1024} KB")
            else:
                print(f"  ❌ {key} {dest} 下载失败")
        meta[key] = {"genre": genre, "title": work_title(tlg, work),
                     "grc": f"{tlg}.{work}.grc.xml",
                     "eng": f"{tlg}.{work}.eng.xml" if eng else None}
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n已下载 {len(meta)} 部 → {OUT}")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "catalog":
        catalog()
    elif len(sys.argv) >= 3 and sys.argv[1] == "fetch":
        fetch(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")))
    else:
        print(__doc__)
