#!/usr/bin/env python3
"""
单词发音的**音值**验收：音频是否真的按界面所标的 IPA 发音。

为什么需要这个测试
------------------
音色好听不等于发音正确。曾经用 facebook/mms-tts-grc 生成词音，听感自然，
但它用的是**现代希腊语**读音：把 υ 念成 [i]、η 也念成 [i]，
而界面标的是阿提卡重建的 [y]、[ɛː] —— 显示与发音不一致。

判断办法是看**同一引擎内部的对比度**（跨引擎比绝对值没有意义）：

    υ [y] 与 ι [i] 的 F2 差      η [ɛː] 与 ι [i] 的 F1 差
    eSpeak    1797 / 2242 → 445Hz ✅     688 / 290 → 398Hz ✅
    MMS       1975 / 1939 →  36Hz ❌     365 / 311 →  54Hz ❌

MMS 两项都几乎没有差别，说明它把这三个元音发成了同一个音。

用法（需要 librosa，用带该依赖的 venv）：
    tools/venvs/mms-tts/bin/python tools/pronunciation_test.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
import wave
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "app/public/audio-tts"
INDEX = ROOT / "data/tts-index.json"
GREEK = ROOT / "data/greek.json"
IPA = ROOT / "data/ipa.json"

# 低于这个差值就认为「引擎没有区分这两个元音」
MIN_F2_GAP = 150      # υ [y] 圆唇会让 F2 明显下降
MIN_F1_GAP = 120      # η [ɛː] 半开会让 F1 明显上升

pass_n = 0
fail_n = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global pass_n, fail_n
    if ok:
        pass_n += 1
    else:
        fail_n += 1
    print(f"{'✅' if ok else '❌'} {name}{'  — ' + detail if detail else ''}")


def decode(path: Path) -> np.ndarray:
    tmp = Path("/tmp/_pron_test.wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(path), str(tmp)],
                   check=True, capture_output=True)
    with wave.open(str(tmp), "rb") as f:
        a = np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").astype(np.float32) / 32768
    return a if a.ndim == 1 else a.mean(axis=1)


def trim(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    thr = max(0.01, float(np.abs(x).max()) * 0.05)
    i = np.where(np.abs(x) > thr)[0]
    return x[i[0]:i[-1] + 1] if i.size else x


def formants(x: np.ndarray, sr: int = 16000) -> tuple[float, float] | None:
    """取整段的中位 F1/F2。LPC 阶数要跟采样率匹配，16k 用 16 阶。"""
    if x.size < 1024:
        return None
    x = x - x.mean()
    pre = np.append(x[0], x[1:] - 0.97 * x[:-1])
    A = librosa.lpc(pre[:8192].astype(np.float32), order=16)
    r = np.roots(A)
    r = r[np.imag(r) >= 0]
    f = np.sort(np.angle(r) * sr / (2 * np.pi))
    f = f[(f > 200) & (f < 5000)]
    return (float(f[0]), float(f[1])) if len(f) >= 2 else None


def main() -> int:
    index = json.load(open(INDEX, encoding="utf-8"))
    greek = {str(r["id"]): (r.get("_raw") or {}).get("Greek", "") for r in json.load(open(GREEK, encoding="utf-8"))}
    ipa = json.load(open(IPA, encoding="utf-8"))

    # 只挑**单音节词**：整段基本就是一个元音，取整段共振峰才有意义。
    # （曾误挑 ἰῶτα、ῥιπή 这类多音节词，把整段的 F1/F2 中位当元音音值，
    #   结果是把多个元音混在一起量，测出来当然不对。）
    def nucleus_count(v: str) -> int:
        """
        数音标里的音节核；V+j/w 算一个（双元音）。

        ⚠️ 必须先 NFD 分解：CLTK 的输出做过 NFC，`ẹ`/`ệ` 是**预组合单字符**
        （U+1EB9 等），直接按 `e` 去匹配会漏掉，于是双音节词被当成单音节
        （实测 ὑμεῖς [hy.mệːs] 就这样混进 [y] 组）。
        """
        d = unicodedata.normalize("NFD", v)
        s0 = "".join(c for c in d if not unicodedata.combining(c) and c != ".")
        return len(re.findall(r"[ɑɛɔeoiy](?:[jw])?", s0))

    def pick(pred, n=4):
        out = []
        for wid, fn in index.items():
            w, v = greek.get(wid, ""), ipa.get(wid, "")
            if v and pred(v) and nucleus_count(v) == 1 and (AUDIO / fn).exists():
                out.append((w, fn, v))
            if len(out) >= n:
                break
        return out

    # ⚠️ 判定前一律 NFD：CLTK 输出是 NFC，`ý`/`ẹ`/`ɛ́` 都是预组合字符，
    #    直接 `'y' in v` 会匹配不到 ASCII 的 y（这个坑在取样上踩了两次）。
    def has(v: str, *chars: str) -> bool:
        d = unicodedata.normalize("NFD", v)
        return all(c in d for c in chars)

    def not_has(v: str, *chars: str) -> bool:
        d = unicodedata.normalize("NFD", v)
        return all(c not in d for c in chars)

    ys = pick(lambda v: has(v, "y") and not_has(v, "j"))          # υ = [y]，前圆唇
    is_ = pick(lambda v: has(v, "i") and not_has(v, "y"))          # ι = [i]
    es = pick(lambda v: has(v, "ɛ", "ː"))                          # η = [ɛː]，半开

    print("▶ 取样")
    print(f"  [y] 组: {', '.join(f'{w}[{v}]' for w, _, v in ys)}")
    print(f"  [i] 组: {', '.join(f'{w}[{v}]' for w, _, v in is_)}")
    print(f"  [ɛː] 组: {', '.join(f'{w}[{v}]' for w, _, v in es)}")

    def measure(group):
        vals = []
        for w, fn, v in group:
            f = formants(trim(decode(AUDIO / fn)))
            if f:
                vals.append((w, f[0], f[1]))
        return vals

    my, mi, me = measure(ys), measure(is_), measure(es)
    if not (my and mi):
        check("能取到 [y] 与 [i] 的共振峰", False, f"y={len(my)} i={len(mi)}")
        return 1

    f2_y = float(np.median([v[2] for v in my]))
    f2_i = float(np.median([v[2] for v in mi]))
    gap2 = f2_i - f2_y
    print(f"\n  F2 中位：[y] {f2_y:.0f}Hz · [i] {f2_i:.0f}Hz · 差 {gap2:.0f}Hz")
    check(f"引擎区分 υ[y] 与 ι[i]（F2 差 ≥ {MIN_F2_GAP}Hz）", gap2 >= MIN_F2_GAP,
          f"[y]={f2_y:.0f} [i]={f2_i:.0f}")

    if me and mi:
        f1_e = float(np.median([v[1] for v in me]))
        f1_i = float(np.median([v[1] for v in mi]))
        gap1 = f1_e - f1_i
        print(f"  F1 中位：[ɛː] {f1_e:.0f}Hz · [i] {f1_i:.0f}Hz · 差 {gap1:.0f}Hz")
        check(f"引擎区分 η[ɛː] 与 ι[i]（F1 差 ≥ {MIN_F1_GAP}Hz）", gap1 >= MIN_F1_GAP,
              f"[ɛː]={f1_e:.0f} [i]={f1_i:.0f}")
    else:
        check("能取到 [ɛː] 的共振峰", False)

    # 每个词都应有音频文件
    missing = [wid for wid, fn in index.items() if not (AUDIO / fn).exists()]
    check("全部词条都有音频文件", not missing, f"缺 {len(missing)} 个" if missing else "15686 个齐全")

    print(f"\n=== 结果 ===\n{'全部 %d 项通过' % pass_n if fail_n == 0 else '%d/%d 项失败' % (fail_n, pass_n + fail_n)}")
    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
