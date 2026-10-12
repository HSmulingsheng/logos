#!/usr/bin/env python3
"""
原型：在保持 eSpeak grc 音段（formant）不变的前提下，重写韵律。

为什么这样做
------------
实测结论（见 out/stress_verification.json）：
  * eSpeak grc 的 ˈ 重音标记位置与正字法重音位置 **100% 一致**（5,985 词）
    → 可以用它精确定位重音音节；
  * 但 acute 与 circumflex 的 15 组最小对立体里 14 组产出**完全相同的**
    音素串与 F0 曲线（差 0.1–0.4 Hz）→ eSpeak 完全没有实现音高重音，
    它的 F0 只是「词级重读 + 下倾」，是拉丁/英语式的强弱重音模型；
  * F0 范围只有 ~25 Hz（≈均值的 30%），且峰值出现在重读音节**之前**；
  * ᾱ/ῑ/ῡ 这类「隐藏长元音」eSpeak 不标 ː，时长与短元音相同（μῦθος 的
    ῡ = 72ms vs λύω 的 ῠ = 71ms）→ mora 节奏缺失。

改造手段（源-滤波器语音的标准做法）
------------------------------------
用 Praat 的 PSOLA（parselmouth 绑定）在**保留频谱包络**的前提下替换 F0 曲线，
再做一轮时长规整。PSOLA 只搬基音周期，不动共振峰，所以元音音值（IPA 准确性）
不受影响 —— 这一点用改造前后的 F1/F2 实测来验证（见 metrics.py）。

目标 F0 模型（阿提卡重建，Allen 1973 / Devine & Stephens 1994 的通俗化版本）
  acute      —— 高调落在重音音节的**第二个 mora**上 ⇒ 单 mora 短元音：F0 到音节末升到峰；
                双 mora 长元音：后半段升到峰（峰位 ≈ 音节末）
  circumflex —— 高调落在**第一个 mora**，第二个 mora 下降 ⇒ 峰在音节中部（≈50%）后下降
  grave      —— 中和后的 acute，平的高中调
  无重音      —— 低于基准线，并受重音后降调（post-accentual lowering）影响
  词级下倾    —— 全词 F0 基准线自左向右缓慢下降（所有语言的共同倾向）

用法：
  python scripts/prosody_fix.py                # 处理 out/demo 下全部条目
  python scripts/prosody_fix.py --only min01   # 只处理匹配的条目
"""
import json, os, sys, argparse, math, re, unicodedata
import numpy as np
import parselmouth
from parselmouth.praat import call
import soundfile as sf
from psola import pitch_marks, td_psola


def write_wav(path, y, sr):
    sf.write(path, y, sr, subtype='PCM_16')

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')

# ── 希腊语正字法工具（与 verify_stress.mjs 同一套规则的 Python 版）──────────
ACUTE, GRAVE, PERISP = '\u0301', '\u0300', '\u0342'
ADD = re.compile('[\u0300-\u0345]')
BASIC_V = 'αεηιουω'
DIPH = {'αι', 'ει', 'οι', 'υι', 'αυ', 'ευ', 'ου', 'ηυ', 'ωυ'}
# 韵尾 -αι / -οι 在阿提卡重音规则里算**短**（所以 ἄνθρωποι 的重音能落在 antepenult）
SHORT_FINAL_DIPH = {'αι', 'οι'}


