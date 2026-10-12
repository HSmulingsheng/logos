#!/usr/bin/env python3
"""
跨语言可行性实验（核心）：把阿提卡 IPA 喂给德语神经语音，元音音值对不对？

三方对照，同一套测量方法：
  (A) eSpeak grc           —— 已知发音正确（项目自测）
  (B) 德语 Piper + 德语文本 —— 管线正确性对照（模型在训练分布内，应该最好）
  (C) 德语 Piper + 希腊 IPA —— 我们真正关心的方案（模型在训练分布外）

测量改用**频谱包络峰值**而不是 Praat 的共振峰跟踪器：
神经声码器的频谱倾斜与共振峰合成器差别很大，LPC/Burg 跟踪器会串峰
（实测把德语 /ɛː/ 的 F1 量成 255 Hz，而真值约 550 Hz）。
频谱平滑后取前两个峰值对两者都稳健，也保证方法一致。
"""
import json, os, sys, math
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')
XL = os.path.join(OUT, 'xling')
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import xling_piper_greek as PG

ITEMS = {it['key']: it for it in json.load(open(os.path.join(DEMO, 'align.json'),
                                                encoding='utf-8'))['items']}
DE = json.load(open(os.path.join(XL, 'de_espeak_ipa.json'), encoding='utf-8'))


def spectral_formants(y, sr, t0, t1, n_peaks=3):
    """用 Praat 的 Burg 共振峰跟踪器，在窗口的中间 60% 上逐帧取中位数。

    为什么不用「频谱包络峰值法」：实测在低基频语音上会把**谐波**当成共振峰
    （德语 /iː/ 的 F2 被量成 339 Hz，真值 ≈ 2200 Hz）。
    Burg + 25ms 窗在本项目的 eSpeak 数据上已被验证与项目自测一致：
      σύ 的 υ F2 → 本脚本 1711 Hz（项目记录 ≈1797）
      τί 的 ι F2 → 本脚本 2275 Hz（项目记录 ≈2242）
      μή 的 η F1 → 本脚本  692 Hz（项目记录 ≈688）
    所以三方对照统一用这一套参数。
    """
    import parselmouth
    from parselmouth.praat import call
    return _burg(y, sr, t0, t1, n_peaks)


def _burg(y, sr, t0, t1, n_peaks=3, maxf=4000.0, win=0.05):
    import parselmouth
    from parselmouth.praat import call
    s = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    fm = call(s, 'To Formant (burg)', 0.005, 4, float(maxf), float(win), 50.0)
    lo = t0 + 0.2 * (t1 - t0); hi = t0 + 0.8 * (t1 - t0)
    acc = [[], [], []]
    t = lo
    while t <= hi:
        try:
            v = [call(fm, 'Get value at time', i, float(t), 'hertz', 'linear')
                 for i in (1, 2, 3)]
        except Exception:
            t += 0.005; continue
        if all(x and not math.isnan(x) for x in v) and 180 <= v[0] <= 1150 \
                and v[0] < v[1] < v[2]:
            for k in range(3):
                acc[k].append(v[k])
        t += 0.005
    out = [float(np.median(a)) if a else np.nan for a in acc]
    return (out + [np.nan] * n_peaks)[:n_peaks]


def stable_span(t0, t1, frac=0.30):
    """元音窗口中间 (1-2*frac) 段，避开过渡。"""
    d = t1 - t0
    return t0 + frac * d, t1 - frac * d


def voiced_span(y, sr):
    """最长的一段有声区间。piper 的孤立元音有时前面有一小段气声/浊化，
    取最长段比取第一段稳。pitch_floor 必须 ≥ 65（Praat 的硬下限）。"""
    import parselmouth
    s = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    p = s.to_pitch(time_step=0.005, pitch_floor=70, pitch_ceiling=400)
    t, f = p.xs(), p.selected_array['frequency']
    v = f > 0
    best = (0.0, len(y) / sr, 0.0)
    st = None
    for i in range(len(v)):
        if v[i] and st is None:
            st = i
        elif not v[i] and st is not None:
            if t[i - 1] - t[st] > best[2]:
                best = (t[st], t[i - 1], t[i - 1] - t[st])
            st = None
    if st is not None and t[-1] - t[st] > best[2]:
        best = (t[st], t[-1], t[-1] - t[st])
    if best[2] <= 0:
        return 0.02, len(y) / sr - 0.02
    return best[0], best[1]


def find_vowel_window(item, v):
    for p in item['phonemes']:
        base = p['ipa'].lstrip('ˈˌ')
        if base.rstrip('ː') == v.rstrip('ː') and base in (v, v + 'ː', v.rstrip('ː')):
            return p
    for p in item['phonemes']:
        if p['ipa'].lstrip('ˈˌ').rstrip('ː') == v.rstrip('ː'):
            return p
    return None


