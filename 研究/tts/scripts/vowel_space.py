#!/usr/bin/env python3
"""
元音空间对比：eSpeak grc  vs  德语 Piper 神经语音

问题：如果借一个**德语**神经网络语音来念阿提卡古希腊语，元音音值对不对？
检验方式：把两边测出的 F1/F2 画在同一张元音舌位图上。
  F1 越高 = 舌位越低（开口越大）
  F2 越高 = 舌位越前
阿提卡重建的关键是 [y]（圆唇前高）与 [i]（不圆唇前高）F2 都很高但要有区别，
以及 η=[ɛː]、ω=[ɔː] 要有真正的长音音色。

eSpeak 侧：用 align.json 里已知的「音素 → 起止时间」窗口，取窗口中点测共振峰。
Piper 侧：合成**孤立长元音**（piper 没有对齐信息，孤立元音的中点一定在元音里）。
"""
import json, os, sys, math
import numpy as np
import parselmouth
from parselmouth.praat import call
import soundfile as sf

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')
XL = os.path.join(OUT, 'xling')
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import xling_piper_greek as PG   # 复用已加载的 piper 语音

ITEMS = {it['key']: it for it in json.load(open(os.path.join(DEMO, 'align.json'),
                                                encoding='utf-8'))['items']}

# 每个目标元音：在哪个演示词的哪个音素窗口里取（(item_key, 音素下标)）
ESPEAK_SRC = {
    'a':   'min13_anthropos',
    'e':   'min05_pote_acute1',
    'ɛː':  'min11_demos_circ',
    'i':   'min07_tis_acute',
    'o':   'min12_demos_acute',
    'ɔː':  'min01_phos_circ',
    'y':   'len02_lyo',
    'uː':  'min14_anthropou',
}


def find_vowel_window(item, v):
    """在音素表里找目标元音的窗口（取第一个匹配；匹配时忽略重音前缀）。
    元音匹配要精确到「基元音相同」，避免 a 匹配到 aɪ。"""
    for p in item['phonemes']:
        base = p['ipa'].lstrip('ˈˌ')
        if base == v or base == v + 'ː' or base.rstrip('ː') == v.rstrip('ː'):
            return p
    return None
# piper 侧用的 IPA 音素串（孤立长元音）
PIPER_INPUT = {
    'a':  ['a', 'ː'], 'e': ['e', 'ː'], 'ɛː': ['ɛ', 'ː'], 'i': ['i', 'ː'],
    'o':  ['o', 'ː'], 'ɔː': ['ɔ', 'ː'], 'y': ['y', 'ː'], 'uː': ['u', 'ː'],
}


def formants(y, sr, t):
    s = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    fm = call(s, 'To Formant (burg)', 0.005, 5, 5500.0, 0.025, 50.0)
    out = []
    for i in (1, 2, 3):
        v = call(fm, 'Get value at time', i, float(t), 'hertz', 'linear')
        out.append(float(v) if v and not math.isnan(v) else np.nan)
    return out


def robust_formants(y, sr, t0, t1):
    """在 [t0,t1] 的**中间 60%** 上每 5ms 采一帧，只保留 F1 落在
    150–1150 Hz 的帧（元音范围），取中位数。单点测量对音素边界很敏感，
    实测单点法会把 [s] 或过渡段量进来（例如把 F1 量成 1383Hz）。"""
    s = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    fm = call(s, 'To Formant (burg)', 0.005, 5, 5500.0, 0.025, 50.0)
    lo = t0 + 0.2 * (t1 - t0)
    hi = t0 + 0.8 * (t1 - t0)
    F1s, F2s, F3s = [], [], []
    t = lo
    while t <= hi:
        try:
            f1 = call(fm, 'Get value at time', 1, float(t), 'hertz', 'linear')
            f2 = call(fm, 'Get value at time', 2, float(t), 'hertz', 'linear')
            f3 = call(fm, 'Get value at time', 3, float(t), 'hertz', 'linear')
        except Exception:
            t += 0.005
            continue
        if f1 and f2 and 150 <= f1 <= 1150 and 400 <= f2 <= 3500:
            F1s.append(f1); F2s.append(f2)
            if f3:
                F3s.append(f3)
        t += 0.005
    if not F1s:
        return formants(y, sr, (t0 + t1) / 2)
    return [float(np.median(F1s)), float(np.median(F2s)),
            float(np.median(F3s)) if F3s else np.nan]


def voiced_span(y, sr):
    s = parselmouth.Sound(np.asarray(y, dtype=np.float64), sampling_frequency=sr)
    p = s.to_pitch(time_step=0.005, pitch_floor=60, pitch_ceiling=400)
    t, f = p.xs(), p.selected_array['frequency']
    m = f > 0
    if m.sum() < 3:
        return 0.0, len(y) / sr
    return float(t[m][0]), float(t[m][-1])


