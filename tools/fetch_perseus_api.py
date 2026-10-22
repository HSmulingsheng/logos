#!/usr/bin/env python3
"""
通过 **GitHub Contents API** 抓取 Perseus 的 TEI 文本。

## 为什么不直接下载原始文件

`raw.githubusercontent.com` 在本机**经常几十秒不响应甚至超时**，
`cdn.jsdelivr.net` 对 `PerseusDL/canonical-greekLit` 直接返回
`403 Package size exceeded the configured limit of 50 MB`（仓库 >50MB）。

而 `api.github.com` 是**通的**（实测 1.4s 响应）。它的 `contents` 端点会把
小于 1MB 的文件内容 base64 内联返回，正好够用（单个剧本 100~200KB）。

代价是**速率限制**：未认证 60 次/小时。每部作品要 2 次（grc + eng），
所以一次跑 20 部上下就会用光，得等一小时重置。脚本会在额度不足时停下。

## 用法

    python3 tools/fetch_perseus_api.py --author tlg0085          # 埃斯库罗斯全部
    python3 tools/fetch_perseus_api.py --author tlg0085 --limit 2
    python3 tools/fetch_perseus_api.py --list tlg0085            # 只列作品名
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "语料调研" / "perseus"
API = "https://api.github.com/repos/PerseusDL/canonical-greekLit/contents/data"
NS_TEI = "{http://www.tei-c.org/ns/1.0}"


def api(url: str, tries: int = 3) -> dict | list | None:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "greek-reader/1.0",
                "Accept": "application/vnd.github+json",
            })
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (403, 429):
                print(f"  ⚠️ 速率限制（HTTP {e.code}），停下")
                return None
            if e.code == 404:
                return None
        except Exception:                                     # noqa: BLE001
            pass
        if i < tries - 1:
            time.sleep(2.0 * (i + 1))
    return None


def rate() -> tuple[int, int]:
    d = api("https://api.github.com/rate_limit")
    if not isinstance(d, dict):
        return (0, 0)
    c = d["resources"]["core"]
    return (c["remaining"], c["limit"])


def list_works(tlg: str) -> list[tuple[str, str, str]]:
    """返回 [(work_dir, title_en, url_cts)]"""
    d = api(f"{API}/{tlg}")
    if not isinstance(d, list):
        return []
    out = []
    for x in d:
        if x["type"] != "dir":
            continue
        work = x["name"]
        cts = api(f"{API}/{tlg}/{work}/__cts__.xml")
        title = work
        if isinstance(cts, dict) and cts.get("content"):
            xml = base64.b64decode(cts["content"]).decode("utf-8", "replace")
            import re
            m = re.search(r"<ti:title[^>]*>(.*?)</ti:title>", xml, re.S)
            if m:
                title = " ".join(m.group(1).split())
        out.append((work, title, f"{tlg}/{work}"))
    return out


def pick_files(tlg: str, work: str) -> dict[str, str]:
    """在该作品目录里找 grc / eng 的 edition 文件"""
    d = api(f"{API}/{tlg}/{work}")
    if not isinstance(d, list):
        return {}
    got = {}
    for x in d:
        n = x["name"]
        if not n.endswith(".xml") or "__cts__" in n:
            continue
        if ".perseus-grc" in n:
            got["grc"] = n
        elif ".perseus-eng" in n:
            got["eng"] = n
    return got


def download(tlg: str, work: str, name: str) -> bool:
    d = api(f"{API}/{tlg}/{work}/{name}")
    if not isinstance(d, dict):
        return False
    if d.get("content"):
        raw = base64.b64decode(d["content"])
    elif d.get("download_url"):
        # >1MB 时 API 不内联内容，只能退回原始地址（大概率超时）
        try:
            req = urllib.request.Request(d["download_url"], headers={"User-Agent": "greek-reader/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
        except Exception:                                     # noqa: BLE001
            return False
    else:
        return False
    OUT.mkdir(parents=True, exist_ok=True)
    dst = OUT / name.replace(".perseus-grc2", "").replace(".perseus-eng2", "")
    # 统一成 <tlg>.<work>.grc.xml / .eng.xml，与既有文件的命名一致
    stem = name.split(".")[0] + "." + name.split(".")[1]
    kind = "grc" if ".perseus-grc" in name else "eng"
    dst = OUT / f"{stem}.{kind}.xml"
    dst.write_bytes(raw)
    print(f"    ✅ {dst.name}  {len(raw)/1024:.0f}KB")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--author", help="TLG 作者编号，如 tlg0085")
    ap.add_argument("--list", help="只列作品名")
    ap.add_argument("--limit", type=int, default=99)
    ap.add_argument("--genre", default="文学", help="写进 meta.json 的体裁")
    a = ap.parse_args()

    tlg = a.list or a.author
    if not tlg:
        ap.print_help()
        return 2

    rem, lim = rate()
    print(f"  API 额度 {rem}/{lim}")

    works = list_works(tlg)
    print(f"  {tlg} 共 {len(works)} 部:")
    for w, t, _ in works:
        print(f"    {w}  {t}")

    if a.list:
        return 0

    meta_path = OUT / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    done = 0
    for work, title, wid in works:
        if done >= a.limit:
            break
        rem, _ = rate()
        if rem < 4:
            print(f"  ⚠️ 额度只剩 {rem}，停下，等一小时后再跑")
            break
        print(f"  ▸ {wid}  {title}")
        files = pick_files(tlg, work)
        if not files:
            print("    ⚠️ 找不到 edition 文件")
            continue
        ok = False
        for kind in ("grc", "eng"):
            if kind in files:
                ok = download(tlg, work, files[kind]) or ok
        if ok:
            stem = wid.replace("/", ".")
            meta[wid] = {
                "genre": a.genre, "title": title,
                "grc": f"{stem}.grc.xml", "eng": f"{stem}.eng.xml",
            }
            done += 1
        time.sleep(0.4)

    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  ✅ 完成 {done} 部 · meta.json 现有 {len(meta)} 部")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
