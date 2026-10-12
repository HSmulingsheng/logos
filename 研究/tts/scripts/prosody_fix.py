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
import json, os, sys, argparse, math, re
import numpy as np
import parselmouth
from parselmouth.praat import call

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
    s = word.lower().normalize('NFD')
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


def target_contour(base_f0, t0, t1, accent, morae, is_diph):
    """返回 [(time, f0), ...]，描述一个音节核上的目标 F0 曲线。
    base_f0 是该时刻的下倾基准线（Hz）。"""
    T = max(t1 - t0, 0.02)
    n = 9
    pts = []
    long_ = (morae >= 2) or is_diph
    if accent in ('none',):
        # 无重音：略低于基准，轻微下降
        for i in range(n + 1):
            t = t0 + T * i / n
            pts.append((t, base_f0 * (0.96 - 0.04 * i / n)))
    elif accent == 'grave':
        for i in range(n + 1):
            t = t0 + T * i / n
            pts.append((t, base_f0 * 1.06))
    elif accent == 'acute':
        if not long_:
            # 单 mora：高调在第二个 mora（属下一音节），这里表现为到音节末升到峰
            for i in range(n + 1):
                u = i / n
                pts.append((t0 + T * u, base_f0 * (1.0 + 0.62 * u)))
        else:
            # 双 mora：前半段缓升，第二个 mora 升到峰（峰在音节末）
            for i in range(n + 1):
                u = i / n
                f = 1.10 + 0.45 * u if u <= 0.5 else 1.325 + 0.375 * ((u - 0.5) / 0.5)
                pts.append((t0 + T * u, base_f0 * f))
    elif accent == 'circumflex':
        # 高调在第一个 mora：峰出现在音节中部（≈50%）之后下降
        for i in range(n + 1):
            u = i / n
            f = 1.0 + 0.72 * (u / 0.5) if u <= 0.5 else 1.72 - 0.62 * ((u - 0.5) / 0.5)
            pts.append((t0 + T * u, base_f0 * f))
    return pts


def declination(t, t_start, t_end, g):
    """词级/句级下倾：从 1.06g 缓慢降到 0.90g"""
    if t_end <= t_start:
        return g
    u = min(max((t - t_start) / (t_end - t_start), 0.0), 1.0)
    return g * (1.06 - 0.16 * u)


# ── 主流程 ────────────────────────────────────────────────────────────────
def build_pitch_tier(manip, item, g, stretch=None):
    """根据 align.json 的音素表构造目标 F0 曲线。
    stretch: 若时长已被改动，给出「原始时刻 → 新时刻」的映射函数。"""
    total = call(manip, 'Get end time')
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


def apply_pitch(snd, pts):
    manip = call(snd, 'To Manipulation', 0.005, 60, 500)
    tier = call(manip, 'Create PitchTier', 'target', 0.0, call(manip, 'Get end time'))
    for t, f in pts:
        call(tier, 'Add point', float(t), float(min(max(f, 60.0), 500.0)))
    call(manip, 'Replace Pitch Tier', tier)
    return call(manip, 'Get resynthesis (overlap-add)')


def apply_duration(snd, actions):
    manip = call(snd, 'To Manipulation', 0.005, 60, 500)
    total = call(manip, 'Get end time')
    tier = call(manip, 'Create DurationTier', 'dur', 0.0, total)
    for (a, b, r) in actions:
        call(tier, 'Add point', float(max(a, 0.0)), 1.0)
        call(tier, 'Add point', float(min(max(a + 0.001, 0.0), total)), float(r))
        call(tier, 'Add point', float(min(max(b, 0.0), total)), 1.0)
    call(manip, 'Replace Duration Tier', tier)
    return call(manip, 'Get resynthesis (overlap-add)')


def median_f0(snd, floor=70, ceil=400):
    p = snd.to_pitch(time_step=0.005, pitch_floor=floor, pitch_ceiling=ceil)
    f = p.selected_array['frequency']
    v = f[f > 0]
    return float(np.median(v)) if len(v) else 100.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--mora-gain', type=float, default=1.55,
                    help='隐藏长元音的延长倍数（1.55 = 实测 eSpeak 的 ω:ο 时长比 136/86）')
    ap.add_argument('--no-duration', action='store_true')
    ap.add_argument('--no-pitch', action='store_true')
    args = ap.parse_args()

    al = json.load(open(os.path.join(DEMO, 'align.json'), encoding='utf-8'))
    items = [it for it in al['items'] if args.only in it['key']]
    print(f'处理 {len(items)} 条 (samplerate={al["samplerate"]})')
    outdir = os.path.join(OUT, 'fixed')
    os.makedirs(outdir, exist_ok=True)
    report = []

    for it in items:
        base_path = os.path.join(DEMO, it['key'] + '_base.wav')
        snd0 = parselmouth.Sound(base_path)
        # ── 对照组 1：只做一次 Praat 重合成（不改任何参数），用于分离「重合成本身」的影响
        manip = call(snd0, 'To Manipulation', 0.005, 60, 500)
        resyn = call(manip, 'Get resynthesis (overlap-add)')
        resyn.save(os.path.join(outdir, it['key'] + '_resyn.wav'), 'WAV')

        cur = snd0
        n_dur = 0
        # ── 第 1 步：时长规整
        if not args.no_duration:
            acts = duration_tier(cur, it, args.mora_gain)
            n_dur = len(acts)
            if acts:
                cur = apply_duration(cur, acts)
        # ── 第 2 步：F0 曲线
        g = median_f0(snd0)
        if not args.no_pitch:
            # 时长改动后音素时刻要按局部比例平移：这里用「重音核之前/之内/之后」
            # 的累积比例做线性映射（只对隐藏长音做了改动，映射足够精确）
            scale = cur.get_total_duration() / snd0.get_total_duration()
            stretch = (lambda t: t * scale) if abs(scale - 1.0) > 1e-6 else None
            pts = build_pitch_tier(call(cur, 'To Manipulation', 0.005, 60, 500), it, g, stretch)
            cur = apply_pitch(cur, pts)
        out = os.path.join(outdir, it['key'] + '_fixed.wav')
        cur.save(out, 'WAV')
        report.append(dict(key=it['key'], text=it['text'], gloss=it['gloss'],
                           dur_base=it['durMs'], dur_resyn=resyn.get_total_duration() * 1000,
                           dur_fixed=cur.get_total_duration() * 1000,
                           n_f0_points=len(pts) if not args.no_pitch else 0,
                           n_duration_edits=n_dur, base_f0=g,
                           accent=accent_summary(it['text'].split(' ')[0] if ' ' not in it['text'] else it['text'])))
        print(f"  {it['key']:<22} dur {it['durMs']:6.0f} → {cur.get_total_duration()*1000:6.0f} ms   "
              f"F0 点数 {len(pts) if not args.no_pitch else 0:3d}   时长改动 {n_dur}")

    json.dump(report, open(os.path.join(outdir, 'fix_report.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1, default=str)
    print(f'→ {outdir}')


if __name__ == '__main__':
    main()
