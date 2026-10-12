#!/usr/bin/env python3
"""生成对比图：F0 曲线（最小对立体 + 长句）与幅度权衡曲线。"""
import json, os, sys
import numpy as np
import parselmouth
import soundfile as sf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')
FIX = os.path.join(OUT, 'fixed')
ITEMS = {it['key']: it for it in json.load(open(os.path.join(DEMO, 'align.json'),
                                                encoding='utf-8'))['items']}
# 中文字体：macOS 自带
# 项目自带的 GentiumPlus 覆盖全部多音调希腊语字符（Songti/PingFang 缺 ῦ/ῆ 等）
GENTIUM = os.path.join(HERE, '..', '..', 'app', 'public', 'fonts', 'GentiumPlus-Regular.ttf')
CJK = None
for c in ['/System/Library/Fonts/Supplemental/Songti.ttc',
          '/System/Library/Fonts/PingFang.ttc',
          '/System/Library/Fonts/STHeiti Light.ttc']:
    if os.path.exists(c):
        CJK = c
        break
fonts = []
# ⚠️ 顺序很重要：必须把**中文字体放前、Gentium 放后**。
# 反过来（Gentium 放前）中文会变成豆腐块——实测 matplotlib 的按字形回退
# 只在「前面的字体缺该字形」时生效，而 Gentium 有希腊语没有中文。
for p in (CJK, GENTIUM):
    if p and os.path.exists(p):
        try:
            font_manager.fontManager.addfont(p)
            fonts.append(font_manager.FontProperties(fname=p).get_name())
        except Exception:
            pass
