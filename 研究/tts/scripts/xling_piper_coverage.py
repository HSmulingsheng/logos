#!/usr/bin/env python3
"""
从 hf-mirror.com 镜像批量拉取 Piper 语音的 .onnx.json 配置（每个 ~5KB），
统计各语音的 phoneme_id_map 对「阿提卡古希腊语目标音素集」的覆盖率。

为什么不直接连 huggingface.co：本机网络层屏蔽了 huggingface.co（实测
curl 超时，HTTP 000），但镜像 hf-mirror.com 可达（200）。
"""
import json, os, sys, time, subprocess, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out', 'xling')
os.makedirs(OUT, exist_ok=True)
MIRROR = 'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/'

# ── 目标音素集：取自 eSpeak-NG grc 语音在 15,686 个词上的实测音素清单
#    （见 out/grc_phoneme_inventory.json），去掉了 ˈ/ˌ 重音前缀。
TARGET = {
    # 短元音
    'a': 'ᾰ [a]', 'e': 'ε [e]', 'i': 'ῐ [i]', 'o': 'ο [o]', 'u': 'ου短 [u]',
    'y': 'ῠ [y]', 'ɛ': 'ε开 [ɛ]', 'ɔ': 'ο开 [ɔ]',
    # 长元音
    'aː': 'ᾱ [aː]', 'eː': 'ει [eː]', 'iː': 'ῑ [iː]', 'oː': 'ω? [oː]',
    'uː': 'ου [uː]', 'yː': 'ῡ [yː]', 'ɛː': 'η [ɛː]', 'ɔː': 'ω [ɔː]',
    # 塞音（含送气）
    'p': 'π [p]', 'pʰ': 'φ [pʰ]', 'b': 'β [b]', 't': 'τ [t]', 'tʰ': 'θ [tʰ]',
    'd': 'δ [d]', 'k': 'κ [k]', 'kʰ': 'χ [kʰ]', 'g': 'γ [g]', 'ɡ': 'γ(U+0261)',
    # 擦音/其他
    'f': 'φ [f]', 'θ': 'θ [θ]', 'x': 'χ [x]', 's': 'σ [s]', 'z': 'ζ [z]',
    'h': 'ἁ [h]', 'v': '[v]', 'ð': '[ð]', 'ɣ': '[ɣ]',
    # 响音
    'm': 'μ', 'n': 'ν', 'ŋ': 'γν [ŋ]', 'r': 'ρ', 'l': 'λ', 'j': 'ι̯ [j]', 'w': 'ϝ [w]',
    # 双元音
    'aɪ': 'αι', 'aʊ': 'αυ', 'eʊ': 'ευ', 'oɪ': 'οι', 'ɔɪ': 'ῳ', 'uɪ': 'υι',
    'ai': 'αι(ASCII)', 'au': 'αυ(ASCII)', 'ei': 'ει(ASCII)', 'oi': 'οι(ASCII)',
}


def get(url, tries=3):
    """用 curl 而不是 urllib：hf-mirror 对 urllib 的默认 UA 返回 403，
    对 curl 正常返回 200（实测）。"""
    for i in range(tries):
        p = subprocess.run(['curl', '-sSL', '--max-time', '45', '-A', 'Mozilla/5.0',
                            '-o', '-', url], capture_output=True)
        if p.returncode == 0 and p.stdout:
            return p.stdout
        if i == tries - 1:
            raise RuntimeError(f'curl failed rc={p.returncode} {p.stderr[:200]!r}')
        time.sleep(1.5)
    return None


