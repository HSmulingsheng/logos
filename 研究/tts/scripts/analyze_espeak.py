"""
从 probe_espeak.json + _probe/*.wav 提取客观声学指标。
用 Praat（parselmouth）做 F0 轨迹分析——它是语音学界最成熟的分析引擎，
比自写自相关稳健得多。
"""
import json, os, sys, math
import numpy as np
import parselmouth
from parselmouth.praat import call

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
P = json.load(open(os.path.join(OUT, 'probe_espeak.json'), encoding='utf-8'))


def f0_track(wav_path, floor=70, ceil=400, step=0.005):
    snd = parselmouth.Sound(wav_path)
    pitch = snd.to_pitch(time_step=step, pitch_floor=floor, pitch_ceiling=ceil)
    f = pitch.selected_array['frequency']
    t = pitch.xs()
    v = f[f > 0]
    return t, f, (v if len(v) else np.array([np.nan]))


def f0_window(wav_path, t0, t1, **kw):
    """某时间窗内（秒）的 F0 统计与轨迹"""
    t, f, v = f0_track(wav_path, **kw)
    m = (t >= t0) & (t < t1) & (f > 0)
    seg = f[m]
    if len(seg) < 2:
        return dict(n=0, mean=np.nan, sd=np.nan, min=np.nan, max=np.nan,
                    range=np.nan, slope=np.nan, pts=[])
    tt = t[m]
    A = np.polyfit(tt, seg, 1)
    return dict(n=len(seg), mean=float(seg.mean()), sd=float(seg.std()),
                min=float(seg.min()), max=float(seg.max()),
                range=float(seg.max() - seg.min()), slope=float(A[0]),
                pts=[[round(float(a), 3), round(float(b), 1)] for a, b in zip(tt, seg)])


def hnr(wav_path):
    snd = parselmouth.Sound(wav_path)
    h = call(snd, "To Harmonicity (cc)", 0.01, 75, 0.1, 1.0)
    v = h.values[h.values > 0]
    return float(np.mean(v)) if len(v) else float('nan')


def fmt(d, keys=('mean', 'min', 'max', 'range', 'slope')):
    return ' '.join(f'{k}={d[k]:.1f}' if isinstance(d.get(k), float) and not math.isnan(d[k]) else f'{k}=NA' for k in keys)


report = {}
print('=' * 78)
print('Q1  eSpeak 可控性：音素 + 每音素时长（有无对齐）')
print('=' * 78)
a = P['align']
print(f"  文本 {a['text']}   总时长 {a['total_ms']:.0f} ms")
print(f"  IPA 音素串 : {a['phonemes_ipa_raw']}")
print(f"  eSpeak 记法 : {a['phonemes_espeak_raw']}")
print('  对齐结果   : ' + '  '.join(f"{p['ipa']}={p['t1']-p['t0']:.0f}ms" for p in a['phonemes']))
print(f"  音素数 {len(a['phonemes'])}  对齐覆盖 {a['phonemes'][-1]['t1']:.0f}/{a['total_ms']:.0f} ms")
report['q1'] = a

