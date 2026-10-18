import { pitchMarks, pitchTrack, tdPsola } from '../src/lib/psola'
const Mod = (await import('../public/espeak/espeak-ng.js')).default
const M: any = await (typeof Mod === 'function' ? (Mod as any)() : Mod)
const w = new M.eSpeakNGWorker(); const SR = w.get_samplerate()
w.set_rate(168); w.set_range(60); w.set_pitch(50); w.set_voice('grc')
function synth(t: string) {
  const ps: Int16Array[] = []
  w.synthesize(t, (d: Int16Array) => { if (d) ps.push(d); return false })
  let n = 0; for (const p of ps) n += p.length
  const i16 = new Int16Array(n); let o = 0
  for (const p of ps) { i16.set(p, o); o += p.length }
  const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = i16[i] / 32768
  return f
}
function idCurve(m: number[]) { const p: [number, number][] = []; for (let i = 0; i + 1 < m.length; i++) { const f = 1 / (m[i+1] - m[i]); p.push([m[i], f], [m[i+1], f]) } return p.sort((a,b)=>a[0]-b[0]) }
for (const t of ['λόγος', 'ἄνθρωπος', 'φῶς']) {
  const x = synth(t)
  const tr = pitchTrack(x, SR)
  const { marks } = pitchMarks(x, SR, 70, 400, tr)
  const y = tdPsola(x, SR, idCurve(marks), { marks })
  const n = Math.min(x.length, y.length)
  // 每 20ms 一段的误差能量，定位误差集中在哪
  const win = Math.round(0.02 * SR)
  const errs: { at: number; e: number }[] = []
  for (let i = 0; i + win < n; i += win) {
    let ex = 0, ey = 0
    for (let k = i; k < i + win; k++) { const d = x[k] - y[k]; ex += d*d; ey += x[k]*x[k] }
    errs.push({ at: i / SR, e: Math.sqrt(ex / Math.max(ey, 1e-9)) })
  }
  // 有声段边界
  const gaps: number[] = []; for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i-1])
  const med = [...gaps].sort((a,b)=>a-b)[gaps.length >> 1]
  const seams: number[] = []
  for (let i = 0; i < gaps.length; i++) if (gaps[i] > 2.5 * med) seams.push(marks[i])
  const bad = errs.filter(e => e.e > 0.3)
  console.log(`  ${t.padEnd(10)} 标记 ${String(marks.length).padStart(3)} · 段缝 ${seams.length} 处 ${seams.map(s=>s.toFixed(2)).join(',')}`)
  console.log(`     误差>30% 的 20ms 格子: ${bad.length}/${errs.length}  最差 ${(Math.max(...errs.map(e=>e.e))*100).toFixed(0)}%`)
  console.log(`     误差分布: ${errs.filter((_,i)=>i%4===0).map(e=>`${e.at.toFixed(2)}:${(e.e*100).toFixed(0)}%`).join(' ')}`)
}