def syllabify(word):
    """返回 [{'text','accent'}] 音节列表。规则：元音字母相邻且成二合元音才并成一个音节；
    若重音符号落在第一个字母上则该簇不是二合元音（πό-λις）。"""
    s = unicodedata.normalize('NFD', word.lower())
    nuc = []
    i = 0
    while i < len(s):
        if s[i] in BASIC_V:
            j = i + 1
            while j < len(s) and ADD.match(s[j]):
                j += 1
            nuc.append({'i': i, 'j': j, 'text': s[i:j]})
            i = j
        else:
            i += 1
    syls = []
    k = 0
    while k < len(nuc):
        a = nuc[k]
        b = nuc[k + 1] if k + 1 < len(nuc) else None
        if (b is not None and a['j'] == b['i']
                and (a['text'][0] + b['text'][0]) in DIPH
                and not any(c in a['text'] for c in (ACUTE, GRAVE, PERISP))):
            syls.append({'text': a['text'] + b['text'], 'i': a['i'], 'j': b['j']})
            k += 2
        else:
            syls.append({'text': a['text'], 'i': a['i'], 'j': a['j']})
            k += 1
    for idx, sy in enumerate(syls):
        t = sy['text']
        if PERISP in t:
            sy['accent'] = 'circumflex'
        elif ACUTE in t:
            sy['accent'] = 'acute'
        elif GRAVE in t:
            sy['accent'] = 'grave'
        else:
            sy['accent'] = 'none'
        # 音节的 mora 数：长元音/正常二合元音 = 2；韵尾 -αι/-οι = 1
        bare = ''.join(c for c in t if c in BASIC_V)
        is_diph = len(bare) == 2 and bare in DIPH
        last = (idx == len(syls) - 1)
        if is_diph:
            sy['morae'] = 1 if (last and bare in SHORT_FINAL_DIPH) else 2
        else:
            # η/ω 与带 circumflex 的 α/ι/υ 都是长音
            ch = t[0]
            sy['morae'] = 2 if ch in 'ηω' else (2 if (sy['accent'] == 'circumflex' and ch in 'αιυ') else 1)
        # eSpeak 会不会显式标长音？η→ɛː ω→ɔː 二合元音→带 ɪ/ʊ 的音素；α/ι/υ 不标
        sy['hidden_long'] = (sy['morae'] == 2 and not is_diph
                             and t[0] in 'αιυ')
    return syls


def accent_summary(word):
    syls = syllabify(word)
    for idx, sy in enumerate(syls):
        if sy['accent'] != 'none':
            return dict(type=sy['accent'], from_end=len(syls) - 1 - idx, total=len(syls),
                        accented_text=sy['text'], accented_morae=sy['morae'],
                        hidden_long=sy['hidden_long'], syls=syls)
    return dict(type='none', from_end=-1, total=len(syls), accented_text='',
                accented_morae=1, hidden_long=False, syls=syls)


# ── F0 目标模型 ────────────────────────────────────────────────────────────
def is_diphone_ipa(ipa):
    return ('ɪ' in ipa) or ('ʊ' in ipa)


# 音高重音的幅度参数。取「半音」尺度：acute 峰 = 基准 × ACUTE_A，
# circumflex 峰 = 基准 × CIRC_A。1.45× ≈ +6.4 半音，1.62× ≈ +8.4 半音。
# 注意：幅度越大，PSOLA 需要搬动的基音周期越多、相邻窗相位越容易错开，
# 实测 HNR（谐噪比）会随幅度下降。所以这里取保守值，并优先保证曲线平滑。
ACUTE_A = 0.45
CIRC_A = 0.45
FALL = 0.14


def target_contour(base_f0, t0, t1, accent, morae, is_diph, amp=1.0):
    """返回 [(time, f0), ...]，描述一个音节核上的目标 F0 曲线。
    base_f0 是该时刻的下倾基准线（Hz）。
    形状用**平滑**函数而不是折线：折线的尖角会让基音周期增量突变，
    在 PSOLA 里表现为抖动（实测 HNR 会掉 6–8 dB）。"""
    T = max(t1 - t0, 0.02)
    n = 12
    pts = []
    long_ = (morae >= 2) or is_diph

    def emit(fn):
        for i in range(n + 1):
            u = i / n
            pts.append((t0 + T * u, base_f0 * fn(u)))

    if accent == 'none':
        emit(lambda u: 0.96 - 0.04 * u)
    elif accent == 'grave':
        emit(lambda u: 1.05 - 0.05 * u)
    elif accent == 'acute':
        A = ACUTE_A * amp
        if not long_:
            # 单 mora：高调落在第二个 mora（属下一音节），表现为到音节末平滑升到峰
            emit(lambda u: 1.0 + A * (u ** 1.5))
        else:
            # 双 mora：高调在第二个 mora；前半段缓升、后半段继续升到音节末
            emit(lambda u: 1.0 + A * (0.30 + 0.70 * u) if u > 0.5
                 else 1.0 + A * 0.60 * u)
    elif accent == 'circumflex':
        # 高调在第一个 mora：峰在音节中部（≈45%）后平滑下降
        A = CIRC_A * amp
        emit(lambda u: 1.0 + A * math.exp(-((u - 0.45) / 0.34) ** 2) - FALL * max(0.0, (u - 0.45) / 0.55))
    elif accent == 'secondary':
        A = 0.12 * amp
        emit(lambda u: 1.0 + A * math.sin(math.pi * u))
    return pts


