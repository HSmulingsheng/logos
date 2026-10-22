import sys, importlib.util, numpy as np, wave, unicodedata, pathlib, json
spec = importlib.util.spec_from_file_location('li', 'LangIpa_SourceKit/LangIpa_Generator.py')
li = importlib.util.module_from_spec(spec); sys.modules['li'] = li; spec.loader.exec_module(li)

SR = 22050
K = li.Klatt(sr=SR)
VF = {i: (f1, f2, f3) for i, r, f1, f2, f3 in li.VOWELS}
CONS = {x[0]: x for x in li.PULMONIC}

VOW = set('ɑaeiouyɛɔ')
def parse(s):
    """IPA → [(kind, sym, long, asp)]，去掉 . 与重音"""
    s = unicodedata.normalize('NFD', s)
    out, i = [], 0
    while i < len(s):
        ch = s[i]
        if ch in '.ˈˌ' or unicodedata.combining(ch):
            i += 1; continue
        if ch == 'ʰ':
            if out: out[-1] = (out[-1][0], out[-1][1], out[-1][2], True)
            i += 1; continue
        if ch == 'ː':
            if out: out[-1] = (out[-1][0], out[-1][1], True, out[-1][3])
            i += 1; continue
        out.append(('v' if ch in VOW else 'c', ch, False, False))
        i += 1
    return out

def render(ipa, f0=130.0):
    ph = parse(ipa)
    segs, t = [], 0.0
    for kind, sym, is_long, asp in ph:
        if kind == 'v':
            d = 0.17 if is_long else 0.095
            f = VF.get(sym) or VF['a']
            segs.append(('vowel', 'glottal', True, None, t, t + d, f))
        else:
            d = 0.075
            if sym in ('s', 'z', 'f', 'h'): d = 0.095
            elif sym in ('m', 'n', 'ŋ', 'l', 'r'): d = 0.065
            entry = CONS.get(sym)
            if not entry:
                t += d; continue
            _, rom, manner, place, voiced = entry
            code = 'AS' if asp else None
            segs.append((manner, place, voiced, code, t, t + d, None))
        t += d
    y = K.render(segs, t, f0, seed=42, mods={}, noise_seed=7)
    y = np.tanh(y * 1.02) / 1.02
    p = float(np.max(np.abs(y)))
    if p > 0.98: y = y * (0.98 / p)
    k = max(2, int(0.006 * SR))
    if len(y) > 2 * k: y[:k] *= np.linspace(0, 1, k); y[-k:] *= np.linspace(1, 0, k)
    return (y * 32767).astype('<i2')

def write(path, y):
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes(y.tobytes())

words = {
    'φωνή':  'pʰɔː.nɛ́ː',
    'λόγος': 'ló.gos',
    'ἄνθρωπος': 'ɑ́n.tʰrɔː.pos',
    'Ζεύς':  'zdeús',
    'θυμός': 'tʰyː.mós',
    'χείρ':  'kʰẹ́ːr',
}
out = pathlib.Path('/tmp/li_demo')
for w, ipa in words.items():
    y = render(ipa)
    write(out / f'{w}.wav', y)
    print(f'  {w:<10} [{ipa:<16}] {len(y)/SR:.2f}s')
print('OK')
