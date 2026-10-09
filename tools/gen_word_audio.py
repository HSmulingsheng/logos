#!/usr/bin/env python3
"""
用神经语音模型（Meta MMS-TTS grc）重新生成单词发音。

背景：公开发布时不能用牌组原录音（版权未确认），所以网站上的词音一直是
eSpeak-NG 生成的机械音。本脚本改用项目里已有的神经模型重新生成，音质接近真人。

输出覆盖 app/public/audio-tts/<词条id>.m4a，编码参数与原文件保持一致
（单声道 22050Hz AAC）。带断点续传：中断后重跑会跳过已完成的词。

用法：
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py            # 全量
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py --limit 50 # 先试 50 个
    tools/venvs/mms-tts/bin/python tools/gen_word_audio.py --check     # 只统计不生成
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "语料调研/mms-onnx/model-det.onnx"
VOCAB = ROOT / "app/public/mms-grc/vocab.json"
GREEK = ROOT / "data/greek.json"
INDEX = ROOT / "data/tts-index.json"
OUT = ROOT / "app/public/audio-tts"
PROGRESS = ROOT / "data/tts-neural-progress.json"

SAMPLE_RATE = 16000


def tokenize(text: str, vocab: dict[str, int]) -> np.ndarray:
    """与浏览器端 neuralTts.ts 的 tokenize 完全一致的规则：
    小写、词尾 ς→σ、每个字符前插一个空白 token(0)、末尾补 0。"""
    s = text.lower().replace("ς", "σ")
    ids = [0]
    for ch in s:
        i = vocab.get(ch)
        if i is not None:
            ids += [i, 0]
    return np.array([ids], dtype=np.int64)


def trim_silence(x: np.ndarray) -> np.ndarray:
    """裁掉首尾静音。阈值与浏览器端一致：max(0.01, 峰值 * 0.03)。"""
    if x.size == 0:
        return x
    peak = float(np.abs(x).max())
    thr = max(0.01, peak * 0.03)
    loud = np.where(np.abs(x) > thr)[0]
    if loud.size == 0:
        return x
    # 前后各留 40ms，避免把起音削掉
    pad = int(0.04 * SAMPLE_RATE)
    a = max(0, int(loud[0]) - pad)
    b = min(x.size, int(loud[-1]) + pad)
    return x[a:b]


def write_m4a(wav: np.ndarray, dest: Path) -> None:
    """写临时 WAV，再用 macOS 自带的 afconvert 转成 m4a（与原文件同样的参数）。"""
    tmp = dest.with_suffix(".tmp.wav")
    pcm = np.clip(wav, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac@22050", "-b", "32000", str(tmp), str(dest)],
        check=True, capture_output=True,
    )
    tmp.unlink(missing_ok=True)


def clean_word(text: str) -> str:
    """模型词表里只有希腊字母，标点和空格会让 token 变空——先清掉。
    保留变音符号（重音、气号）与 iota 下标，这些对发音是必要的。"""
    keep = []
    for ch in text:
        if ch.isspace():
            continue
        if re.match(r"[\u0370-\u03FF\u1F00-\u1FFF]", ch):
            keep.append(ch)
    return "".join(keep)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个（试跑用）")
    ap.add_argument("--check", action="store_true", help="只统计，不生成")
    a = ap.parse_args()

    if not MODEL.exists():
        print(f"❌ 找不到模型 {MODEL}", file=sys.stderr)
        return 1

    vocab = json.load(open(VOCAB, encoding="utf-8"))
    rows = json.load(open(GREEK, encoding="utf-8"))
    index = json.load(open(INDEX, encoding="utf-8"))

    # 词条 id → 词形
    text_of: dict[str, str] = {}
    for r in rows:
        raw = r.get("_raw") or {}
        w = raw.get("Greek") or raw.get("Word") or ""
        if w:
            text_of[str(r["id"])] = w

    targets = [(k, v) for k, v in index.items() if text_of.get(k)]
    print(f"待生成 {len(targets)} 个词条（tts-index {len(index)} 项，能取到词形的 {len(text_of)} 个）")

    done: set[str] = set()
    if PROGRESS.exists():
        done = set(json.load(open(PROGRESS, encoding="utf-8")))
        print(f"断点续传：已完成 {len(done)} 个，跳过")

    todo = [(k, v) for k, v in targets if k not in done]
    if a.limit:
        todo = todo[: a.limit]
    if a.check:
        print(f"将生成 {len(todo)} 个（--check 模式，未实际执行）")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    print("加载模型…", flush=True)
    t0 = time.time()
    sess = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    print(f"模型就绪（{time.time()-t0:.1f}s）", flush=True)

    ok = skipped = failed = 0
    t_start = time.time()
    for n, (wid, fname) in enumerate(todo, 1):
        text = clean_word(text_of[wid])
        if not text:
            skipped += 1
            done.add(wid)
            continue
        try:
            ids = tokenize(text, vocab)
            out = sess.run(None, {"input_ids": ids, "attention_mask": np.ones_like(ids)})
            wav = np.asarray(out[0]).ravel().astype(np.float32)
            wav = trim_silence(wav)
            if wav.size < SAMPLE_RATE * 0.05:      # 太短，忽略
                skipped += 1
                done.add(wid)
                continue
            peak = float(np.abs(wav).max()) or 1.0
            wav = wav / peak * 0.95                # 统一响度
            write_m4a(wav, OUT / fname)
            ok += 1
            done.add(wid)
        except Exception as e:                     # 单个失败不该中断整批
            failed += 1
            print(f"  ⚠️ {wid} {text[:20]} 失败: {e}", file=sys.stderr)

        if n % 200 == 0 or n == len(todo):
            el = time.time() - t_start
            rate = n / el if el else 0
            eta = (len(todo) - n) / rate if rate else 0
            print(f"  {n}/{len(todo)}  成功 {ok} 跳过 {skipped} 失败 {failed}"
                  f"  {rate:.1f} 词/秒  预计剩余 {eta/60:.1f} 分钟", flush=True)
            json.dump(sorted(done), open(PROGRESS, "w", encoding="utf-8"))

    json.dump(sorted(done), open(PROGRESS, "w", encoding="utf-8"))
    print(f"\n完成：成功 {ok} · 跳过 {skipped} · 失败 {failed} · 共 {len(done)} 个已生成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