def smooth_contour(pts, win=0.022):
    """对 F0 控制点做 Hann 平滑，抑制 PSOLA 的周期抖动。"""
    if len(pts) < 5:
        return pts
    a = sorted(pts)
    t = np.array([x[0] for x in a]); v = np.array([x[1] for x in a])
    half = win / 2.0
    out = []
    for i in range(len(t)):
        m = np.abs(t - t[i]) <= half
        if m.sum() < 2:
            out.append(v[i]); continue
        w = 0.5 - 0.5 * np.cos(2 * np.pi * (t[m] - t[i] + half) / (2 * half))
        out.append(float((v[m] * w).sum() / w.sum()))
    return list(zip(t.tolist(), out))


def declination(t, t_start, t_end, g):
    """词级/句级下倾：从 1.06g 缓慢降到 0.90g"""
    if t_end <= t_start:
        return g
    u = min(max((t - t_start) / (t_end - t_start), 0.0), 1.0)
    return g * (1.06 - 0.16 * u)


# ── 主流程 ────────────────────────────────────────────────────────────────
def build_pitch_tier(manip, total, item, g, stretch=None):
    """根据 align.json 的音素表构造目标 F0 曲线。
    stretch: 若时长已被改动，给出「原始时刻 → 新时刻」的映射函数。
    注：parselmouth 不暴露 Manipulation 的时长查询命令（实测 "Get end time"
    对该对象不可用），所以总时长由调用方传入。"""
    t_start, t_end = 0.0, total
    phones = item['phonemes']
    # 每个音素的重音状态
    events = []
    for p in phones:
        ipa = p['ipa']
        acc = 'none'
        if ipa.startswith('ˈ'):
            acc = 'primary'
        elif ipa.startswith('ˌ'):
            acc = 'secondary'
        events.append(dict(ipa=ipa, t0=p['t0'] / 1000.0, t1=p['t1'] / 1000.0, stress=acc,
                           is_vowel=bool(re.search(r'[aeiouyɛɔɑ]', ipa))))

    # 把每个词的正字法重音信息对到带 ˈ 的音素上
    #   作法：把 align 的音素按词事件切段（词事件由 demo_espeak.mjs 写出）
    words = item.get('words') or []
    acc_type_by_word = []
    for w in words:
        pos = w['text_position'] - 1
        seg_text = item['text'][pos:pos + w['length']]
        acc_type_by_word.append(accent_summary(seg_text))
    # 音素 → 词索引
    for e in events:
        e['word'] = -1
        for wi, w in enumerate(words):
            if w['t0'] / 1000.0 <= e['t0'] + 1e-6 < (w['t1'] + 1) / 1000.0:
                e['word'] = wi
                break
    if not words:
        for e in events:
            e['word'] = 0
        acc_type_by_word = [accent_summary(item['text'])]

    pts = []
    # 曲线覆盖整个发声区段；Praat 在未给点处按线性插值
    pts.append((0.0, g * 1.06))
    for e in events:
        if not e['is_vowel']:
            continue
        t0, t1 = e['t0'], e['t1']
        if stretch:
            t0, t1 = stretch(t0), stretch(t1)
        wi = max(e['word'], 0)
        info = acc_type_by_word[wi] if wi < len(acc_type_by_word) else None
        if e['stress'] == 'primary' and info:
            acc = info['type'] if info['type'] != 'none' else 'acute'
            morae = info['accented_morae']
            # 句子里可能有多个主重音（每个词一个）：只在「该词的重音音节」上应用
            pts += target_contour(declination(t0, t_start, t_end, g), t0, t1,
                                  acc, morae, is_diphone_ipa(e['ipa']))
        elif e['stress'] == 'secondary':
            for i in range(5):
                u = i / 4
                t = t0 + (t1 - t0) * u
                pts.append((t, declination(t, t_start, t_end, g) * (1.02 + 0.06 * math.sin(math.pi * u))))
        else:
            for i in range(5):
                u = i / 4
                t = t0 + (t1 - t0) * u
                pts.append((t, declination(t, t_start, t_end, g) * 0.96))
    pts.append((total, g * 0.90))
    pts = [(max(0.0, min(t, total)), f) for t, f in pts]
    pts.sort()
    return pts


