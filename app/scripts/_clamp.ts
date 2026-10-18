import { pitchMarks, pitchTrack } from '../src/lib/psola'
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
console.log('  词           标记  间隔ms(最小~最大)   fAnal 越界数(<70 或 >400)   漂移估计(ms)')
for (const t of ['λόγος', 'ἄνθρωπος', 'φῶς', 'ὁ']) {
  const x = synth(t)
  const tr = pitchTrack(x, SR)
  const { marks } = pitchMarks(x, SR, 70, 400, tr)
  const gaps: number[] = []
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i-1])
  const f = gaps.map(g => 1/g)
  const lo = f.filter(v => v < 70).length, hi = f.filter(v => v > 400).length
  // 若 fAnal 被 clamp，累加的位置误差
  let drift = 0
  for (const v of f) {
    const cl = Math.min(Math.max(v, 70), 400)
    const Pa = 1/v
    drift += Pa * (v / cl) - Pa
  }
  console.log(`  ${t.padEnd(11)} ${String(marks.length).padStart(3)}   ${(Math.min(...gaps)*1000).toFixed(1)}~${(Math.max(...gaps)*1000).toFixed(1)}      ${lo} / ${hi}                  ${(drift*1000).toFixed(2)}`)
}
