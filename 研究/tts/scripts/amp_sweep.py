#!/usr/bin/env python3
"""
音高重音幅度 ↔ 客观代价 的权衡曲线。

工程问题：把 acute/circumflex 的 F0 幅度调多大才值得？
  * 幅度太小 → 听不出对立，「区分 acute/circumflex」这个目标没达成；
  * 幅度太大 → PSOLA 每步要搬动更多基音周期，重叠窗之间相位错开，
    谐噪比（HNR）下降，音质变粗糙。
本脚本把这两个量在同一个坐标系里量出来，交给作者决定取舍。
"""
import json, os, sys, math
import numpy as np
import parselmouth
from parselmouth.praat import call
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psola as P
import prosody_fix as PF

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(HERE, 'out', 'demo')
ITEMS = {it['key']: it for it in json.load(open(os.path.join(DEMO, 'align.json'),
                                                encoding='utf-8'))['items']}
AMPS = [0.15, 0.25, 0.35, 0.45, 0.60]


def load(k, ver='base'):
    p = os.path.join(DEMO, f'{k}_base.wav')
    y, sr = sf.read(p, dtype='float64')
    return y, sr


def hnr(y, sr, win=0.05):
    s = parselmouth.Sound(y, sampling_frequency=sr)
    h = call(s, 'To Harmonicity (cc)', 0.01, 75, win, 1.0)
    v = h.values[h.values > 0]
    return float(np.mean(v)) if len(v) else float('nan')


def f0_norm(y, sr, n=25):
    s = parselmouth.Sound(y, sampling_frequency=sr)
    p = s.to_pitch(time_step=0.005)
    t, f = p.xs(), p.selected_array['frequency']
    m = f > 0
    if m.sum() < 4:
        return None
    tt = (t[m] - t[m][0]) / max(t[m][-1] - t[m][0], 1e-9)
    return np.interp(np.linspace(0, 1, n), tt, f[m])


def voiced_runs(y, sr, min_len=0.03):
    """有声段（连续 F0 存在的区间），秒。用来直接从信号里量元音时长。"""
    s = parselmouth.Sound(y, sampling_frequency=sr)
    p = s.to_pitch(time_step=0.002)
    t, f = p.xs(), p.selected_array['frequency']
    v = f > 0
    runs, st = [], None
    for i in range(len(v)):
        if v[i] and st is None:
            st = t[i]
        elif not v[i] and st is not None:
            if t[i] - st >= min_len:
                runs.append((st, t[i]))
            st = None
    if st is not None and t[-1] - st >= min_len:
        runs.append((st, t[-1]))
    return runs


def render(k, amp, mora_gain=1.55):
    it = ITEMS[k]
    s = parselmouth.Sound(os.path.join(DEMO, f'{k}_base.wav'))
    x = s.values[0].astype(np.float64)
    sr = int(s.sampling_frequency)
    marks = P.pitch_marks(s)
    g = PF.median_f0(s)
    PF.ACUTE_A = amp
    PF.CIRC_A = amp
    pts, anch, meta, de = PF.build_contour_points(it, g, mora_gain)
    y = P.td_psola(x, sr, pts, dur_anchors=anch, marks=marks,
                   fade_out_len=int(0.005 * sr))
    return x, y, sr, it, de


def main():
    print('=' * 100)
    print('音高重音幅度扫描：区分度（acute vs circumflex F0 曲线平均绝对差） vs 代价（HNR 损失）')
    print('=' * 100)
    rows = []
    for amp in AMPS:
        # 区分度：φῶς(circ) vs φώς(acute)、πῶς(circ) vs πώς(acute)
        dists = []
        for a, b in [('min01_phos_circ', 'min02_phos_acute'),
                     ('min03_pos_circ', 'min04_pos_acute')]:
            _, ya, sra, _, _ = render(a, amp)
            _, yb, srb, _, _ = render(b, amp)
            ca, cb = f0_norm(ya, sra), f0_norm(yb, srb)
            dists.append(float(np.mean(np.abs(ca - cb))))
        # 代价：HNR 下降（取几个代表）
        losses = []
        for k in ['min01_phos_circ', 'min03_pos_circ', 'min13_anthropos', 'sent02']:
            x, y, sr, _, _ = render(k, amp)
            losses.append(hnr(y, sr) - hnr(x, sr))
        # 重音音节 F0 提升
        x, y, sr, it, _ = render('min13_anthropos', amp)
        r0 = voiced_runs(x, sr); r1 = voiced_runs(y, sr)
        rows.append(dict(amp=amp, min_pair_dist_hz=float(np.mean(dists)),
                         hnr_loss_db=float(np.mean(losses)),
                         hnr_loss_worst=float(min(losses)),
                         peak_ratio=1.0 + amp))
        print(f"  amp={amp:.2f} (峰={1+amp:.2f}×)  acute/circumflex 曲线差 "
              f"{np.mean(dists):6.2f} Hz   HNR 变化 平均 {np.mean(losses):+5.2f} dB "
              f"(最差 {min(losses):+5.2f} dB)")

    print()
    print('=' * 100)
    print('隐藏长元音 ῡ 的时长补偿（直接量有声段，不用估算）')
    print('=' * 100)
    for k, gl in [('len01_mythos', 'μῦθος 的 ῡ 应为长音'), ('len02_lyo', 'λύω 的 ῠ 应为短音')]:
        x, _, sr, _, _ = render(k, 0.35)
        r = voiced_runs(x, sr)
        print(f'  {k:<14}{gl:<22} 原始有声段: ' + '  '.join(f'{(b-a)*1000:.0f}ms' for a, b in r))
        for g in (1.0, 1.55, 2.0):
            _, y, sr2, _, _ = render(k, 0.35, mora_gain=g)
            r2 = voiced_runs(y, sr2)
            print(f'      gain={g:<4} → ' + '  '.join(f'{(b-a)*1000:.0f}ms' for a, b in r2))

    print()
    print('=' * 100)
    print('元音共振峰漂移（改造是否破坏阿提卡音值）')
    print('=' * 100)
    for amp in (0.35,):
        ds = []
        for k in ITEMS:
            if k.startswith('sent'):
                continue
            x, y, sr, it, _ = render(k, amp)
            vw = [p for p in it['phonemes'] if __import__('re').search(r'[aeiouyɛɔɑ]', p['ipa'].lstrip('ˈˌ'))]
            if not vw:
                continue
            t = (vw[0]['t0'] + vw[0]['t1']) / 2000.0
            f0 = []
            for sig in (x, y):
                s2 = parselmouth.Sound(sig, sampling_frequency=sr)
                fm = call(s2, 'To Formant (burg)', 0.005, 5, 5500.0, 0.025, 50.0)
                f0.append([call(fm, 'Get value at time', i, t, 'hertz', 'linear') for i in (1, 2)])
            ds.append([abs(f0[1][0] - f0[0][0]), abs(f0[1][1] - f0[0][1])])
        ds = np.array(ds, dtype=float)
        print(f'  amp={amp}  n={len(ds)}  |ΔF1| 中位 {np.nanmedian(ds[:,0]):.1f} Hz  '
              f'90 分位 {np.nanpercentile(ds[:,0],90):.1f} Hz   '
              f'|ΔF2| 中位 {np.nanmedian(ds[:,1]):.1f} Hz  90 分位 {np.nanpercentile(ds[:,1],90):.1f} Hz')

    json.dump(rows, open(os.path.join(HERE, 'out', 'amp_sweep.json'), 'w',
                         encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"\n→ {os.path.join(HERE,'out','amp_sweep.json')}")


if __name__ == '__main__':
    main()