rows = []
print('=' * 92)
print(f"{'元音':<6}{'eSpeak F1/F2':>18}{'Piper(德) F1/F2':>20}   F2 差   F1 差")
print('=' * 92)
for v, key in ESPEAK_SRC.items():
    it = ITEMS[key]
    p = find_vowel_window(it, v)
    assert p is not None, (key, v)
    yb, sr = sf.read(os.path.join(DEMO, f'{key}_base.wav'), dtype='float64')
    Fe = robust_formants(yb, sr, p['t0'] / 1000.0, p['t1'] / 1000.0)

    yp, srp, ids, unk = PG.synth(PG.sess, PG.cfg, PIPER_INPUT[v])
    a, b = voiced_span(yp, srp)
    Fp = robust_formants(yp, srp, a, b)
    os.makedirs(os.path.join(XL, 'vowels'), exist_ok=True)
    sf.write(os.path.join(XL, 'vowels', f'piper_{v.replace("ː","_long")}.wav'), yp, srp,
             subtype='PCM_16')
    rows.append(dict(vowel=v, espeak=Fe[:2], piper=Fp[:2],
                     d_f1=Fp[0] - Fe[0], d_f2=Fp[1] - Fe[1]))
    print(f"{v:<6}{Fe[0]:9.0f}/{Fe[1]:<8.0f}{Fp[0]:10.0f}/{Fp[1]:<9.0f}"
          f"{Fp[1]-Fe[1]:+8.0f}{Fp[0]-Fe[0]:+8.0f}")

print()
print('参考：项目自己的实测（gen_word_audio_espeak.mjs 注释）')
print('  σύ 的 υ=[y] F2≈1797Hz    τί 的 ι=[i] F2≈2242Hz → 差 445Hz，区分明显')
print('  μή 的 η F1≈688Hz         τί 的 ι F1≈290Hz      → 差 398Hz')

# 关键判别量：eSpeak 靠 F2 区分 y/i；piper 德语的 y/i 是否也分开？
def get(v, side, k):
    for r in rows:
        if r['vowel'] == v:
            return r[side][k]
    return float('nan')

print()
print('关键判别：')
for side, name in (('espeak', 'eSpeak grc'), ('piper', '德语 Piper')):
    dy, di = get('y', side, 1), get('i', side, 1)
    print(f'  {name:<12} F2(y)={dy:.0f}  F2(i)={di:.0f}  F2(i)-F2(y)={di-dy:+.0f} Hz'
          + ('   ← 能区分' if abs(di - dy) > 150 else '   ← 区分不足'))
for side, name in (('espeak', 'eSpeak grc'), ('piper', '德语 Piper')):
    lo, hi = get('a', side, 0), get('i', side, 0)
    print(f'  {name:<12} F1(a)={lo:.0f}  F1(i)={hi:.0f}  开口度差={lo-hi:+.0f} Hz')

json.dump(rows, open(os.path.join(XL, 'vowel_space.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

# ── 画图
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
for cand in ['/System/Library/Fonts/Supplemental/Songti.ttc',
             '/System/Library/Fonts/PingFang.ttc']:
    if os.path.exists(cand):
        try:
            font_manager.fontManager.addfont(cand)
            matplotlib.rcParams['font.family'] = font_manager.FontProperties(fname=cand).get_name()
            break
        except Exception:
            pass
matplotlib.rcParams['axes.unicode_minus'] = False
fig, ax = plt.subplots(figsize=(8.5, 6.5))
for side, mk, col, name in (('espeak', 'o', 'tab:blue', 'eSpeak grc (共振峰合成)'),
                            ('piper', '^', 'tab:red', '德语 Piper (VITS 神经)')):
    xs = [r[side][1] for r in rows]
    ys = [r[side][0] for r in rows]
    ax.scatter(xs, ys, marker=mk, s=95, color=col, label=name, alpha=0.85)
    for r, x, y in zip(rows, xs, ys):
        ax.annotate(r['vowel'], (x, y), textcoords='offset points',
                    xytext=(6, 4), fontsize=9, color=col)
ax.invert_xaxis(); ax.invert_yaxis()
ax.set_xlabel('F2 (Hz) — 越右越靠前'); ax.set_ylabel('F1 (Hz) — 越下开口越大')
ax.set_title('元音空间：阿提卡 IPA 输入下两个引擎的 F1/F2\n(同一坐标上越接近越好；注意 y 与 i 必须分离)')
ax.grid(alpha=0.3); ax.legend()
fig.tight_layout()
pth = os.path.join(OUT, '元音空间对比.png')
fig.savefig(pth, dpi=120)
print('\n→', pth)
