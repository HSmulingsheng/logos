#!/usr/bin/env python3
"""
量化对比：原始 eSpeak  vs  恒等 PSOLA（对照）  vs  韵律改造版

所有指标都是客观声学量，用来回答四个问题：
  Q-A 改造后 acute 与 circumflex 是否**可区分**？（基线的实测差是 0.1–0.4 Hz）
  Q-B 重音音节与非重音音节的 F0 对比是否变明显？
  Q-C 隐藏长元音（ᾱ/ῑ/ῡ）的时长是否被补上？mora 节奏指标 nPVI 如何变化？
  Q-D **元音音值（共振峰）有没有被破坏**？——这是「保持阿提卡发音准确」的硬约束。

局限（必须声明）：本机没有任何「能评判自然度的耳朵」，作者本人也无法试听。
所以本脚本只报告可测量的声学量，**不对「听起来是否更自然」下任何结论**。
"""
import json, os, sys, math
import numpy as np
import parselmouth
from parselmouth.praat import call
import soundfile as sf

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')
FIX = os.path.join(OUT, 'fixed')
AL = json.load(open(os.path.join(DEMO, 'align.json'), encoding='utf-8'))
ITEMS = {it['key']: it for it in AL['items']}

VOW_RE = __import__('re').compile(r'[aeiouyɛɔɑ]')


def load(path):
    y, sr = sf.read(path, dtype='float64')
    if y.ndim > 1:
        y = y.mean(1)
    return y, sr


def praat_snd(y, sr):
    return parselmouth.Sound(y, sampling_frequency=sr)


def f0_curve(y, sr, floor=70, ceil=400, step=0.005):
    p = praat_snd(y, sr).to_pitch(time_step=step, pitch_floor=floor, pitch_ceiling=ceil)
    return p.xs(), p.selected_array['frequency'].copy()


def f0_stats(y, sr):
    t, f = f0_curve(y, sr)
    v = f[f > 0]
    if len(v) == 0:
        return dict(mean=np.nan, min=np.nan, max=np.nan, range=np.nan, sd=np.nan, voiced=0.0)
    return dict(mean=float(v.mean()), min=float(v.min()), max=float(v.max()),
                range=float(v.max() - v.min()), sd=float(v.std()),
                voiced=float(len(v) / len(f)))


def formants_at(y, sr, t):
    s = praat_snd(y, sr)
    fm = call(s, 'To Formant (burg)', 0.005, 5, 5500.0, 0.025, 50.0)
    out = []
    for i in (1, 2, 3):
        try:
            out.append(float(call(fm, 'Get value at time', i, float(t), 'hertz', 'linear')))
        except Exception:
            out.append(np.nan)
    return out


def hnr(y, sr):
    s = praat_snd(y, sr)
    h = call(s, 'To Harmonicity (cc)', 0.01, 75, 0.1, 1.0)
    v = h.values[h.values > 0]
    return float(np.mean(v)) if len(v) else np.nan


def ltas(y, sr, lo=0, hi=None):
    """长时平均谱（dB），用来验证频谱包络/共振峰结构是否被保留。"""
    s = praat_snd(y[lo:hi], sr)
    sp = call(s, 'To Spectrum', True)
    n = call(sp, 'Get number of bins')
    df = call(sp, 'Get bin width')
    vals = np.array([call(sp, 'Get real value in bin', i) ** 2 +
                     call(sp, 'Get imaginary value in bin', i) ** 2 for i in range(1, n + 1)])
    return np.linspace(0, df * n, n), 10 * np.log10(vals + 1e-12)


def vowel_windows(item):
    """返回带重音信息的元音音素窗口 [(ipa, t0, t1, accent, morae)]"""
    return [(p['ipa'], p['t0'] / 1000.0, p['t1'] / 1000.0) for p in item['phonemes']
            if VOW_RE.search(p['ipa'].lstrip('ˈˌ'))]


def f0_peak_position(y, sr, t0, t1):
    """元音窗内 F0 峰值出现的相对位置（0=元音开头，1=元音结尾）。"""
    t, f = f0_curve(y, sr, step=0.002)
    m = (t >= t0) & (t < t1) & (f > 0)
    if m.sum() < 2:
        return np.nan
    seg, tt = f[m], t[m]
    return float((tt[int(np.argmax(seg))] - t0) / max(t1 - t0, 1e-6))


