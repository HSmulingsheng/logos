/**
 * 生成「原始 eSpeak vs 音高重音改造后」的试听对比页。
 *
 * 为什么要生成这个：本会话**没有音频播放能力**，任何「更自然」的判断都不成立。
 * 唯一可靠的验收是作者亲自 A/B。所以这里只负责把两组音频摆在一起。
 *
 * 对比刻意做成**三列**，避免把「重新合成的固有损失」误当成改进：
 *   ① 原始 eSpeak
 *   ② 恒等 PSOLA（走同一套代码但目标 F0 = 原 F0，不改调型）
 *   ③ 改造后（acute 升 / circumflex 降）
 * 先比 ① 与 ②（应当几乎听不出差别），再比 ② 与 ③（差别才是重音改造带来的）。
 *
 * 用法: node scripts/make-prosody-demo.mjs [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { planAccent, restoreAncientPhonetics } from '../src/lib/prosody'
import { pitchMarks, pitchTrack, tdPsola } from '../src/lib/psola'

const OUT = process.argv[2] || '研究/ts-prosody'
mkdirSync(OUT, { recursive: true })

const Mod = (await import('../public/espeak/espeak-ng.js')).default
const M = await (typeof Mod === 'function' ? Mod() : Mod)
const w = new M.eSpeakNGWorker()
const SR = w.get_samplerate()
w.set_rate(168); w.set_range(60); w.set_pitch(50); w.set_voice('grc')

/** 合成并同时拿到 PCM 与事件 */
function synth(text) {
  const parts = []
  const events = []
  w.synthesize(text, (d, e) => {
    if (d) parts.push(d)
    if (e) events.push(...(Array.isArray(e) ? e : [e]))
    return false
  })
  let n = 0
  for (const p of parts) n += p.length
  const i16 = new Int16Array(n)
  let o = 0
  for (const p of parts) { i16.set(p, o); o += p.length }
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = i16[i] / 32768
  return { x: f, events }
}

function wav(x, sr) {
  const n = x.length
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, x[i]))
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return b
}

const medF0 = (x) => {
  const { f0 } = pitchTrack(x, SR)
  const v = f0.filter((a) => a > 0).sort((a, b) => a - b)
  return v.length ? v[v.length >> 1] : 0
}

/** 四列处理：原始 / 恒等 / 音高重音 / 音高重音＋古音还原 */
function processQuad(text, amp = 1) {
  const restored = restoreAncientPhonetics(text)
  const { x, events } = synth(text)           // 原始（未还原）
  const { x: xr, events: evr } = synth(restored)  // 还原古音后的合成
  const dur = x.length / SR
  const { f0 } = pitchTrack(x, SR)
  const voiced = f0.filter((v) => v > 0).sort((a, b) => a - b)
  const base = voiced.length ? voiced[voiced.length >> 1] : 110
  const { marks } = pitchMarks(x, SR)

  // ② 恒等：目标 F0 取自标记间隔本身（走完整 PSOLA，但不改调型）
  const idPts = []
  for (let i = 0; i + 1 < marks.length; i++) {
    const f = 1 / (marks[i + 1] - marks[i])
    idPts.push([marks[i], f], [marks[i + 1], f])
  }
  idPts.sort((a, b) => a[0] - b[0])
  const yId = tdPsola(x, SR, idPts, { marks })

  // ③ 只加音高重音
  const plan = planAccent(events, text, dur, base, amp)
  const yFix = tdPsola(x, SR, plan.points, { marks })

  // ④ 音高重音 + 古音还原（送气塞音 φθχ、ζ=[zd]）
  const durR = xr.length / SR
  const tr2 = pitchTrack(xr, SR)
  const v2 = tr2.f0.filter((v) => v > 0).sort((a, b) => a - b)
  const base2 = v2.length ? v2[v2.length >> 1] : 110
  const mk2 = pitchMarks(xr, SR, 70, 400, tr2).marks
  const plan2 = planAccent(evr, restored, durR, base2, amp)
  const yRest = tdPsola(xr, SR, plan2.points, { marks: mk2, durAnchors: plan2.durAnchors })

  return { x, yId, yFix, yRest, xr, base, roles: plan.roles, dur, restored }
}

const CASES = [
  ['min01_phos_acute', 'φώς', '尖音（acute）——高调应在音节末'],
  ['min02_phos_circ', 'φῶς', '曲折号（circumflex）——峰在音节中部后下降'],
  ['min03_pos_acute', 'πώς', '尖音'],
  ['min04_pos_circ', 'πῶς', '曲折号'],
  ['min05_tis_acute', 'τίς', '疑问词「谁」——带重音'],
  ['min06_tis_none', 'τις', '不定代词「某个」——**不带**重音'],
  ['min07_anthropos', 'ἄνθρωπος', '三音节，重音在倒数第三'],
  ['min08_logos', 'λόγος', '两音节'],
  ['min09_eimi_acute', 'εἰμί', '尖音'],
  ['min10_eimi_circ', 'εἶμι', '曲折号（与上一词仅重音不同）'],
  ['sen01_archi', 'ἐν ἀρχῇ ἦν ὁ λόγος', '整句'],
  ['sen02_homer', 'μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος', '荷马《伊利亚特》首行'],
]