def main():
    idx = json.loads(get(MIRROR + 'voices.json'))
    print(f'Piper 语音目录：{len(idx)} 个语音')

    # 收集所有 .onnx.json 的路径
    cfgs = []
    for key, v in idx.items():
        for path, meta in v.get('files', {}).items():
            if path.endswith('.onnx.json'):
                cfgs.append((key, path, meta.get('size_bytes', 0)))
    print(f'其中含 .onnx.json 配置的：{len(cfgs)} 个（合计约 '
          f'{sum(c[2] for c in cfgs)/1e6:.1f} MB）')

    cache = os.path.join(OUT, 'piper_configs')
    os.makedirs(cache, exist_ok=True)
    ok, fail = 0, 0
    results = []
    for i, (key, path, size) in enumerate(cfgs):
        local = os.path.join(cache, key + '.json')
        if not os.path.exists(local):
            try:
                data = get(MIRROR + path)
                with open(local, 'wb') as f:
                    f.write(data)
                time.sleep(0.05)
            except Exception as e:
                fail += 1
                print(f'  ✗ {key}: {e}')
                continue
        try:
            cfg = json.load(open(local, encoding='utf-8'))
        except Exception as e:
            fail += 1
            continue
        ok += 1
        pm = cfg.get('phoneme_id_map') or cfg.get('phoneme_map') or {}
        phones = set(pm.keys())
        lang = cfg.get('language', {}).get('code', key.split('-')[0])
        espeak_voice = (cfg.get('espeak') or {}).get('voice', '?')
        results.append(dict(key=key, lang=lang, espeak_voice=espeak_voice,
                            n_phones=len(phones), phones=sorted(phones),
                            sample_rate=(cfg.get('audio') or {}).get('sample_rate'),
                            num_symbols=cfg.get('num_symbols')))
        if (i + 1) % 25 == 0:
            print(f'  {i+1}/{len(cfgs)} …')

    print(f'成功 {ok} 失败 {fail}')

    # ── 覆盖率计算
    rows = []
    for r in results:
        have = set(r['phones'])
        # 归一化：piper 里可能带重音前缀或 ɪ̯ 之类
        def norm(s):
            return s.replace('ˈ', '').replace('ˌ', '').replace('ː', 'ː')
        hn = {norm(p) for p in have}
        miss = [p for p in TARGET if p not in hn]
        rows.append(dict(key=r['key'], lang=r['lang'], espeak_voice=r['espeak_voice'],
                         n_phones=r['n_phones'],
                         covered=len(TARGET) - len(miss), total=len(TARGET),
                         missing=miss, phones=r['phones']))
    rows.sort(key=lambda x: (-x['covered'], x['key']))

    print('\n=== 覆盖率排行（目标 %d 个音素）===' % len(TARGET))
    for r in rows[:25]:
        print(f"  {r['covered']:2d}/{r['total']}  {r['key']:<32} espeak={r['espeak_voice']:<8} "
              f"缺: {','.join(r['missing'][:14])}")

    # 按语言族聚合：某语言族下的语音取「并集」覆盖率
    fam = collections.defaultdict(set)
    famkey = collections.defaultdict(list)
    for r in results:
        f = r['key'].split('-')[0].split('_')[0]
        fam[f] |= {p.replace('ˈ', '').replace('ˌ', '') for p in r['phones']}
        famkey[f].append(r['key'])
    famrows = []
    for f, phones in fam.items():
        miss = [p for p in TARGET if p not in phones]
        famrows.append((f, len(TARGET) - len(miss), miss, famkey[f]))
    famrows.sort(key=lambda x: -x[1])
    print('\n=== 按语言（该语言全部语音并集）===')
    for f, cov, miss, ks in famrows[:30]:
        print(f'  {cov:2d}/50  {f:<6} 缺: {",".join(miss[:16])}')

    # 贪心找最小语音组合覆盖全集
    need = set(TARGET)
    chosen = []
    pool = [(r['key'], {p.replace('ˈ', '').replace('ˌ', '') for p in r['phones']}) for r in results]
    while need:
        best = max(pool, key=lambda kv: len(kv[1] & need))
        if not (best[1] & need):
            break
        chosen.append((best[0], sorted(need & best[1])))
        need -= best[1]
        pool = [kv for kv in pool if kv[0] != best[0]]
    print(f'\n=== 贪心最小组合（覆盖 {len(TARGET)-len(need)}/{len(TARGET)}）===')
    for k, got in chosen[:12]:
        print(f'  {k:<34} 贡献 {len(got):2d}: {",".join(got)}')
    if need:
        print(f'  ✗ 仍缺: {",".join(sorted(need))}')

    json.dump(dict(target=TARGET, n_voices=len(results), rows=rows,
                   family=[dict(fam=f, covered=c, missing=m, voices=k) for f, c, m, k in famrows],
                   greedy=[dict(voice=k, adds=g) for k, g in chosen],
                   uncovered=sorted(need)),
              open(os.path.join(OUT, 'piper_coverage.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f"\n→ {os.path.join(OUT,'piper_coverage.json')}")


if __name__ == '__main__':
    main()