def duration_tier(manip, item, mora_gain=1.0):
    """隐藏长元音（ᾱ/ῑ/ῡ）+ 音节重量 的时长补偿。
    mora_gain: 隐藏长元音延长到原来的多少倍（默认取 eSpeak 自己对 ω:ο 的比值）。"""
    words = item.get('words') or []
    actions = []
    if not words:
        words = [dict(t0=0, t1=item['durMs'], text_position=1,
                      length=len(item['text']))]
    for w in words:
        pos = w['text_position'] - 1
        text = item['text'][pos:pos + w['length']]
        info = accent_summary(text)
        if not info['hidden_long']:
            continue
        # 找这个词里带 ˈ 的元音音素（即重音音节核）
        for p in item['phonemes']:
            t = p['t0'] / 1000.0
            if not (w['t0'] / 1000.0 <= t < (w['t1'] + 1) / 1000.0):
                continue
            ipa = p['ipa'].strip('ˈˌ')
            if p['ipa'].startswith('ˈ') and re.search(r'[aeiouyɛɔɑ]', ipa) and 'ː' not in ipa:
                actions.append((p['t0'] / 1000.0, p['t1'] / 1000.0, mora_gain))
                break
    return actions


def median_f0(snd, floor=70, ceil=400):
    p = snd.to_pitch(time_step=0.005, pitch_floor=floor, pitch_ceiling=ceil)
    f = p.selected_array['frequency']
    v = f[f > 0]
    return float(np.median(v)) if len(v) else 100.0