# font.family 直接给字体名列表 → matplotlib 逐字形回退
matplotlib.rcParams['font.family'] = fonts + ['DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False


def f0(path):
    y, sr = sf.read(path, dtype='float64')
    if y.ndim > 1:
        y = y.mean(1)
    p = parselmouth.Sound(y, sampling_frequency=sr).to_pitch(time_step=0.003)
    t, f = p.xs(), p.selected_array['frequency']
    return t, f


def norm(path, n=200):
    t, f = f0(path)
    m = f > 0
    if m.sum() < 4:
        return None, None
    tt = (t[m] - t[m][0]) / max(t[m][-1] - t[m][0], 1e-9)
    return tt, f[m]


fig = plt.figure(figsize=(15, 15))

# ── 图 1–2：最小对立体 φῶς/φώς 与 πῶς/πώς
pairs = [(('min01_phos_circ', 'min02_phos_acute'), 'φῶς (circumflex)  vs  φώς (acute)'),
         (('min03_pos_circ', 'min04_pos_acute'), 'πῶς (circumflex)  vs  πώς (acute)'),
         (('min07_tis_acute', 'min08_tis_none'), 'τίς (acute)  vs  τις (无重音)'),
         (('min13_anthropos', 'min14_anthropou'), 'ἄνθρωπος (acute 前)  vs  ἀνθρώπου (acute 后)')]
for i, ((a, b), title) in enumerate(pairs):
    ax = fig.add_subplot(4, 2, i + 1)
    for k, lab, col in ((a, a, 'tab:blue'), (b, b, 'tab:red')):
        for ver, ls, alpha in (('base', '--', 0.45), ('fixed', '-', 1.0)):
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{k}_{ver}.wav')
            if not os.path.exists(p):
                continue
            tt, ff = norm(p)
            if tt is None:
                continue
            ax.plot(tt, ff, ls, color=col, alpha=alpha, lw=2.0,
                    label=f'{ITEMS[k]["text"]}  {ver}')
    ax.set_title(title, fontsize=11)
    ax.set_xlabel('归一化时间')
    ax.set_ylabel('F0 (Hz)')
    ax.grid(alpha=0.3)
    ax.legend(fontsize=7, ncol=2)

# ── 图 5：幅度权衡曲线
ax = fig.add_subplot(4, 2, 5)
sw = json.load(open(os.path.join(OUT, 'amp_sweep.json'), encoding='utf-8'))
xs = [r['peak_ratio'] for r in sw]
ax.plot(xs, [r['min_pair_dist_hz'] for r in sw], 'o-', color='tab:green',
        label='acute/circumflex 区分度 (Hz)')
ax.set_xlabel('重音峰 / 基准 = 1+amp')
ax.set_ylabel('F0 曲线平均绝对差 (Hz)', color='tab:green')
ax2 = ax.twinx()
ax2.plot(xs, [r['hnr_loss_db'] for r in sw], 's--', color='tab:purple',
         label='HNR 平均变化 (dB)')
ax2.plot(xs, [r['hnr_loss_worst'] for r in sw], '^:', color='tab:orange',
         label='HNR 最差变化 (dB)')
ax2.set_ylabel('HNR 变化 (dB)')
ax.set_title('音高重音幅度 ↔ 收益/代价', fontsize=11)
ax.grid(alpha=0.3)
h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels()
ax.legend(h1 + h2, l1 + l2, fontsize=7, loc='center right')

# ── 图 6：长句 F0
ax = fig.add_subplot(4, 2, 6)
for k, col in (('sent01', 'tab:blue'), ('sent02', 'tab:red'), ('sent03', 'tab:green')):
    for ver, ls, alpha in (('base', '--', 0.4), ('fixed', '-', 1.0)):
        p = os.path.join(DEMO if ver == 'base' else FIX, f'{k}_{ver}.wav')
        t, f = f0(p)
        m = f > 0
        ax.plot(t[m], f[m], ls, color=col, alpha=alpha, lw=1.2,
                label=f'{k} {ver}')
ax.set_title('长句 F0 曲线（实线=改造后）', fontsize=11)
ax.set_xlabel('时间 (s)'); ax.set_ylabel('F0 (Hz)')
ax.grid(alpha=0.3); ax.legend(fontsize=7, ncol=2)

# ── 图 7：F0 范围对比柱状图
ax = fig.add_subplot(4, 2, 7)
keys = [k for k in ITEMS if not k.startswith('sent')]
base_r, fix_r = [], []
for k in keys:
    _, fb = f0(os.path.join(DEMO, f'{k}_base.wav'))
    _, ffx = f0(os.path.join(FIX, f'{k}_fixed.wav'))
    vb, vf = fb[fb > 0], ffx[ffx > 0]
    base_r.append(vb.max() - vb.min()); fix_r.append(vf.max() - vf.min())
x = np.arange(len(keys))
ax.bar(x - 0.2, base_r, 0.4, label='原始 eSpeak', color='tab:gray')
ax.bar(x + 0.2, fix_r, 0.4, label='改造后', color='tab:blue')
ax.set_xticks(x); ax.set_xticklabels([ITEMS[k]['text'] for k in keys], rotation=70, fontsize=7)
ax.set_ylabel('整词 F0 范围 (Hz)')
ax.set_title('F0 范围：原始 vs 改造', fontsize=11)
ax.grid(alpha=0.3, axis='y'); ax.legend(fontsize=8)

# ── 图 8：时长与共振峰漂移
ax = fig.add_subplot(4, 2, 8)
info = []
for k in keys:
    yb, sr = sf.read(os.path.join(DEMO, f'{k}_base.wav'), dtype='float64')
    yf, _ = sf.read(os.path.join(FIX, f'{k}_fixed.wav'), dtype='float64')
    info.append((ITEMS[k]['text'], len(yb) / sr * 1000, len(yf) / sr * 1000))
x = np.arange(len(info))
ax.bar(x - 0.2, [a[1] for a in info], 0.4, label='原始', color='tab:gray')
ax.bar(x + 0.2, [a[2] for a in info], 0.4, label='改造后', color='tab:orange')
ax.set_xticks(x); ax.set_xticklabels([a[0] for a in info], rotation=70, fontsize=7)
ax.set_ylabel('总时长 (ms)')
ax.set_title('时长：隐藏长元音被补偿（μῦθος 486→526ms）', fontsize=11)
ax.grid(alpha=0.3, axis='y'); ax.legend(fontsize=8)

fig.suptitle('eSpeak-NG (grc) 韵律改造：客观声学对比  —— 注意：作者无法试听，本图只呈现可测量量',
             fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.97])
p = os.path.join(OUT, '对比图.png')
fig.savefig(p, dpi=110)
print('→', p)
