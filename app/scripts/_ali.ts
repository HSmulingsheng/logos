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
/** 在 ±60 采样内搜索最佳位移后的相关系数 */
function bestCorr(x: Float32Array, y: Float32Array, maxShift = 60) {
  let best = -2, bestS = 0
  for (let s = -maxShift; s <= maxShift; s++) {
    const a0 = Math.max(0, -s), b0 = Math.min(x.length, x.length - s)
    const n = b0 - a0
    if (n < 100) continue
    let mx = 0, my = 0
    for (let i = a0; i < b0; i++) { mx += x[i]; my += y[i + s] }
    mx /= n; my /= n
    let num = 0, d1 = 0, d2 = 0
    for (let i = a0; i < b0; i++) { const u = x[i]-mx, v = y[i+s]-my; num += u*v; d1 += u*u; d2 += v*v }
    const c = num / Math.sqrt(Math.max(d1*d2, 1e-12))
    if (c > best) { best = c; bestS = s }
  }
  return { c: best, shift: bestS }
}
/** 分段（每 40ms）最佳位移 —— 若位移随处变化，说明是时变偏移（会听出抖动） */
function segShifts(x: Float32Array, y: Float32Array) {
  const win = Math.round(0.04 * SR)
  const out: { at: number; c: number; s: number }[] = []
  for (let i = 0; i + win < Math.min(x.length, y.length); i += win) {
    const xs = x.subarray(i, i + win), ys = y.subarray(i, i + win)
    const r = bestCorr(xs, ys, 40)
    out.push({ at: i / SR, c: r.c, s: r.shift })
  }
  return out
}
console.log('  词          零位移相关   最佳位移相关  (位移)   分段位移范围')
for (const t of ['λόγος', 'ἄνθρωπος', 'φῶς', 'ὁ']) {
  const x = synth(t)
  const tr = pitchTrack(x, SR)
  const { marks } = pitchMarks(x, SR, 70, 400, tr)
  const y = tdPsola(x, SR, idCurve(marks), { marks })
  const n = Math.min(x.length, y.length)
  const zero = (() => { let mx=0,my=0; for (let i=0;i<n;i++){mx+=x[i];my+=y[i]} mx/=n;my/=n
    let a=0,b=0,c=0; for(let i=0;i<n;i++){const u=x[i]-mx,v=y[i]-my;a+=u*v;b+=u*u;c+=v*v}
    return a/Math.sqrt(b*c) })()
  const bc = bestCorr(x, y)
  const ss = segShifts(x, y)
  const shifts = ss.map(s => s.s)
  console.log(`  ${t.padEnd(11)} ${zero.toFixed(4)}       ${bc.c.toFixed(4)} (${bc.shift})   ${Math.min(...shifts)}~${Math.max(...shifts)} 采样  最差段相关 ${Math.min(...ss.map(s=>s.c)).toFixed(3)}`)
}
