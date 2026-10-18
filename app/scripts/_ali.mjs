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
function tdPsola(x, sr, f0Pts, opts = {}) {
  const floor = opts.floor ?? 70;
  const ceiling = opts.ceiling ?? 400;
  const N = x.length;
  const T_a = N / sr;
  let fwd = (t) => t;
  let inv = (u) => u;
  const anchors = opts.durAnchors;
  if (anchors && anchors.length >= 2) {
    const a = [...anchors].sort((p, q) => p[0] - q[0]);
    const xs = a.map((p) => p[0]);
    const ys = a.map((p) => p[1]);
    if (xs[0] > 0) {
      xs.unshift(0);
      ys.unshift(0);
    }
    const lin = (t, X, Y) => {
      if (t <= X[0]) return Y[0];
      if (t >= X[X.length - 1]) return Y[Y.length - 1];
      let lo = 0, hi = X.length - 1;
      while (hi - lo > 1) {
        const m = lo + hi >> 1;
        if (X[m] <= t) lo = m;
        else hi = m;
      }
      const d = X[hi] - X[lo];
      return d <= 0 ? Y[hi] : Y[lo] + (Y[hi] - Y[lo]) * (t - X[lo]) / d;
    };
    fwd = (t) => lin(t, xs, ys);
    inv = (u) => lin(u, ys, xs);
  }
  const T_s = fwd(T_a);
  const N_s = Math.max(1, Math.round(T_s * sr));
  const pad = Math.round(sr * 0.02);
  const out = new Float64Array(N_s + 2 * pad);
  const wsum = new Float64Array(N_s + 2 * pad);
  const marks = opts.marks ?? pitchMarks(x, sr, floor, ceiling).marks;
  if (marks.length < 3) return x.slice();
  const slopeAt = (t) => {
    if (!anchors || anchors.length < 2) return 1;
    const e = 1e-4;
    return (fwd(t + e) - fwd(t - e)) / (2 * e);
  };
  const gaps = [];
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 0.01;
  const segs = [];
  let st = 0;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > 2.5 * med) {
      segs.push([st, i]);
      st = i + 1;
    }
  }
  segs.push([st, marks.length - 1]);
  const hann = (L) => {
    const w2 = new Float64Array(L);
    for (let i = 0; i < L; i++) w2[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1));
    return w2;
  };
  for (const [i0, i1] of segs) {
    if (i1 - i0 < 2) continue;
    let u = fwd(marks[i0]);
    for (let j = i0; j < i1; j++) {
      const Pa = marks[j + 1] - marks[j];
      if (!(Pa > 0)) continue;
      const fAnal = 1 / Pa;
      let fTar = interpPts(f0Pts, marks[j]);
      fTar = Math.min(Math.max(fTar, floor), ceiling);
      const L = Math.max(Math.round(2 * Pa * sr), 8);
      const c = Math.round(marks[j] * sr);
      const a0 = c - (L >> 1);
      const seg = new Float64Array(L);
      const s0 = Math.max(a0, 0), s1 = Math.min(a0 + L, N);
      if (s1 > s0) for (let i = s0; i < s1; i++) seg[i - a0] = x[i];
      const w2 = hann(L);
      const p = Math.round(u * sr) - (L >> 1) + pad;
      const p0 = Math.max(p, 0), p1 = Math.min(p + L, out.length);
      for (let i = p0; i < p1; i++) {
        const k = i - p;
        out[i] += seg[k] * w2[k];
        wsum[i] += w2[k];
      }
      u += Pa * (fAnal / fTar) * slopeAt(marks[j]);
    }
  }
  const y = new Float32Array(N_s);
  for (let i = 0; i < N_s; i++) {
    const ta = inv(i / sr);
    const src = ta * sr;
    const i0 = Math.floor(src);
    const frac = src - i0;
    const a = i0 >= 0 && i0 < N ? x[i0] : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < N ? x[i0 + 1] : 0;
    const core = pad + i;
    y[i] = wsum[core] > 0.35 ? out[core] / Math.max(wsum[core], 1e-9) : a + (b - a) * frac;
  }
  return y;
}
function interpPts(pts, t) {
  if (!pts.length) return 120;
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return last[1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = lo + hi >> 1;
    if (pts[m][0] <= t) lo = m;
    else hi = m;
  }
  const d = pts[hi][0] - pts[lo][0];
  return d <= 0 ? pts[hi][1] : pts[lo][1] + (pts[hi][1] - pts[lo][1]) * (t - pts[lo][0]) / d;
}

