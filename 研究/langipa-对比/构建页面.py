import json, pathlib, base64
d = pathlib.Path('/tmp/li_demo')
words = [('φωνή','pʰɔː.nɛ́ː'),('λόγος','ló.gos'),('ἄνθρωπος','ɑ́n.tʰrɔː.pos'),
         ('Ζεύς','zdeús'),('θυμός','tʰyː.mós'),('χείρ','kʰẹ́ːr')]
def b64(p):
    return base64.b64encode(p.read_bytes()).decode() if p.exists() else ''
rows = []
for w, ipa in words:
    rows.append(f'''<tr>
  <td class="w">{w}<div class="ipa">[{ipa}]</div></td>
  <td><audio controls preload="none" src="data:audio/wav;base64,{b64(d/f'espeak_{w}.wav')}"></audio>
      <div class="tag">eSpeak（现线上）</div></td>
  <td><audio controls preload="none" src="data:audio/wav;base64,{b64(d/f'{w}.wav')}"></audio>
      <div class="tag new">LangIpa（Klatt，按 IPA 逐音素）</div></td>
</tr>''')
html = f'''<!doctype html><meta charset="utf-8">
<title>LangIpa vs eSpeak · 古希腊语单词发音对比</title>
<style>
 body{{font:15px/1.6 -apple-system,"PingFang SC",sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1e293b}}
 h1{{font-size:20px;margin-bottom:4px}} .sub{{color:#64748b;font-size:13px;margin-bottom:24px}}
 table{{width:100%;border-collapse:collapse}}
 th,td{{padding:12px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}}
 th{{font-size:12px;color:#64748b;font-weight:600}}
 .w{{font-size:22px;font-family:"Gentium Plus",Georgia,serif;width:150px}}
 .ipa{{font-size:12px;color:#64748b;font-family:"Gentium Plus",serif}}
 audio{{width:230px;height:34px}}
 .tag{{font-size:11px;color:#94a3b8;margin-top:2px}} .tag.new{{color:#0d9488}}
 .note{{margin-top:28px;padding:14px;background:#f8fafc;border-left:3px solid #0d9488;font-size:13px;color:#475569}}
</style>
<h1>LangIpa vs eSpeak · 古希腊语单词发音</h1>
<div class="sub">同一个词、同一份 IPA 标注，两种合成方式。<b>请判断哪一列更接近你期望的发音。</b></div>
<table>
<tr><th>词 / IPA</th><th>eSpeak（当前线上）</th><th>LangIpa（Klatt 共振峰）</th></tr>
{''.join(rows)}
</table>
<div class="note">
<b>区别在哪：</b>eSpeak 的 grc 声音其实是借现代希腊语的音素表，
φ/θ/χ 一律读成擦音 [f θ x]；我此前是靠**文本替换**绕过去的。
LangIpa 是按 IPA 逐个音素合成，[pʰ tʰ kʰ]、[y]、[ɛː] 都是**直接指定**的，
不需要绕。另外它的音高是参数，配合现有的 PSOLA 可以做出真正的音高重音。
</div>'''
(d/'对比.html').write_text(html, encoding='utf-8')
print(f'  ✅ /tmp/li_demo/对比.html · {len(html)//1024}KB')
