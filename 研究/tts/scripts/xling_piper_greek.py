#!/usr/bin/env python3
"""
跨语言借用神经声码器：把**阿提卡古希腊语的 IPA 音素串**直接喂给一个
**德语 Piper 语音**（de_DE-thorsten-medium, VITS, 22050Hz, 约 63MB）。

为什么选德语：阿提卡重建里几个「现代语言里罕见」的音素，德语恰好都有——
  [y]  德语 ü（Bühne）    —— 古希腊 υ
  [yː] 德语 üh           —— 古希腊 ῡ
  [ɛː] 德语 ä（spät）     —— 古希腊 η
  [ɔ]  德语 o（Sonne）    —— 古希腊 ο
  [a]  德语 a            —— 古希腊 α
  [ɪ]/[ʊ] 双元音第二成分  —— 古希腊 αι/αυ 的第二成分
所以「用德语音素表 + 阿提卡音素串」在**音段层面**是自洽的。

Piper 的 phoneme_id_map 是一套**语言无关的 IPA 符号表**（de_DE 有 159 个 token，
含 ʰ ː ˈ ˌ 等），所以理论上任何 IPA 串都能编码。真正的未知数是
**声学模型有没有学过这些符号**——本脚本就是去实测这一点。

做法：直接用 onnxruntime 驱动 piper 的 ONNX，绕过它的文本前端，
自己构造 phoneme id 序列。
"""
import json, os, sys, numpy as np
import onnxruntime as ort
import soundfile as sf
import parselmouth
from parselmouth.praat import call

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out', 'xling')
MODEL = os.path.join(OUT, 'models', 'de_DE-thorsten-medium.onnx')
CFG = MODEL + '.json'


def load_voice():
    cfg = json.load(open(CFG, encoding='utf-8'))
    sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
    return cfg, sess


def ids_of(cfg, phonemes):
    """把 IPA 音素（单个字符/双字符 token）转成 piper 的 id 序列。
    Piper 的约定：BOS ^ ... 每个音素后跟一个 PAD _ ... EOS $"""
    pm = cfg['phoneme_id_map']
    bos = cfg.get('bos', '^'); eos = cfg.get('eos', '$'); pad = cfg.get('pad', '_')
    ids = list(pm[bos])
    unknown = []
    for p in phonemes:
        if p not in pm:
            unknown.append(p)
            continue
        ids.extend(pm[p])
        ids.extend(pm[pad])
    ids.extend(pm[eos])
    return ids, unknown


def split_ipa(s):
    """把 IPA 串切成 phoneme_id_map 里存在的 token（最长匹配）。"""
    pm = cfg_map
    toks = sorted(pm.keys(), key=len, reverse=True)
    out, i, unk = [], 0, []
    while i < len(s):
        for t in toks:
            if s.startswith(t, i):
                out.append(t); i += len(t); break
        else:
            unk.append(s[i]); i += 1
    return out, unk


def synth(sess, cfg, phonemes, length_scale=1.0, noise_scale=0.667, noise_w=0.8):
    ids, unknown = ids_of(cfg, phonemes)
    x = np.array([ids], dtype=np.int64)
    xl = np.array([len(ids)], dtype=np.int64)
    scales = np.array([noise_scale, length_scale, noise_w], dtype=np.float32)
    y = sess.run(None, {'input': x, 'input_lengths': xl, 'scales': scales})[0]
    sr = cfg['audio']['sample_rate']
    y = np.squeeze(y)
    return y, sr, ids, unknown


def formants(y, sr, t):
    s = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
    fm = call(s, 'To Formant (burg)', 0.005, 5, 5500.0, 0.025, 50.0)
    return [call(fm, 'Get value at time', i, float(t), 'hertz', 'linear') for i in (1, 2)]


def f0med(y, sr):
    s = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
    p = s.to_pitch(time_step=0.005, pitch_floor=60, pitch_ceiling=400)
    v = p.selected_array['frequency']; v = v[v > 0]
    return float(np.median(v)) if len(v) else float('nan')