def build_contour_points(item, g, dur_gain=1.0):
    """返回 (f0_pts, dur_anchors, meta)。
    f0_pts  : [(分析时刻秒, 目标F0 Hz)] —— 设计好的阿提卡音高重音曲线
    dur_anchors : [(分析时刻, 输出时刻)] —— 隐藏长元音的时长补偿
    """
    T = item['durMs'] / 1000.0
    words = item.get('words') or [dict(t0=0, t1=item['durMs'], text_position=1,
                                       length=len(item['text']))]
    acc_info = []
    for w in words:
        pos = w['text_position'] - 1
        acc_info.append(accent_summary(item['text'][pos:pos + w['length']]))

    def decl(t):
        u = min(max(t / T, 0.0), 1.0)
        return g * (1.06 - 0.16 * u)

    pts = [(0.0, decl(0.0))]
    dur_edits = []          # (t0, t1, gain)
    meta = []
    for p in item['phonemes']:
        t0, t1 = p['t0'] / 1000.0, p['t1'] / 1000.0
        ipa = p['ipa']
        base = ipa.lstrip('ˈˌ')
        is_v = bool(re.search(r'[aeiouyɛɔɑ]', base))
        if not is_v:
            continue
        # 所属词
        wi = -1
        for k, w in enumerate(words):
            if w['t0'] / 1000.0 <= t0 + 1e-6 < (w['t1'] + 1) / 1000.0:
                wi = k
                break
        info = acc_info[wi] if 0 <= wi < len(acc_info) else None
        long_ = ('ː' in base) or is_diphone_ipa(base)
        if ipa.startswith('ˈ') and info and info['type'] != 'none':
            acc = info['type']
            morae = info['accented_morae']
            long_ = long_ or morae >= 2
        elif ipa.startswith('ˈ'):
            # eSpeak 会给**所有**词标主重音，包括正字法上无重音的附着词
            # （实测 ἐν/εἰς/οὐ/τις 等 92% 都被强行加了 ˈ）。正字法无重音时
            # 不施加音高重音——阿提卡希腊语里这些词属于前附词/后附词，不带调。
            acc, morae = 'none', (2 if long_ else 1)
        elif ipa.startswith('ˌ'):
            acc, morae = 'secondary', (2 if long_ else 1)
        else:
            acc, morae = 'none', (2 if long_ else 1)
        # 隐藏长元音：应为长（mora=2）但 eSpeak 未标 ː 的单体元音
        if (info and info.get('hidden_long') and ipa.startswith('ˈ')
                and 'ː' not in base and not is_diphone_ipa(base)):
            dur_edits.append((t0, t1, dur_gain))
        if acc == 'secondary':
            c = [(t0 + (t1 - t0) * i / 4, decl(t0) * (1.02 + 0.06 * math.sin(math.pi * i / 4)))
                 for i in range(5)]
        else:
            c = target_contour(decl(t0), t0, t1, acc, morae, is_diphone_ipa(base))
        pts += c
        meta.append(dict(ipa=ipa, t0=t0, t1=t1, accent=acc, morae=morae, long=long_))
    pts.append((T, decl(T)))
    pts.sort()
    pts = smooth_contour(pts)

    # 时长锚点：分段线性映射（只拉伸指定的元音，其余保持 1:1）
    anchors = [(0.0, 0.0)]
    shift = 0.0
    for (a, b, gain) in sorted(dur_edits):
        anchors.append((a, a + shift))
        anchors.append((b, a + shift + (b - a) * gain))
        shift += (b - a) * (gain - 1.0)
    anchors.append((T, T + shift))
    # 去重并保证严格单调
    ded = []
    for a, b in anchors:
        if not ded or (a > ded[-1][0] + 1e-9 and b > ded[-1][1] + 1e-9):
            ded.append((a, b))
        elif ded:
            ded[-1] = (a, b)
    return pts, ded, meta, dur_edits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--mora-gain', type=float, default=1.55,
                    help='隐藏长元音的延长倍数（1.55 = 实测 eSpeak 的 ω:ο 时长比 136/86）')
    ap.add_argument('--no-duration', action='store_true')
    ap.add_argument('--no-pitch', action='store_true')
    ap.add_argument('--gain', type=float, default=1.0,
                    help='整体音高变换倍率（对比不同 set_pitch 的效果时用）')
    args = ap.parse_args()

    al = json.load(open(os.path.join(DEMO, 'align.json'), encoding='utf-8'))
    items = [it for it in al['items'] if args.only in it['key']]
    print(f'处理 {len(items)} 条 (samplerate={al["samplerate"]})')
    outdir = os.path.join(OUT, 'fixed')
    os.makedirs(outdir, exist_ok=True)
    report = []

    for it in items:
        snd = parselmouth.Sound(os.path.join(DEMO, it['key'] + '_base.wav'))
        x = snd.values[0].astype(np.float64)
        sr = int(snd.sampling_frequency)
        marks = pitch_marks(snd)
        g = median_f0(snd)
        pts, anchors, meta, dur_edits = build_contour_points(
            it, g, 1.0 if args.no_duration else args.mora_gain)

        # ── 对照组：恒等 PSOLA（目标 F0 = 标记自身周期，时长不变）
        # 用于把「PSOLA 重合成本身」与「韵律改动」的效应分开
        tt = list(marks[:-1]); ffv = [1.0 / (marks[i + 1] - marks[i]) for i in range(len(marks) - 1)]
        ctrl = td_psola(x, sr, list(zip(tt, ffv)), marks=marks)
        write_wav(os.path.join(outdir, it['key'] + '_resyn.wav'), ctrl, sr)

        # ── 正式改造
        f0_pts = pts if not args.no_pitch else list(zip(tt, ffv))
        if args.gain != 1.0 and not args.no_pitch:
            f0_pts = [(t, v) for t, v in f0_pts]
        y = td_psola(x, sr, f0_pts, dur_anchors=None if args.no_duration else anchors,
                     marks=marks,
                     fade_out_len=int(0.005 * sr))
        write_wav(os.path.join(outdir, it['key'] + '_fixed.wav'), y, sr)

        report.append(dict(key=it['key'], text=it['text'], gloss=it['gloss'],
                           dur_base=it['durMs'], dur_fixed=len(y) / sr * 1000,
                           base_f0=round(g, 1), n_marks=len(marks),
                           dur_edits=[[round(a, 4), round(b, 4), c] for a, b, c in dur_edits],
                           contour=[(round(t, 4), round(f, 1)) for t, f in pts],
                           phoneme_accent=meta))
        print(f"  {it['key']:<22} {it['durMs']:6.0f} → {len(y)/sr*1000:6.0f} ms   "
              f"基准F0 {g:5.1f} Hz  标记 {len(marks):3d}  时长改动 {len(dur_edits)}"
              f"  重音 {[m['accent'] for m in meta]}")

    json.dump(report, open(os.path.join(outdir, 'fix_report.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'→ {outdir}')


if __name__ == '__main__':
    main()
