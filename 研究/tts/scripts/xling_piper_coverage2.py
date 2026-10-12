#!/usr/bin/env python3
"""
修正版 Piper 音素覆盖分析。

第一次分析错了：我把目标 IPA 当成**单个 token** 去比对 phoneme_id_map，
于是 aː eː iː 等全部报缺失。实际上 Piper 的 phoneme_id_map 是一套
**语言无关的 IPA 符号表**（约 130–166 个 token），长音写作 `a`+`ː` 两个 token、
送气写作 `p`+`ʰ`。所以正确的覆盖率必须按 **token 序列** 计算。

结论方向也随之改变：
  符号覆盖率几乎人人 100% —— 所以「符号够不够」不是瓶颈；
  真正的瓶颈是**声学模型有没有被训练过这些符号**。
一个出现在表里、但该语言训练数据中从未出现的符号，其 embedding 基本是随机的，
合成出来是噪声。这一点无法用配置文件判断，只能实测（见 out/xling/piper_test/）。
"""
import json, os, re, collections, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XL = os.path.join(HERE, 'out', 'xling')
CFG = os.path.join(XL, 'piper_configs')

# 阿提卡重建目标音素（按 eSpeak grc 实测清单 + Probert/CLTK 的送气塞音记法）
TARGET = [
    'a', 'aː', 'e', 'eː', 'i', 'iː', 'o', 'oː', 'u', 'uː', 'y', 'yː',
    'ɛ', 'ɛː', 'ɔ', 'ɔː',
    'p', 'pʰ', 'b', 't', 'tʰ', 'd', 'k', 'kʰ', 'g', 'ɡ',
    'm', 'n', 'ŋ', 'r', 'r̥', 'l', 's', 'z', 'h',
    'f', 'θ', 'x', 'v', 'ð', 'ɣ', 'w', 'j',
    'aɪ', 'aʊ', 'eʊ', 'oɪ', 'ɔɪ', 'uɪ', 'yi',
    'ˈ', 'ˌ', 'ː', 'ʰ',
]
# 目标音素涉及的「基元」——用于 token 序列匹配
PRIMS = sorted({s for t in TARGET for s in t} | set(TARGET), key=len, reverse=True)


def tokenize(ipa, allowed):
    """把 IPA 串按 allowed 里的 token 做最长匹配切分；返回 (tokens, 剩余无法表示的字符)"""
    out, rest, i = [], '', 0
    while i < len(ipa):
        for tok in PRIMS:
            if ipa.startswith(tok, i) and tok in allowed:
                out.append(tok); i += len(tok); break
        else:
            rest += ipa[i]; i += 1
    return out, rest


def main():
    cfgs = sorted(os.path.basename(p)[:-5] for p in os.listdir(CFG) if p.endswith('.json'))
    rows = []
    for key in cfgs:
        try:
            c = json.load(open(os.path.join(CFG, key + '.json'), encoding='utf-8'))
        except Exception:
            continue
        pm = c.get('phoneme_id_map') or {}
        allowed = set(pm.keys())
        missing = []
        for t in TARGET:
            toks, rest = tokenize(t, allowed)
            if rest:
                missing.append(t)
        rows.append(dict(key=key, espeak=(c.get('espeak') or {}).get('voice'),
                         n_tokens=len(pm), covered=len(TARGET) - len(missing),
                         missing=missing))

    print('=' * 100)
    print('修正后的覆盖率（按 token 序列匹配；目标 %d 个音素）' % len(TARGET))
    print('=' * 100)
    cover = collections.Counter(r['covered'] for r in rows)
    print('  覆盖率分布：', dict(sorted(cover.items())))
    full = [r for r in rows if not r['missing']]
    print(f'  完全覆盖的语音：{len(full)}/{len(rows)} 个')
    part = sorted([r for r in rows if r['missing']], key=lambda x: len(x['missing']), reverse=True)
    print(f'  有缺失的语音（共 {len(part)} 个）：')
    for r in part[:12]:
        print(f"    {r['key']:<32} 缺 {r['missing']}")
    if part:
        cnt = collections.Counter(m for r in rows for m in r['missing'])
        print('  各音素的缺失频次（越高越「没人有」）：')
        for m, n in cnt.most_common():
            print(f'    {m:<6} 在 {n}/{len(rows)} 个语音中缺失')

    # ── 关键区分：符号有 vs 该语言的训练数据里真的有
    # 用「该语音的 espeak 语言」+ 语言族来近似判断哪些音素是「高风险」（该语系普遍没有）
    LANG_RISK = {
        'pʰ': '送气清塞音：日耳曼/罗曼语系普遍**没有独立的送气音位**（英语德语是同位异音），'
              'token 存在不等于模型学过音位对立',
        'tʰ': '同上',
        'kʰ': '同上',
        'r̥': '清化颤音：几乎没有任何现代语言有这个音位',
        'yː': '长圆唇前高元音：德语有 yː，罗曼语系没有',
        'ɛː': '德语有，意大利语没有',
        'ɔː': '英语有，多数语言没有',
        'eː': '德语/意大利语有',
        'oː': '德语有',
        'aː': '德语/意大利语有',
        'iː': '德语/意大利语有',
        'uː': '德语/意大利语有',
        'ŋ': '普遍有',
    }
    print()
    print('=' * 100)
    print('高风险音素（token 在表里，但目标语言可能从未训练过）')
    print('=' * 100)
    for k, v in LANG_RISK.items():
        n = sum(1 for r in rows if k in r['missing'])
        print(f'  {k:<5} 符号缺失于 {n}/{len(rows)} 个语音   {v}')

    json.dump(dict(n_voices=len(rows), target=TARGET, rows=rows,
                   fully_covered=len(full), risk=LANG_RISK),
              open(os.path.join(XL, 'piper_coverage_tokens.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f"\n→ {os.path.join(XL,'piper_coverage_tokens.json')}")


if __name__ == '__main__':
    main()
