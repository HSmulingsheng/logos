#!/usr/bin/env python3
"""
用神经语音模型（Meta MMS-TTS grc）重新生成单词发音。

背景与踩过的坑
--------------
公开发布不能用牌组原录音（版权未确认），所以网站词音一直用 eSpeak-NG，
音色是机械音。改用神经模型后音色大好，但**语速严重偏快**——
MMS 是为整句朗读训练的，喂孤立单词时时长预测器会给出过短的时长
（实测只有牌组原录音的 0.29 倍，听起来又急又糊）。

本脚本对症下药：
  1. 用 **PyTorch 原始模型**（时长预测器带随机噪声），而不是浏览器端那个
     为稳定句子节奏而把噪声置零的 ONNX —— 置零会让短词时长退化得更厉害。
  2. 用**官方 tokenizer**。自己手写的那版把词尾 ς 归一成 σ，
     但词表里 ς(token 23) 与 σ(token 56) 是两个不同符号，念出来是错的。
  3. 每个词**多次采样**，取时长最接近目标的那次（避开离群值）。
  4. 仍偏离目标时做**保音高时长拉伸**（librosa），把语速拉回自然区间。
  5. 目标时长：该词若有牌组原录音，就用原录音的**实际发声时长**（最忠实）；
     没有的按音节数估算。

用法：
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py --limit 30   # 试跑
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py              # 全量
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py --report     # 只评估，不写文件
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py --resume     # 断点续传
"""
from __future__ import annotations

import argparse
import glob
import json
import subprocess
import sys
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "语料调研/mms-onnx"
GREEK = ROOT / "data/greek.json"
INDEX = ROOT / "data/tts-index.json"
OUT = ROOT / "app/public/audio-tts"
AUDIO = ROOT / "app/public/audio"
PROGRESS = ROOT / "data/tts-neural-progress.json"

SR = 16000
SEED = 20261010
RATE_MIN = 0.10          # speaking_rate 下限（越小越慢）
RATE_MAX = 1.60
STRETCH_TOL = 0.12       # 偏离目标超过 12% 才拉伸
MAX_STRETCH = 2.0        # 拉伸上限，超过这个倍数人工痕迹明显


# ---------------------------------------------------------------- 目标时长
VOWELS = set("αεηιουω")


def syllables(text: str) -> int:
    """粗略数音节：去掉变音符号后连续元音算一个。"""
    base = "".join(
        c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c)
    )
    n, prev = 0, False
    for ch in base:
        v = ch in VOWELS
        if v and not prev:
            n += 1
        prev = v
    return max(1, n)


def target_seconds(text: str, orig: Path | None) -> float:
    """优先用牌组原录音的实际发声时长做目标；没有则按音节估算。"""
    if orig and orig.exists():
        d = speech_seconds(decode(orig))
        if d > 0.15:
            return float(min(1.9, max(0.30, d)))
    return float(min(1.6, max(0.36, 0.40 + 0.22 * (syllables(text) - 1))))


# ---------------------------------------------------------------- 音频工具
def decode(path: Path) -> np.ndarray:
    """任何格式 → 16k 单声道 float32（借 macOS 自带的 afconvert）。"""
    tmp = Path("/tmp/_gwa_dec.wav")
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(path), str(tmp)],
        check=True, capture_output=True,
    )
    sr, a = wavfile.read(tmp)
    a = a.astype(np.float32) / 32768.0
    return a if a.ndim == 1 else a.mean(axis=1)


def speech_seconds(a: np.ndarray, thr_ratio: float = 0.06) -> float:
    """剔除首尾静音后的实际发声时长。"""
    if a.size == 0:
        return 0.0
    thr = max(0.01, float(np.abs(a).max()) * thr_ratio)
    idx = np.where(np.abs(a) > thr)[0]
    return 0.0 if idx.size == 0 else float(idx[-1] - idx[0] + 1) / SR


def trim(x: np.ndarray, pad: float = 0.03) -> np.ndarray:
    if x.size == 0:
        return x
    thr = max(0.01, float(np.abs(x).max()) * 0.05)
    idx = np.where(np.abs(x) > thr)[0]
    if idx.size == 0:
        return x
    p = int(pad * SR)
    return x[max(0, idx[0] - p): min(x.size, idx[-1] + p)]