cfg, sess = load_voice()
cfg_map = cfg['phoneme_id_map']
print(f"德语语音 de_DE-thorsten-medium 加载: token {len(cfg_map)} 个, "
      f"采样率 {cfg['audio']['sample_rate']}")
print(f"  ONNX 输入: {[i.name for i in sess.get_inputs()]}")

# ── 对照组 1：真正的德语文本（走 piper 自己的 espeak 前端应该得到的结果）
#   这里直接用「德语 IPA」手工喂进去，验证管线正确
CASES = [
    ('德语句子(对照)', ['d', 'e', 'ː', 'n', 'd', 'ɐ'], '德语对照: den'),
    # ── 古希腊语单词（阿提卡重建 IPA，来自 data/ipa.json / eSpeak grc 实测）
    ('σύ', ['s', 'y'], '古希腊 σύ [sy]  —— υ 应为 [y]，F2 高'),
    ('λύω', ['l', 'y', 'ɔ', 'ː'], '古希腊 λύω [lyɔː]'),
    ('μῦθος', ['m', 'y', 'ː', 't', 'ʰ', 'o', 's'], 'Probert 记法: ῡ=[yː], θ=[tʰ]'),
    ('μῦθος(eSpeak记法)', ['m', 'y', 'θ', 'o', 's'], 'eSpeak grc 实际输出: θ=[θ]'),
    ('φῶς(Probert)', ['p', 'ʰ', 'ɔ', 'ː', 's'], 'φ=[pʰ] 送气清塞音，德语 p 有送气同位异音'),
    ('φῶς(eSpeak)', ['f', 'ɔ', 'ː', 's'], 'eSpeak grc 实际输出: φ=[f]'),
    ('τί', ['t', 'i'], '古希腊 τί [ti]'),
    ('ἄνθρωπος', ['a', 'n', 't', 'ʰ', 'r', 'ɔ', 'ː', 'p', 'o', 's'], '多音节'),
    ('ναί', ['n', 'a', 'ɪ'], '双元音 αι'),
    ('οὐ', ['o', 'ː'], 'Probert 记法 ου=[oː]'),
]
os.makedirs(os.path.join(OUT, 'piper_test'), exist_ok=True)
results = []
print()
print('=' * 104)
print(f"{'词':<22}{'音素串':<40}{'时长':>8}{'F0':>7}  F1/F2 (Hz)")
print('=' * 104)
for label, phon, desc in CASES:
    try:
        y, sr, ids, unknown = synth(sess, cfg, phon)
        p = os.path.join(OUT, 'piper_test', f'{label.replace("/","_")}.wav')
        sf.write(p, y, sr, subtype='PCM_16')
        dur = len(y) / sr
        # 取最长的有声元音段的中点测共振峰
        s = parselmouth.Sound(y.astype(np.float64), sampling_frequency=sr)
        pt = s.to_pitch(time_step=0.005, pitch_floor=60, pitch_ceiling=400)
        v = pt.selected_array['frequency']; tt = pt.xs()
        m = v > 0
        if m.sum() > 4:
            mid = tt[m][len(tt[m]) // 2]
        else:
            mid = dur / 2
        F = formants(y, sr, mid)
        results.append(dict(label=label, phonemes=phon, desc=desc, dur=dur,
                            f0=f0med(y, sr), formants=F, unknown=unknown, ids=len(ids),
                            wav=os.path.relpath(p, OUT)))
        print(f"{label:<22}{''.join(phon):<40}{dur*1000:7.0f}ms{f0med(y,sr):7.1f}  "
              f"{F[0]:.0f}/{F[1]:.0f}" + (f'  ⚠未知符号 {unknown}' if unknown else ''))
    except Exception as e:
        print(f'{label:<22} FAILED: {type(e).__name__}: {e}')
        results.append(dict(label=label, error=str(e)))

json.dump(results, open(os.path.join(OUT, 'piper_test_results.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1, default=str)
print()
print('→', os.path.join(OUT, 'piper_test_results.json'))
print('⚠️ 关键：这些数字只能说明「有声音出来、共振峰是多少」，')
print('   不能说明听起来像不像古希腊语——本机无法试听评判。')
