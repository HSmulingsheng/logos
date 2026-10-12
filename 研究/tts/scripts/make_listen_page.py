#!/usr/bin/env python3
"""
生成一个**试听对比页**（out/试听对比.html）。

为什么需要它：研究脚本无法试听，所有「自然度」结论都必须由人来判断。
这个页面把三组音频并排放好，作者点一下就能 A/B。
"""
import json, os, html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'out')
DEMO = os.path.join(OUT, 'demo')
FIX = os.path.join(OUT, 'fixed')
AL = json.load(open(os.path.join(DEMO, 'align.json'), encoding='utf-8'))
ITEMS = {it['key']: it for it in AL['items']}

GROUPS = [
    ('A. 最小对立体：acute vs circumflex（原始 eSpeak 完全无法区分）', [
        ('min01_phos_circ', 'φῶς  光（circumflex）'),
        ('min02_phos_acute', 'φώς  男子（acute）'),
        ('min03_pos_circ', 'πῶς  怎么？（circumflex）'),
        ('min04_pos_acute', 'πώς  不知怎的（acute）'),
    ]),
    ('B. 重音位置 / 有无重音', [
        ('min05_pote_acute1', 'πότε  何时'),
        ('min06_pote_acute2', 'ποτέ  曾经'),
        ('min07_tis_acute', 'τίς  谁？'),
        ('min08_tis_none', 'τις  某人（无重音）'),
        ('min13_anthropos', 'ἄνθρωπος  人'),
        ('min14_anthropou', 'ἀνθρώπου  人的'),
        ('min09_eimi_acute', 'εἰμί  我是'),
        ('min10_eimi_circ', 'εἶμι  我将去'),
        ('min11_demos_circ', 'δῆμος  人民'),
        ('min12_demos_acute', 'δημός  脂肪'),
    ]),
    ('C. 隐藏长元音 / mora 时长', [
        ('len01_mythos', 'μῦθος  神话（ῡ 长，eSpeak 未标）'),
        ('len02_lyo', 'λύω  我解开（ῠ 短）'),
        ('len03_men', 'μήν  月份（η 长）'),
        ('len04_kakos', 'κακός  坏的'),
    ]),
    ('D. 长句', [
        ('sent01', 'ἐν ἀρχῇ ἦν ὁ λόγος'),
        ('sent02', 'ἄνθρωπός τις κατέβαινεν ἀπὸ Ἰερουσαλὴμ εἰς Ἰεριχώ'),
        ('sent03', 'σοφία ἀρχὴ εὐδαιμονίας'),
    ]),
]


def rel(p):
    return os.path.relpath(p, OUT).replace(os.sep, '/')


rows = []
for title, items in GROUPS:
    rows.append(f'<h2>{html.escape(title)}</h2>')
    rows.append('<table><tr><th>词</th><th>① 原始 eSpeak<br><small>共振峰合成</small></th>'
                '<th>② 对照：恒等 PSOLA<br><small>只重合成，不改任何参数</small></th>'
                '<th>③ 改造后<br><small>音高重音 + mora 时长</small></th>'
                '<th>音素串 (eSpeak IPA)</th></tr>')
    for key, label in items:
        it = ITEMS.get(key)
        if not it:
            continue
        cells = []
        for ver in ('base', 'resyn', 'fixed'):
            p = os.path.join(DEMO if ver == 'base' else FIX, f'{key}_{ver}.wav')
            if os.path.exists(p):
                cells.append(f'<audio controls preload="none" src="{rel(p)}"></audio>')
            else:
                cells.append('—')
        rows.append(f'<tr><td class="w">{html.escape(label)}</td>'
                    + ''.join(f'<td>{c}</td>' for c in cells)
                    + f'<td class="ipa">{html.escape(it["trace"])}</td></tr>')
    rows.append('</table>')

# 跨语言 piper 试听
xv = os.path.join(OUT, 'xling', 'piper_test')
piper = []
if os.path.isdir(xv):
    for fn in sorted(os.listdir(xv)):
        if fn.endswith('.wav'):
            piper.append(f'<li>{html.escape(fn)} — <audio controls preload="none" '
                         f'src="{rel(os.path.join(xv, fn))}"></audio></li>')
vow = os.path.join(OUT, 'xling', 'vowels')
if os.path.isdir(vow):
    for fn in sorted(os.listdir(vow)):
        if fn.endswith('.wav'):
            piper.append(f'<li>{html.escape(fn)} — <audio controls preload="none" '
                         f'src="{rel(os.path.join(vow, fn))}"></audio></li>')

doc = f"""<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>逻各斯 · 古希腊语 TTS 对比试听</title>
<style>
 body {{ font-family: -apple-system, "Songti SC", "Gentium", serif; margin: 2rem auto;
        max-width: 1100px; line-height: 1.7; color:#222; }}
 h1 {{ font-size: 1.5rem; }} h2 {{ font-size: 1.1rem; margin-top: 2rem;
        border-left: 4px solid #4472c4; padding-left: .6rem; }}
 table {{ border-collapse: collapse; width: 100%; margin: .6rem 0 1.4rem; }}
 th, td {{ border: 1px solid #ddd; padding: .45rem .55rem; vertical-align: middle;
          font-size: .86rem; }}
 th {{ background: #f5f7fa; font-weight: 600; }}
 td.w {{ width: 12rem; font-size: 1rem; }}
 td.ipa {{ font-family: "Gentium", monospace; font-size: .8rem; color:#555; }}
 audio {{ width: 190px; height: 30px; }}
 .warn {{ background: #fff8e1; border: 1px solid #ffe082; padding: .8rem 1rem;
          border-radius: 6px; }}
 code {{ background:#f2f2f2; padding:.1rem .3rem; border-radius:3px; }}
</style></head><body>
<h1>逻各斯 · 古希腊语 TTS 对比试听</h1>
<div class="warn">
<b>请务必这样听：</b>三列依次是「原始 eSpeak」→「只做重合成、不改任何参数的对照」→
「改造后（音高重音 + mora 时长）」。<b>先比 ① 和 ②，确认差异不是重合成本身造成的；
再比 ② 和 ③，那才是韵律改造的净效果。</b><br>
研究脚本<b>无法试听</b>，所以「哪个更自然」只能由你判断——报告里只给了可测量的声学量。
试听时请戴耳机，并注意：改造版的谐噪比（HNR）实测平均下降 2–4 dB，
在单个长元音上最差可达 −8.5 dB，这一点需要你的耳朵来裁决是否可接受。
</div>
{''.join(rows)}
<h2>E. 跨语言神经声码器实验（德语 Piper 吃希腊 IPA）</h2>
<p>这些是用 <code>onnxruntime</code> 直接驱动德语语音模型
<code>de_DE-thorsten-medium</code>、手工构造音素 id 序列合成的结果。
文件名里的 <code>piper_*</code> 是孤立元音，<code>de_ctrl_*</code> 是真实德语词对照。</p>
<ul>{''.join(piper) if piper else '<li>（无）</li>'}</ul>
<h2>F. 图</h2>
<ul>
 <li><a href="对比图.png">对比图.png</a> — F0 曲线、幅度权衡、F0 范围、时长</li>
 <li><a href="元音空间对比.png">元音空间对比.png</a> — eSpeak vs 德语神经语音的 F1/F2 舌位图</li>
</ul>
</body></html>
"""
p = os.path.join(OUT, '试听对比.html')
open(p, 'w', encoding='utf-8').write(doc)
print('→', p)
print('音频条目数:', doc.count('<audio'))