print()
print('=' * 78)
print('Q2  音高重音：eSpeak 是否区分 acute / circumflex？')
print('=' * 78)
rows = P['pairs']
for g in dict.fromkeys(r['group'] for r in rows):
    two = [r for r in rows if r['group'] == g]
    print(f"\n  ▸ {g}  —— {two[0]['note']}")
    prof = []
    for r in two:
        w = os.path.join(OUT, r['wav'])
        t, f, v = f0_track(w)
        full = f0_window(w, 0, r['durMs'] / 1000)
        # 每个音素的 F0 均值
        per = []
        for ph in r['phonemes']:
            d = f0_window(w, ph['t0'] / 1000, ph['t1'] / 1000)
            per.append((ph['ipa'], d['mean'], d['slope'] if not math.isnan(d['slope']) else None))
        prof.append(per)
        print(f"    {r['side']}) {r['text']:<10} {r['phonemes_ipa']:<22} "
              f"dur={r['durMs']:6.0f}ms  F0 均值={full['mean']:6.1f}Hz "
              f"范围={full['range']:5.1f}Hz  min={full['min']:.1f} max={full['max']:.1f}  HNR={hnr(w):.1f}dB")
        print('        逐音素 F0: ' + '  '.join(
            f"{n}:{m:.0f}" if m and not math.isnan(m) else f"{n}:NA" for n, m, s in per))
    # 两个词的 F0 曲线差异
    if len(prof) == 2:
        diff = abs(f0_window(os.path.join(OUT, two[0]['wav']), 0, two[0]['durMs'] / 1000)['mean']
                   - f0_window(os.path.join(OUT, two[1]['wav']), 0, two[1]['durMs'] / 1000)['mean'])
        print(f"    → 整词 F0 均值差 {diff:.1f} Hz")
        report.setdefault('q2', []).append(dict(group=g, note=two[0]['note'],
            a=two[0]['text'], b=two[1]['text'],
            a_f0=f0_window(os.path.join(OUT, two[0]['wav']), 0, two[0]['durMs']/1000)['mean'],
            b_f0=f0_window(os.path.join(OUT, two[1]['wav']), 0, two[1]['durMs']/1000)['mean'],
            a_phon=[p['ipa'] for p in two[0]['phonemes']],
            b_phon=[p['ipa'] for p in two[1]['phonemes']]))

print()
print('=' * 78)
print('Q2b  set_pitch 全局扫描（F0 是否可控 / 线性）')
print('=' * 78)
for r in P['pitchScan']:
    w = os.path.join(OUT, r['wav'])
    d = f0_window(w, 0, r['durMs'] / 1000)
    print(f"  set_pitch={r['pitch']:<3} dur={r['durMs']:6.0f}ms  F0 均值={d['mean']:6.1f}Hz  "
          f"min={d['min']:6.1f}  max={d['max']:6.1f}  范围={d['range']:5.1f}")
report['pitch_scan'] = P['pitchScan']

print()
print('=' * 78)
print('Q3  长短元音：eSpeak 的 ː 是否真的更长？')
print('=' * 78)
lrows = P['length']
seen = {}
for g in dict.fromkeys(r['group'] for r in lrows):
    two = [r for r in lrows if r['group'] == g]
    line = f"  {g:<28}"
    for r in two:
        ph = [p for p in r['phonemes'] if p['ipa'].strip('ˈˌ').rstrip('ː') in 'aeiouyɔɛoa' or len(p['ipa']) > 1]
        vs = [(p['ipa'], p['ms']) for p in r['phonemes'] if any(c in p['ipa'] for c in 'aeiouyɔɛ')]
        line += f"  {r['side']}:'{r['text']}'=" + ','.join(f"{n}:{m:.0f}" for n, m in vs)
        for n, m in vs:
            seen.setdefault(n, []).append(m)
    print(line)

print()
print('  按音素汇总时长（ms，来自全部探针样本）：')
for k in sorted(seen, key=lambda x: -np.median(seen[x])):
    print(f"    {k:<6} n={len(seen[k]):2d}  中位={np.median(seen[k]):6.1f}  均值={np.mean(seen[k]):6.1f}")

# 长短配对
print()
print('  同部位长短配对（取探针里成对出现的）：')
pair_stats = []
for short, long_ in [('a', 'aː'), ('e', 'eː'), ('ɛ', 'ɛː'), ('i', 'iː'), ('o', 'oː'), ('ɔ', 'ɔː'), ('y', 'yː'), ('u', 'uː')]:
    ss = seen.get(short); ll = seen.get(long_)
    if ss and ll:
        pair_stats.append((short, long_, float(np.median(ss)), float(np.median(ll)),
                           float(np.median(ll) / np.median(ss))))
        print(f"    {short:<4} vs {long_:<5}  {np.median(ss):6.1f} → {np.median(ll):6.1f} ms  "
              f"比值 {np.median(ll)/np.median(ss):.2f}×")
report['length_pairs'] = pair_stats
report['phoneme_durations'] = {k: [float(x) for x in v] for k, v in seen.items()}

json.dump(report, open(os.path.join(OUT, 'analysis_espeak.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print(f"\n→ {os.path.join(OUT,'analysis_espeak.json')}")