def write_m4a(wav: np.ndarray, dest: Path) -> None:
    tmp = dest.with_suffix(".tmp.wav")
    pcm = (np.clip(wav, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac@22050", "-b", "32000", str(tmp), str(dest)],
        check=True, capture_output=True,
    )
    tmp.unlink(missing_ok=True)


# ---------------------------------------------------------------- 主流程
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report", action="store_true", help="只评估时长，不写文件")
    ap.add_argument("--resume", action="store_true", help="跳过已生成的")
    ap.add_argument("--only", default="", help="只处理这些 id（逗号分隔），用于抽查")
    a = ap.parse_args()

    import warnings
    import torch
    warnings.filterwarnings("ignore")
    from transformers import AutoTokenizer, VitsModel
    import librosa

    tok = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    model = VitsModel.from_pretrained(str(MODEL_DIR))
    model.eval()

    rows = json.load(open(GREEK, encoding="utf-8"))
    index = json.load(open(INDEX, encoding="utf-8"))
    text_of = {str(r["id"]): (r.get("_raw") or {}).get("Greek", "") for r in rows}

    # 词条 id → 牌组原录音路径（用来定目标时长）
    orig_of: dict[str, Path] = {}
    for lf in sorted((ROOT / "app/public/data").glob("lesson-*.json")):
        try:
            d = json.load(open(lf, encoding="utf-8"))
        except Exception:
            continue
        for w in (d.get("words") if isinstance(d, dict) else d) or []:
            au = w.get("au", "")
            if au.endswith(".mp3"):
                orig_of[str(w["i"])] = AUDIO / au

    targets = [(k, v) for k, v in index.items() if text_of.get(k)]
    done: set[str] = set()
    if PROGRESS.exists():
        done = set(json.load(open(PROGRESS, encoding="utf-8")))
    if a.only:
        keep = set(a.only.split(","))
        targets = [(k, v) for k, v in targets if k in keep]
    elif a.resume:
        targets = [(k, v) for k, v in targets if k not in done]
    if a.limit:
        targets = targets[: a.limit]

    print(f"待处理 {len(targets)} 个词条"
          + ("（--report 模式，不写文件）" if a.report else ""))
    OUT.mkdir(parents=True, exist_ok=True)

    ok = skipped = failed = 0
    ratios: list[float] = []
    stretched = 0
    t0 = time.time()
    for n, (wid, fname) in enumerate(targets, 1):
        text = text_of[wid]
        if not text:
            skipped += 1
            continue
        try:
            tgt = target_seconds(text, orig_of.get(wid))

            # 「不背单词」式的时长控制：
            # 关键在 transformers 的 VitsModel.forward ——
            #     length_scale = 1.0 / self.speaking_rate
            #     duration = ceil(exp(log_duration) * ... * length_scale)
            # 它读的是**实例属性** self.speaking_rate，改 config.speaking_rate 没有任何效果
            # （这一点极易踩坑）。所以先以 1.0 测一次自然时长，反推该词需要的倍率，
            # 再按该倍率正式生成——这是模型原生的放慢方式，不会产生拉伸痕迹。
            # ⚠️ 比对的是「发声时长」而不是「总时长」——模型输出首尾带不少静音，
            #    拿总长去比会系统性地短一截（实测差 2~3 倍，是本次最大的坑）。
            model.speaking_rate = 1.0
            torch.manual_seed(SEED)
            with torch.no_grad():
                probe = model(**tok(text, return_tensors="pt")).waveform.numpy().ravel()
            d1 = speech_seconds(trim(probe))
            rate = min(RATE_MAX, max(RATE_MIN, d1 / tgt)) if d1 > 0 else 1.0

            model.speaking_rate = rate
            torch.manual_seed(SEED)
            with torch.no_grad():
                wav = model(**tok(text, return_tensors="pt")).waveform.numpy().ravel()
            wav = trim(wav)
            dur = speech_seconds(wav)

            # 极短的词受倍率下限所限仍可能偏短，做一次**轻微**保音高拉伸补齐
            if dur > 0 and abs(dur - tgt) / tgt > STRETCH_TOL:
                factor = min(MAX_STRETCH, tgt / dur)
                if abs(factor - 1.0) > 0.02:
                    wav = librosa.effects.time_stretch(wav.astype(np.float32), rate=1.0 / factor)
                    stretched += 1

            if wav.size < SR * 0.05:
                skipped += 1
                continue
            peak = float(np.abs(wav).max()) or 1.0
            wav = wav / peak * 0.95
            if not a.report:
                write_m4a(wav, OUT / fname)
            ratios.append(speech_seconds(wav) / tgt if tgt > 0 else 0.0)
            ok += 1
        except Exception as e:
            failed += 1
            print(f"  ⚠️ {wid} {text[:16]} 失败: {type(e).__name__} {e}", file=sys.stderr)

        if n % 100 == 0 or n == len(targets):
            el = time.time() - t0
            rate = n / el if el else 0
            med = float(np.median(ratios)) if ratios else 0
            left = (len(targets) - n) / rate / 60 if rate else 0
            print(f"  {n}/{len(targets)}  成功 {ok} 跳过 {skipped} 失败 {failed}"
                  f"  时长比中位 {med:.2f}x  拉伸 {stretched}  {rate:.1f} 词/秒"
                  f"  剩余 {left:.1f} 分钟", flush=True)
            if not a.report:
                json.dump(sorted(done | {k for k, _ in targets[:n]}),
                          open(PROGRESS, "w", encoding="utf-8"))

    if ratios:
        print(f"\n时长比（实际/目标）: 中位 {np.median(ratios):.2f}x · "
              f"10% 分位 {np.percentile(ratios, 10):.2f}x · "
              f"90% 分位 {np.percentile(ratios, 90):.2f}x")
    print(f"完成：成功 {ok} · 跳过 {skipped} · 失败 {failed} · 拉伸 {stretched}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