def norm_contour(y, sr, n=25):
    """时间归一化的 F0 曲线（用于比较最小对立体之间的差异）。"""
    t, f = f0_curve(y, sr, step=0.005)
    m = f > 0
    if m.sum() < 4:
        return None
    tt, ff = t[m], f[m]
    tt = (tt - tt[0]) / max(tt[-1] - tt[0], 1e-6)
    return np.interp(np.linspace(0, 1, n), tt, ff)


def npvi(vals):
    """归一化成对变异指数：节奏规整度的标准指标（>0 越大越「有节奏起伏」）。
    nPVI = 100/(n-1) * Σ |d_i - d_{i+1}| / ((d_i+d_{i+1})/2)"""
    v = [x for x in vals if x > 0]
    if len(v) < 2:
        return np.nan
    s = 0.0
    for i in range(len(v) - 1):
        s += abs(v[i] - v[i + 1]) / ((v[i] + v[i + 1]) / 2)
    return 100.0 * s / (len(v) - 1)


# ══════════════════════════════════════════════════════════════════════
def compare(name_a, name_b, label):
    """比较两个条目（通常是最小对立体）在三种版本下的 F0 曲线差异。"""
    rows = []
    for ver in ('base', 'resyn', 'fixed'):
        ca = cb = None
        for nm, store in ((name_a, ca), (name_b, cb)):
            pass
        def get(nm):
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{nm}_{ver}.wav')
            if not os.path.exists(p):
                return None
            y, sr = load(p)
            return norm_contour(y, sr)
        A, B = get(name_a), get(name_b)
        if A is None or B is None:
            continue
        rows.append(dict(version=ver,
                         diff_hz=float(np.mean(np.abs(A - B))),
                         max_diff_hz=float(np.max(np.abs(A - B))),
                         mean_a=float(np.mean(A)), mean_b=float(np.mean(B))))
    return dict(label=label, pair=[name_a, name_b], rows=rows)