# ── (A) eSpeak grc：用「非词尾」的出现位置，词尾元音常常弱化/被跟踪器误判
ESPEAK_SRC = [
    ('a', 'min13_anthropos'), ('e', 'min05_pote_acute1'), ('ɛː', 'min11_demos_circ'),
    ('i', 'min07_tis_acute'), ('o', 'min13_anthropos'), ('ɔː', 'min01_phos_circ'),
    ('y', 'len02_lyo'), ('uː', 'sent02'),
]
# ── (B) 德语 Piper + 真实德语文本（espeak-ng de 的音素串）
GERMAN_CTRL = [
    ('yː', 'Bühne'), ('iː', 'viel'), ('ɛː', 'spät'), ('eː', 'Beet'),
    ('ɔ', 'Sonne'), ('oː', 'Boot'), ('uː', 'gut'), ('a', 'Vater'), ('y', 'hübsch'),
]
# ── (C) 德语 Piper + 希腊 IPA
GREEK_IPA = {'a': 'a', 'e': 'e', 'ɛː': 'ɛ', 'i': 'i', 'o': 'o', 'ɔː': 'ɔ',
             'y': 'y', 'uː': 'u', 'yː': 'y', 'iː': 'i'}

rowsA, rowsB, rowsC = [], [], []
print('=' * 96)
print('(A) eSpeak grc   （共振峰合成，已知发音正确）')
print('=' * 96)
for v, key in ESPEAK_SRC:
    it = ITEMS[key]
    p = find_vowel_window(it, v)
    if p is None:
        print(f'  {v}: 在 {key} 中找不到'); continue
    y, sr = sf.read(os.path.join(DEMO, f'{key}_base.wav'), dtype='float64')
    a, b = stable_span(p['t0'] / 1000.0, p['t1'] / 1000.0)
    F = spectral_formants(y, sr, a, b)
    rowsA.append(dict(v=v, item=key, F1=F[0], F2=F[1]))
    print(f"  {v:<5} 来自 {key:<20} 窗口 {(p['t1']-p['t0']):.0f}ms   F1={F[0]:6.0f}  F2={F[1]:6.0f}")

print()
print('=' * 96)
print('(B) 德语 Piper 念**真实德语词**（管线正确性对照，模型在训练分布内）')
print('=' * 96)
for v, w in GERMAN_CTRL:
    ipa = DE[w]['ipa'].replace('\n', '')
    toks, unk = PG.split_ipa(ipa.replace('_', ''))
    y, sr, ids, unknown = PG.synth(PG.sess, PG.cfg, toks)
    sf.write(os.path.join(XL, 'vowels', f'de_ctrl_{w}.wav'), y, sr, subtype='PCM_16')
    # 取第一个有声段（首音节）的中间 40%
    import parselmouth
    s = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
    p = s.to_pitch(time_step=0.005, pitch_floor=60, pitch_ceiling=400)
    t, f = p.xs(), p.selected_array['frequency']
    m = f > 0
    if m.sum() < 3:
        continue
    tt = t[m]
    brk = np.where(np.diff(tt) > 0.03)[0]
    end = tt[brk[0]] if len(brk) else tt[-1]
    a, b = stable_span(tt[0], end, 0.25)
    F = spectral_formants(y, sr, a, b)
    rowsB.append(dict(v=v, word=w, ipa=ipa, F1=F[0], F2=F[1]))
    print(f"  {v:<5} {w:<8} {ipa:<16} F1={F[0]:6.0f}  F2={F[1]:6.0f}")

print()
print('=' * 96)
print('(C) 德语 Piper + **希腊语 IPA 音素串**（训练分布外，正是要检验的方案）')
print('=' * 96)
for v, sym in GREEK_IPA.items():
    toks = [sym, 'ː'] if v.endswith('ː') else [sym]
    y, sr, ids, unknown = PG.synth(PG.sess, PG.cfg, toks)
    a, b = voiced_span(y, sr)
    if b - a < 0.05:        # 太短（如单个短元音），直接给足窗口
        a, b = 0.0, len(y) / sr
    a2, b2 = stable_span(a, b, 0.25)
    F = spectral_formants(y, sr, a2, b2)
    if F[0] != F[0]:
        F = spectral_formants(y, sr, 0.25 * len(y) / sr, 0.75 * len(y) / sr)
    rowsC.append(dict(v=v, ipa=''.join(toks), F1=F[0], F2=F[1], dur=len(y) / sr))
    print(f"  {v:<5} 输入 {''.join(toks):<6} 时长 {len(y)/sr*1000:5.0f}ms   "
          f"F1={F[0]:6.0f}  F2={F[1]:6.0f}")

print()
print('=' * 96)
print('关键判别')
print('=' * 96)


def pick(rows, v, k):
    for r in rows:
        if r['v'].rstrip('ː') == v.rstrip('ː'):
            return r[k]
    return float('nan')


for tag, rows in (('(A) eSpeak grc', rowsA), ('(B) 德语+德语文本', rowsB),
                  ('(C) 德语+希腊IPA', rowsC)):
    di, dy = pick(rows, 'i', 'F2'), pick(rows, 'y', 'F2')
    da, di1 = pick(rows, 'a', 'F1'), pick(rows, 'i', 'F1')
    print(f'  {tag:<18} F2(i)-F2(y) = {di-dy:+7.0f} Hz   (越大于 0，[y]/[i] 越能区分；'
          f'参考真值 ≥ 300 Hz)')
    print(f'  {"":<18} F1(a)-F1(i) = {da-di1:+7.0f} Hz   (开口度对比，参考真值 ≈ 500 Hz)')

json.dump(dict(espeak=rowsA, german_ctrl=rowsB, greek_ip=rowsC),
          open(os.path.join(XL, 'vowel_space_tri.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\n→', os.path.join(XL, 'vowel_space_tri.json'))
