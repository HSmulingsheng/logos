#!/usr/bin/env python3
"""
用 LangIpa 的 Klatt 合成器重新生成全部单词音频（按 IPA 逐音素）。

## 为什么要换掉 eSpeak

eSpeak 的 `grc` 声音其实是**借现代希腊语的音素表**：φ/θ/χ 一律读成擦音
[f θ x]。此前的做法是在文本上做替换（φ→πʰ）绕过，属于打补丁。

LangIpa 是 Klatt 式共振峰合成器，**按 IPA 逐个音素合成**：
[pʰ tʰ kʰ]、[y]、[ɛː] 都是直接指定的参数，不需要绕。

## 比 eSpeak 管线好在哪

| | eSpeak + PSOLA | LangIpa |
|---|---|---|
| 音素 | 现代希腊语近似 | 按 IPA 直接指定 |
| 音高重音 | 合成后靠 PSOLA 改，有时间拉伸与基音标记误差 | **直接写进 f0 曲线** |
| 长音 | 靠 durAnchors 补偿 | 直接给时长 |

`glottal()` 里 `f = np.asarray(f0, float)` / `if f.ndim == 0` —— 说明**它本来就支持
逐采样的 f0 数组**，这是能直接做重音的关键。

## 音高重音怎么画

IPA 里重音已经标在元音上（结合尖音符 ´ / 结合抑扬符 ̂），音节用 `.` 分隔：

  acute      → 该音节内升到 +peak，然后维持
  circumflex → 升到 +peak 再回落到 -drop（真正的「升降」）
  grave/无   → 基线，逐音节缓慢下降
  末音节     → 再降一档（陈述句的收尾）

## 用法

    python3 tools/gen_word_audio_langipa.py --limit 20          # 先试 20 个
    python3 tools/gen_word_audio_langipa.py --word λόγος        # 单个词，输出到 /tmp
    python3 tools/gen_word_audio_langipa.py                     # 全量（约 15,686 个）
    python3 tools/gen_word_audio_langipa.py --jobs 8 --force
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT.parent / "LangIpa_SourceKit" / "LangIpa_Generator.py"
OUT = ROOT / "app" / "public" / "audio-tts"
SR = 22050

# ---------------------------------------------------------------- 音素表

VOWELS = set("ɑaeiouyɛɔəɐæɨʉɯɪʏʊɤɘɵɜɞʌɶɒ")
# 时长（秒）。元音长短由 `ː` 决定；辅音按类别给。
# 时长（秒）。第一版偏快（λόγος 只有 0.32s，而 eSpeak 版约 0.7s），
# 对学习用途太赶，整体放慢约 30%。元音长短由 `ː` 决定。
DUR_LONG_VOWEL = 0.190
DUR_SHORT_VOWEL = 0.110
DUR = {
    "plosive": 0.088,
    "fricative": 0.115,
    "nasal": 0.075,
    "trill": 0.065,
    "tap": 0.050,
    "approximant": 0.065,
    "lat_approximant": 0.065,
    "affricate": 0.115,
}

# 复合辅音：IPA 里用两个字母写的，按单元处理（ζ = [zd]）
DIGRAPHS = {"zd": ("zd", "fricative_voiced", "alveolar", True)}

BASE_F0 = 128.0        # 与 VOWELS 表的「女声参考值」相配
ACCENT_PEAK = 0.24     # 重音音节相对基线的升幅
CIRC_RISE = 0.20
CIRC_FALL = -0.12
FINAL_DROP = -0.14
SYL_DECLINE = -0.03    # 每个音节相对前一个的轻微下降


def load_kit():
    spec = importlib.util.spec_from_file_location("langipa", KIT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["langipa"] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------- IPA 解析

def parse_ipa(ipa: str) -> list[dict]:
    """
    把 IPA 串拆成音素。返回 [{sym, kind, long, asp, accent, syl}]

    · 重音记号是**结合字符**，出现在元音之后，要回填到前一个元音
    · `.` 分音节
    · `ʰ` 紧跟辅音，表示送气
    · `ː` 表示长音
    """
    s = unicodedata.normalize("NFD", ipa)
    out: list[dict] = []
    syl = 0
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == ".":
            syl += 1
            i += 1
            continue
        if ch in "ˈˌ":
            i += 1
            continue
        if unicodedata.combining(ch):
            # 结合尖音符 = 重音；结合抑扬符 = 扬抑
            if out and out[-1]["kind"] == "vowel":
                if ch == "\u0301":
                    out[-1]["accent"] = "acute"
                elif ch == "\u0342":
                    out[-1]["accent"] = "circumflex"
                elif ch == "\u0300":
                    out[-1]["accent"] = "grave"
            i += 1
            continue
        if ch == "ʰ":
            if out:
                out[-1]["asp"] = True
            i += 1
            continue
        if ch == "ː":
            if out:
                out[-1]["long"] = True
            i += 1
            continue
        if ch == "\u0329":       # 成音节符
            i += 1
            continue
        # ζ = [zd]
        if s[i:i + 2] == "zd":
            out.append({"sym": "zd", "kind": "cons", "long": False, "asp": False,
                        "accent": None, "syl": syl})
            i += 2
            continue
        kind = "vowel" if ch in VOWELS else "cons"
        out.append({"sym": ch, "kind": kind, "long": False, "asp": False,
                    "accent": None, "syl": syl})
        i += 1
    return out


# ---------------------------------------------------------------- 合成

class Synth:
    def __init__(self, kit, sr: int = SR):
        self.kit = kit
        self.sr = sr
        self.K = kit.Klatt(sr=sr)
        self.vf = {i: (f1, f2, f3) for i, _r, f1, f2, f3 in kit.VOWELS}
        self.cons = {x[0]: x for x in kit.PULMONIC}

    def _cons_seg(self, ph: dict, t0: float) -> tuple[list, float]:
        """返回 (segs, 时长)"""
        sym = ph["sym"]
        if sym == "zd":
            d = 0.085
            return [("fricative", "alveolar", True, None, t0, t0 + d, None),
                    ("plosive", "alveolar", True, None, t0 + d, t0 + 2 * d, None)], 2 * d
        entry = self.cons.get(sym)
        if not entry:
            # 认不出的符号：当作极短的过渡，不发声但占位，避免时间轴错乱
            return [], 0.0
        _ipa, _rom, manner, place, voiced = entry
        d = DUR.get(manner, 0.07)
        if ph["asp"] and manner == "plosive":
            d += 0.045                      # 送气段：爆破之后的口部送气
        code = "AS" if ph["asp"] else None
        return [(manner, place, voiced, code, t0, t0 + d, None)], d

    def render_word(self, ipa: str) -> np.ndarray | None:
        ph = parse_ipa(ipa)
        if not ph:
            return None
        # ── 1. 排时间轴
        segs = []
        syl_of_seg = []       # 每个元音段的音节号，用来画 f0
        t = 0.0
        for p in ph:
            if p["kind"] == "cons":
                sg, d = self._cons_seg(p, t)
                segs.extend(sg)
                t += d
            else:
                d = DUR_LONG_VOWEL if p["long"] else DUR_SHORT_VOWEL
                f = self.vf.get(p["sym"]) or self.vf["a"]
                segs.append(("vowel", "glottal", True, None, t, t + d, f))
                syl_of_seg.append((t, t + d, p["syl"], p["accent"]))
                t += d
        if t <= 0 or not segs:
            return None
        total = t

        # ── 2. 画 f0 曲线（逐采样）
        n = max(128, int(total * self.sr))
        tt = np.arange(n) / self.sr
        # 基线：逐音节轻微下降
        nsyl = max(1, max(s[2] for s in syl_of_seg) + 1)
        base = np.full(n, BASE_F0)
        for k in range(nsyl):
            m = tt >= (total * k / nsyl)
            base[m] = BASE_F0 * (1.0 + SYL_DECLINE * k)
        f0 = base.copy()
        for (t0, t1, _syl, acc) in syl_of_seg:
            i0, i1 = int(t0 * self.sr), min(n, int(t1 * self.sr))
            if i1 <= i0:
                continue
            span = i1 - i0
            seg = np.linspace(0.0, 1.0, span)
            if acc == "acute":
                env = np.minimum(seg / 0.55, 1.0) * ACCENT_PEAK
            elif acc == "circumflex":
                rise = np.minimum(seg / 0.45, 1.0) * CIRC_RISE
                fall = np.maximum(0.0, (seg - 0.45) / 0.55) * CIRC_FALL
                env = rise + fall
            elif acc == "grave":
                env = np.full(span, -0.05)
            else:
                env = np.zeros(span)
            f0[i0:i1] = f0[i0:i1] * (1.0 + env)
        # 末音节收尾
        tail = int(total * 0.75 * self.sr)
        if tail < n:
            f0[tail:] *= 1.0 + FINAL_DROP * np.linspace(0, 1, n - tail)
        f0 = np.clip(f0, 60.0, 400.0)

        # ── 3. 合成
        y = self.K.render(segs, total, f0, seed=7, mods={}, noise_seed=13)
        y = np.tanh(y * 1.02) / 1.02
        p = float(np.max(np.abs(y)))
        if p > 0.98:
            y = y * (0.98 / p)
        # 首尾淡入淡出，避免爆音
        k = max(2, int(0.006 * self.sr))
        if len(y) > 2 * k:
            y[:k] *= np.linspace(0, 1, k)
            y[-k:] *= np.linspace(1, 0, k)
        return y.astype(np.float32)


def write_wav(path: Path, y: np.ndarray, sr: int = SR) -> None:
    import wave
    pcm = np.clip(y * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- 主流程

_SYNTH: Synth | None = None


def _init(kit_path: str, sr: int):
    global _SYNTH
    spec = importlib.util.spec_from_file_location("langipa", kit_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["langipa"] = mod
    spec.loader.exec_module(mod)
    _SYNTH = Synth(mod, sr)


def _work(job):
    """(word_id, ipa, out_path, force, bitrate)"""
    wid, ipa, out_path, force, bitrate = job
    out = Path(out_path)
    if not force and out.exists() and out.stat().st_size > 500:
        return ("skip", wid, "")
    try:
        y = _SYNTH.render_word(ipa)          # type: ignore[union-attr]
        if y is None or len(y) < 700:
            return ("fail", wid, "合成结果过短")
        tmp = out.with_suffix(".tmp.wav")
        write_wav(tmp, y, _SYNTH.sr)         # type: ignore[union-attr]
        r = subprocess.run(
            ["afconvert", "-f", "m4af", "-d", "aac", "-b", str(bitrate),
             "-c", "1", str(tmp), str(out)],
            capture_output=True,
        )
        tmp.unlink(missing_ok=True)
        if r.returncode != 0 or not out.exists():
            return ("fail", wid, r.stderr.decode()[:120])
        return ("ok", wid, f"{len(y)/_SYNTH.sr:.2f}s")   # type: ignore[union-attr]
    except Exception as e:                    # noqa: BLE001
        return ("fail", wid, str(e)[:120])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--word", help="只合成这一个词（输出到 /tmp）")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--bitrate", type=int, default=48000)
    ap.add_argument("--sr", type=int, default=SR)
    a = ap.parse_args()

    if not KIT.exists():
        print(f"❌ 找不到 {KIT}")
        return 2

    ipa = json.loads((ROOT / "data/ipa.json").read_text(encoding="utf-8"))
    greek = json.loads((ROOT / "data/greek.json").read_text(encoding="utf-8"))
    name = {str(r["id"]): ((r.get("_raw") or {}).get("Greek") or "") for r in greek}

    if a.word:
        wid = next((k for k, v in name.items() if v == a.word), None)
        if not wid:
            print(f"❌ 词表里没有 {a.word}")
            return 1
        s = Synth(load_kit(), a.sr)
        y = s.render_word(ipa[wid])
        if y is None:
            print("❌ 合成失败")
            return 1
        dst = Path("/tmp") / f"{a.word}.wav"
        write_wav(dst, y, a.sr)
        print(f"  ✅ {a.word} [{ipa[wid]}] → {dst}  {len(y)/a.sr:.2f}s")
        return 0

    jobs = []
    for wid, ip in ipa.items():
        if not (ip or "").strip():
            continue
        jobs.append((wid, ip, str(OUT / f"{wid}.m4a"), a.force, a.bitrate))
    if a.limit:
        jobs = jobs[:a.limit]

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"  待生成 {len(jobs)} 个 · {a.jobs} 进程 · sr={a.sr} · 码率 {a.bitrate//1000}kbps")

    import multiprocessing as mp
    ok = skip = fail = 0
    fails: list[tuple[str, str]] = []
    t0 = __import__("time").time()
    with mp.Pool(a.jobs, initializer=_init, initargs=(str(KIT), a.sr)) as pool:
        for i, (st, wid, info) in enumerate(pool.imap_unordered(_work, jobs, chunksize=8), 1):
            if st == "ok":
                ok += 1
            elif st == "skip":
                skip += 1
            else:
                fail += 1
                if len(fails) < 12:
                    fails.append((wid, info))
            if i % 500 == 0:
                el = __import__("time").time() - t0
                rate = i / max(el, 1e-6)
                print(f"  {i}/{len(jobs)}  成功 {ok} 跳过 {skip} 失败 {fail}  "
                      f"{rate:.1f} 词/秒  剩余 {(len(jobs)-i)/max(rate,1e-6)/60:.1f} 分钟")
    print(f"\n完成：成功 {ok} · 跳过 {skip} · 失败 {fail}")
    for wid, info in fails:
        print(f"  ❌ {name.get(wid, wid)}  {info}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
