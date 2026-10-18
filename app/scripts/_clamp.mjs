// src/lib/psola.ts
function pitchTrack(x, sr, floor = 70, ceiling = 400, hopSec = 0.01, winSec = 0.04) {
  const y = x;
  const sr2 = sr;
  const hop = Math.max(1, Math.round(hopSec * sr2));
  const win = Math.max(8, Math.round(winSec * sr2));
  const lagMin = Math.max(2, Math.floor(sr2 / ceiling));
  const lagMax = Math.min(win - 2, Math.ceil(sr2 / floor));
  const times = [];
  const f0 = [];
  const half = win >> 1;
  for (let c = 0; c + half < y.length; c += hop) {
    const a = Math.max(0, c - half);
    const b = Math.min(y.length, c + half);
    const n = b - a;
    if (n < lagMax + 2) {
      times.push(c / sr2);
      f0.push(0);
      continue;
    }
    let e = 0;
    for (let i = a; i < b; i++) e += y[i] * y[i];
    if (Math.sqrt(e / n) < 1e-4) {
      times.push(c / sr2);
      f0.push(0);
      continue;
    }
    const rAt = (lag) => {
      let num = 0, d1 = 0, d2 = 0;
      const m = n - lag;
      for (let i = 0; i < m; i++) {
        const u = y[a + i], v = y[a + i + lag];
        num += u * v;
        d1 += u * u;
        d2 += v * v;
      }
      const den = Math.sqrt(d1 * d2);
      return den > 1e-12 ? num / den : 0;
    };
    let bestLag = lagMin, bestR = -1;
    for (let lag = lagMin; lag <= lagMax; lag += 3) {
      const r = rAt(lag);
      if (r > bestR) {
        bestR = r;
        bestLag = lag;
      }
    }
    for (let lag = Math.max(lagMin, bestLag - 3); lag <= Math.min(lagMax, bestLag + 3); lag++) {
      const r = rAt(lag);
      if (r > bestR) {
        bestR = r;
        bestLag = lag;
      }
    }
    if (bestR >= 0.42 && bestLag > 0) {
      let lag = bestLag;
      if (lag > lagMin && lag < lagMax) {
        const rAt2 = (l) => {
          let num = 0, d1 = 0, d2 = 0;
          const m = n - l;
          for (let i = 0; i < m; i++) {
            const u = x[a + i], v = x[a + i + l];
            num += u * v;
            d1 += u * u;
            d2 += v * v;
          }
          const den = Math.sqrt(d1 * d2);
          return den > 1e-12 ? num / den : 0;
        };
        const r0 = rAt2(lag - 1), r1 = bestR, r2 = rAt2(lag + 1);
        const dd = r0 - 2 * r1 + r2;
        if (Math.abs(dd) > 1e-12) lag = lag + 0.5 * (r0 - r2) / dd;
      }
      times.push(c / sr2);
      f0.push(sr2 / lag);
    } else {
      times.push(c / sr2);
      f0.push(0);
    }
  }
  return { times, f0 };
}
function pitchMarks(x, sr, floor = 70, ceiling = 400, precomputed) {
  const { times, f0 } = precomputed ?? pitchTrack(x, sr, floor, ceiling);
  const segs = [];
  let st = -1;
  for (let i = 0; i < f0.length; i++) {
    const voiced = f0[i] > 0;
    if (voiced && st < 0) st = i;
    if (st >= 0 && (!voiced || i === f0.length - 1)) {
      segs.push([st, voiced ? i : i - 1]);
      st = -1;
    }
  }
  const periodAt = (t) => {
    const f = sampleF0(times, f0, t);
    return f > 0 ? 1 / f : 1 / 120;
  };
  const marks = [];
  for (const [i0, i1] of segs) {
    if (i1 < i0) continue;
    const a = Math.max(0, Math.round(times[i0] * sr));
    const b = Math.min(x.length - 1, Math.round((times[i1] + 0.01) * sr));
    if (b - a < 8) continue;
    let anchor = -1, best = 0;
    for (let i = a; i <= b; i++) {
      const v = x[i] > 0 ? x[i] : -x[i];
      if (v > best) {
        best = v;
        anchor = i;
      }
    }
    if (anchor < 0 || best <= 1e-5) continue;
    const snap = (i, T) => {
      const r = Math.max(1, Math.round(0.25 * T * sr));
      let bi = i, bv = -Infinity;
      for (let k = Math.max(a, i - r); k <= Math.min(b, i + r); k++) {
        if (x[k] > bv) {
          bv = x[k];
          bi = k;
        }
      }
      return bi;
    };
    const local = [anchor / sr];
    let cur = anchor;
    while (true) {
      const T = periodAt(cur / sr);
      const nxt = snap(Math.round(cur + T * sr), T);
      if (nxt <= a || nxt > b || nxt <= cur) break;
      local.push(nxt / sr);
      cur = nxt;
    }
    cur = anchor;
    while (true) {
      const T = periodAt(cur / sr);
      const prv = snap(Math.round(cur - T * sr), T);
      if (prv < a || prv >= b || prv >= cur) break;
      local.push(prv / sr);
      cur = prv;
    }
    local.sort((p, q) => p - q);
    marks.push(...local);
  }
  if (marks.length < 3) {
    const f = sampleF0(times, f0, 0) || 120;
    for (let t = 0; t < x.length / sr; t += 1 / f) marks.push(t);
  }
  return { marks, times, f0 };
}
function sampleF0(times, f0, t) {
  if (!times.length) return 0;
  if (t <= times[0]) return f0[0];
  const last = times.length - 1;
  if (t >= times[last]) return f0[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const d = times[hi] - times[lo];
  if (d <= 0) return f0[hi];
  const u = (t - times[lo]) / d;
  return f0[lo] * (1 - u) + f0[hi] * u;
}

// scripts/_clamp.ts
var Mod = (await import("../public/espeak/espeak-ng.js")).default;
var M = await (typeof Mod === "function" ? Mod() : Mod);
var w = new M.eSpeakNGWorker();
var SR = w.get_samplerate();
w.set_rate(168);
w.set_range(60);
w.set_pitch(50);
w.set_voice("grc");
function synth(t) {
  const ps = [];
  w.synthesize(t, (d) => {
    if (d) ps.push(d);
    return false;
  });
  let n = 0;
  for (const p of ps) n += p.length;
  const i16 = new Int16Array(n);
  let o = 0;
  for (const p of ps) {
    i16.set(p, o);
    o += p.length;
  }
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = i16[i] / 32768;
  return f;
}
console.log("  \u8BCD           \u6807\u8BB0  \u95F4\u9694ms(\u6700\u5C0F~\u6700\u5927)   fAnal \u8D8A\u754C\u6570(<70 \u6216 >400)   \u6F02\u79FB\u4F30\u8BA1(ms)");
for (const t of ["\u03BB\u03CC\u03B3\u03BF\u03C2", "\u1F04\u03BD\u03B8\u03C1\u03C9\u03C0\u03BF\u03C2", "\u03C6\u1FF6\u03C2", "\u1F41"]) {
  const x = synth(t);
  const tr = pitchTrack(x, SR);
  const { marks } = pitchMarks(x, SR, 70, 400, tr);
  const gaps = [];
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1]);
  const f = gaps.map((g) => 1 / g);
  const lo = f.filter((v) => v < 70).length, hi = f.filter((v) => v > 400).length;
  let drift = 0;
  for (const v of f) {
    const cl = Math.min(Math.max(v, 70), 400);
    const Pa = 1 / v;
    drift += Pa * (v / cl) - Pa;
  }
  console.log(`  ${t.padEnd(11)} ${String(marks.length).padStart(3)}   ${(Math.min(...gaps) * 1e3).toFixed(1)}~${(Math.max(...gaps) * 1e3).toFixed(1)}      ${lo} / ${hi}                  ${(drift * 1e3).toFixed(2)}`);
}
