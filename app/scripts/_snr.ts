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
console.log('  词           零位移相关   SNR(dB)   最大绝对误差(占峰值)')
for (const t of ['λόγος', 'ἄνθρωπος', 'φῶς', 'ὁ', 'ἐν ἀρχῇ ἦν ὁ λόγος']) {
  const x = synth(t)
  const tr = pitchTrack(x, SR)
  const { marks } = pitchMarks(x, SR, 70, 400, tr)
  const y = tdPsola(x, SR, idCurve(marks), { marks })
  const n = Math.min(x.length, y.length)
  let sx = 0, sd = 0, peak = 0, maxd = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - y[i]
    sx += x[i]*x[i]; sd += d*d
    const ax = Math.abs(x[i]); if (ax > peak) peak = ax
    const ad = Math.abs(d); if (ad > maxd) maxd = ad
  }
  const snr = 10*Math.log10(sx / Math.max(sd, 1e-12))
  let mx=0,my=0; for(let i=0;i<n;i++){mx+=x[i];my+=y[i]} mx/=n;my/=n
  let a=0,b=0,c=0; for(let i=0;i<n;i++){const u=x[i]-mx,v=y[i]-my;a+=u*v;b+=u*u;c+=v*v}
  const corr = a/Math.sqrt(b*c)
  console.log(`  ${t.slice(0,12).padEnd(13)} ${corr.toFixed(4)}      ${snr.toFixed(1).padStart(6)}   ${(maxd/peak*100).toFixed(1)}%`)
}