// scripts/_ali.ts
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
function idCurve(m) {
  const p = [];
  for (let i = 0; i + 1 < m.length; i++) {
    const f = 1 / (m[i + 1] - m[i]);
    p.push([m[i], f], [m[i + 1], f]);
  }
  return p.sort((a, b) => a[0] - b[0]);
}
function bestCorr(x, y, maxShift = 60) {
  let best = -2, bestS = 0;
  for (let s = -maxShift; s <= maxShift; s++) {
    const a0 = Math.max(0, -s), b0 = Math.min(x.length, x.length - s);
    const n = b0 - a0;
    if (n < 100) continue;
    let mx = 0, my = 0;
    for (let i = a0; i < b0; i++) {
      mx += x[i];
      my += y[i + s];
    }
    mx /= n;
    my /= n;
    let num = 0, d1 = 0, d2 = 0;
    for (let i = a0; i < b0; i++) {
      const u = x[i] - mx, v = y[i + s] - my;
      num += u * v;
      d1 += u * u;
      d2 += v * v;
    }
    const c = num / Math.sqrt(Math.max(d1 * d2, 1e-12));
    if (c > best) {
      best = c;
      bestS = s;
    }
  }
  return { c: best, shift: bestS };
}
function segShifts(x, y) {
  const win = Math.round(0.04 * SR);
  const out = [];
  for (let i = 0; i + win < Math.min(x.length, y.length); i += win) {
    const xs = x.subarray(i, i + win), ys = y.subarray(i, i + win);
    const r = bestCorr(xs, ys, 40);
    out.push({ at: i / SR, c: r.c, s: r.shift });
  }
  return out;
}
console.log("  \u8BCD          \u96F6\u4F4D\u79FB\u76F8\u5173   \u6700\u4F73\u4F4D\u79FB\u76F8\u5173  (\u4F4D\u79FB)   \u5206\u6BB5\u4F4D\u79FB\u8303\u56F4");
for (const t of ["\u03BB\u03CC\u03B3\u03BF\u03C2", "\u1F04\u03BD\u03B8\u03C1\u03C9\u03C0\u03BF\u03C2", "\u03C6\u1FF6\u03C2", "\u1F41"]) {
  const x = synth(t);
  const tr = pitchTrack(x, SR);
  const { marks } = pitchMarks(x, SR, 70, 400, tr);
  const y = tdPsola(x, SR, idCurve(marks), { marks });
  const n = Math.min(x.length, y.length);
  const zero = (() => {
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      mx += x[i];
      my += y[i];
    }
    mx /= n;
    my /= n;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const u = x[i] - mx, v = y[i] - my;
      a += u * v;
      b += u * u;
      c += v * v;
    }
    return a / Math.sqrt(b * c);
  })();
  const bc = bestCorr(x, y);
  const ss = segShifts(x, y);
  const shifts = ss.map((s) => s.s);
  console.log(`  ${t.padEnd(11)} ${zero.toFixed(4)}       ${bc.c.toFixed(4)} (${bc.shift})   ${Math.min(...shifts)}~${Math.max(...shifts)} \u91C7\u6837  \u6700\u5DEE\u6BB5\u76F8\u5173 ${Math.min(...ss.map((s) => s.c)).toFixed(3)}`);
}