const rows = []
console.log('生成对比音频…')
for (const [id, text, note] of CASES) {
  const r = processQuad(text)
  writeFileSync(join(OUT, `${id}_1orig.wav`), wav(r.x, SR))
  writeFileSync(join(OUT, `${id}_2ident.wav`), wav(r.yId, SR))
  writeFileSync(join(OUT, `${id}_3fixed.wav`), wav(r.yFix, SR))
  writeFileSync(join(OUT, `${id}_4restored.wav`), wav(r.yRest, SR))
  const f0o = medF0(r.x), f0i = medF0(r.yId), f0f = medF0(r.yFix), f0r = medF0(r.yRest)
  const accents = r.roles.map((x) => `${x.ipa}:${x.accent}`).join(' ')
  rows.push({ id, text, restored: r.restored, note, f0o, f0i, f0f, f0r, dur: r.dur, base: r.base, accents })
  console.log(`  ${text.slice(0, 22).padEnd(24)} F0 ${f0o.toFixed(0)} / ${f0i.toFixed(0)} / ${f0f.toFixed(0)} / ${f0r.toFixed(0)} Hz`)
}

// ---------------------------------------------------------------- 试听页
const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>逻各斯 · 音高重音改造试听</title>
<style>
 body{font:15px/1.7 -apple-system,"PingFang SC",sans-serif;max-width:900px;margin:0 auto;padding:28px 20px 80px;background:#f7f8fa;color:#1e2530}
 h1{font-size:21px;margin:0 0 6px}
 .lead{color:#64748b;font-size:13px;margin-bottom:22px}
 .warn{background:#fff7ed;border-left:3px solid #f59e0b;padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:22px}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
 th,td{padding:11px 12px;text-align:left;border-bottom:1px solid #eceef2;font-size:13px;vertical-align:top}
 th{background:#f2f4f7;font-size:12px;color:#4e5b70;font-weight:600}
 tr:last-child td{border-bottom:none}
 .g{font-family:"Gentium Plus",serif;font-size:21px;line-height:1.35}
 audio{width:100%;max-width:210px;height:32px}
 .note{color:#8494aa;font-size:11.5px}
 .hz{font-variant-numeric:tabular-nums;color:#64748b;font-size:11.5px;white-space:nowrap}
 code{background:#f2f4f7;padding:1px 5px;border-radius:4px;font-size:11.5px}
</style></head><body>
<h1>音高重音改造 · A/B 试听</h1>
<p class="lead">eSpeak 的 grc 语音<strong>完全没有实现古希腊语的音高重音</strong>：<span class="g">φῶς</span> 与 <span class="g">φώς</span> 的输出逐字符相同，整词 F0 差 0.1 Hz。这里用 TD-PSOLA 在波形上补出阿提卡调型。</p>
<div class="warn" style="background:#eff9ff;border-left-color:#06a3f0">
<b>④ 是「还原古音」</b>：eSpeak 的希腊语音素表继承自现代希腊语，把 φ θ χ 读成擦音 [f θ x]、ζ 读成 [z]，
而阿提卡重建是送气塞音 [pʰ tʰ kʰ] 与 [zd]。④ 用纯文本替换（φ→πɦ 等）触发正确的音素，无需重编译 WASM。
请重点对比 ③ 与 ④ 里的 <span class="greek">φῶς</span> <span class="greek">θεός</span> <span class="greek">Ζεύς</span>。</div>
<div class="warn"><b>请按这个顺序听：</b>先比 <b>①原始</b> 与 <b>②恒等</b>（两者应当几乎听不出差别，说明 PSOLA 本身没引入明显损失）；
<b>再比 ②恒等 与 ③改造后</b>——这一对的差别才是重音改造带来的。<br>
直接比 ① 与 ③ 会把「重新合成的固有损失」误当成改进。</div>
<table>
<thead><tr><th style="width:20%">词／句</th><th style="width:20%">① 原始 eSpeak</th><th style="width:19%">② 恒等 PSOLA</th><th style="width:20%">③ 音高重音</th><th style="width:21%">④ 音高重音＋<b>古音还原</b></th></tr></thead>
<tbody>
${rows.map((r) => `<tr>
  <td><div class="g">${r.text}</div><div class="note">${r.note}</div>
      <div class="hz">${r.accents || '（无元音）'}</div></td>
  <td><audio controls preload="none" src="${r.id}_1orig.wav"></audio><div class="hz">F0 中位 ${r.f0o.toFixed(0)} Hz</div></td>
  <td><audio controls preload="none" src="${r.id}_2ident.wav"></audio><div class="hz">F0 中位 ${r.f0i.toFixed(0)} Hz</div></td>
  <td><audio controls preload="none" src="${r.id}_3fixed.wav"></audio><div class="hz">F0 中位 ${r.f0f.toFixed(0)} Hz</div></td>
  <td><audio controls preload="none" src="${r.id}_4restored.wav"></audio>
      <div class="hz">F0 中位 ${r.f0r.toFixed(0)} Hz</div>
      ${r.restored !== r.text ? `<div class="note" style="color:#0082cd">φθχ→送气 · ζ→[zd]</div>` : ''}</td>
</tr>`).join('\n')}
</tbody></table>
<p class="lead" style="margin-top:22px">幅度可在 App 的「我的 → 例句朗读 → 重音幅度」里调。
本页用的是默认幅度 <code>1.0</code>（约 +6.4 半音）。</p>
</body></html>`
writeFileSync(join(OUT, '试听对比.html'), html)
console.log(`\n  试听页: ${join(OUT, '试听对比.html')}`)
console.log(`  共 ${rows.length} 组 × 4 列 = ${rows.length * 4} 个音频`)