def main():
    report = {'items': [], 'pairs': [], 'notes': []}
    print('=' * 96)
    print('逐条客观指标');
    print('=' * 96)
    print(f"{'key':<22}{'版本':<7}{'时长ms':>8}{'F0均值':>8}{'F0范围':>8}{'HNR':>7}  共振峰 F1/F2")
    for key, it in ITEMS.items():
        row = dict(key=key, text=it['text'], gloss=it['gloss'], versions={})
        for ver in ('base', 'resyn', 'fixed'):
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{key}_{ver}.wav')
            if not os.path.exists(p):
                continue
            y, sr = load(p)
            st = f0_stats(y, sr)
            # 取第一个元音的中点测共振峰
            vw = vowel_windows(it)
            if vw:
                _, a, b = vw[0]
                tm = (a + b) / 2 * (len(y) / sr) / (it['durMs'] / 1000.0)
                F = formants_at(y, sr, tm)
            else:
                F = [np.nan] * 3
            row['versions'][ver] = dict(dur_ms=len(y) / sr * 1000, **st,
                                        hnr=hnr(y, sr),
                                        formants=[round(x, 1) if not math.isnan(x) else None for x in F])
            print(f"{key:<22}{ver:<7}{len(y)/sr*1000:8.0f}{st['mean']:8.1f}"
                  f"{st['range']:8.1f}{hnr(y, sr):7.1f}  {F[0]:.0f}/{F[1]:.0f}")
        print('-' * 96)
        report['items'].append(row)

    print()
    print('=' * 96)
    print('Q-A  acute vs circumflex 能否区分？（时间归一化 F0 曲线的平均绝对差）')
    print('=' * 96)
    PAIRS = [('min01_phos_circ', 'min02_phos_acute', 'φῶς(circ) vs φώς(acute)'),
             ('min03_pos_circ', 'min04_pos_acute', 'πῶς(circ) vs πώς(acute)'),
             ('min10_eimi_circ', 'min09_eimi_acute', 'εἶμι(circ) vs εἰμί(acute)'),
             ('min11_demos_circ', 'min12_demos_acute', 'δῆμος(circ) vs δημός(acute)')]
    for a, b, lab in PAIRS:
        r = compare(a, b, lab)
        report['pairs'].append(r)
        d = {x['version']: x for x in r['rows']}
        line = f'  {lab:<34}'
        for ver in ('base', 'resyn', 'fixed'):
            if ver in d:
                line += f'  {ver}={d[ver]["diff_hz"]:6.2f}Hz'
        if 'base' in d and 'fixed' in d:
            line += f'   提升 ×{d["fixed"]["diff_hz"]/max(d["base"]["diff_hz"],1e-3):.1f}'
        print(line)

    print()
    print('=' * 96)
    print('Q-B 重音音节 vs 非重音音节的 F0 对比')
    print('=' * 96)
    CONTRAST = [('min07_tis_acute', 'min08_tis_none', 'τίς(acute) vs τις(无)'),
                ('min05_pote_acute1', 'min06_pote_acute2', 'πότε(前) vs ποτέ(后)')]
    for a, b, lab in CONTRAST:
        r = compare(a, b, lab); report['pairs'].append(r)
        d = {x['version']: x for x in r['rows']}
        line = f'  {lab:<30}'
        for ver in ('base', 'resyn', 'fixed'):
            if ver in d:
                line += f'  {ver}ΔF0={d[ver]["mean_a"]-d[ver]["mean_b"]:+6.1f}Hz'
        print(line)

    print()
    print('=' * 96)
    print('Q-C 隐藏长元音时长 & 节奏指标 nPVI')
    print('=' * 96)
    for key, it in [('len01_mythos', ITEMS['len01_mythos']), ('len02_lyo', ITEMS['len02_lyo'])]:
        for ver in ('base', 'fixed'):
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{key}_{ver}.wav')
            y, sr = load(p)
            # 元音音素时长取自 align，但 fixed 版时长被改过 → 用比例还原
            sc = (len(y) / sr * 1000) / it['durMs']
            vs = [(p2['ipa'], (p2['t1'] - p2['t0']) * sc) for p2 in it['phonemes']
                  if VOW_RE.search(p2['ipa'].lstrip('ˈˌ'))]
            print(f'  {key:<16}{ver:<7} 元音时长: ' + '  '.join(f'{n}={d:.0f}ms' for n, d in vs))

    # nPVI over all demo items' vowel durations
    for ver in ('base', 'fixed'):
        alld = []
        for key, it in ITEMS.items():
            if key.startswith('sent'):
                continue
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{key}_{ver}.wav')
            if not os.path.exists(p):
                continue
            y, sr = load(p)
            sc = (len(y) / sr * 1000) / it['durMs']
            for p2 in it['phonemes']:
                if VOW_RE.search(p2['ipa'].lstrip('ˈˌ')):
                    alld.append((p2['t1'] - p2['t0']) * sc)
        report[f'npvi_{ver}'] = npvi(alld)
        print(f'  nPVI({ver}) = {npvi(alld):.1f}   (元音样本 {len(alld)})')

    print()
    print('=' * 96)
    print('Q-D 频谱包络（共振峰结构）是否被保留？——LTAS 逐频点差')
    print('=' * 96)
    for key in ('min13_anthropos', 'sent02', 'min11_demos_circ'):
        yb, sr = load(os.path.join(DEMO, f'{key}_base.wav'))
        for ver in ('resyn', 'fixed'):
            p = os.path.join(FIX, f'{key}_{ver}.wav')
            if not os.path.exists(p):
                continue
            yf, _ = load(p)
            fa, La = ltas(yb, sr)
            fb, Lb = ltas(yf, sr)
            m = (fa >= 100) & (fa <= 5000) & (La > -200) & (Lb > -200)
            if m.sum() > 10:
                # 两者频点网格不同 → 插值到同一网格
                grid = np.linspace(100, 5000, 400)
                A = np.interp(grid, fa[m], La[m]); B = np.interp(grid, fb[m], Lb[m])
                A -= A.mean(); B -= B.mean()
                print(f'  {key:<20}{ver:<7} LTAS 相关系数 {np.corrcoef(A,B)[0,1]:.4f}   '
                      f'平均绝对差 {np.mean(np.abs(A-B)):.2f} dB')

    json.dump(report, open(os.path.join(OUT, 'metrics.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, default=str)
    print(f'\n→ {os.path.join(OUT, "metrics.json")}')


if __name__ == '__main__':
    main()
