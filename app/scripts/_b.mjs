// src/lib/prosody.ts
var ACUTE = "\u0301";
var GRAVE = "\u0300";
var PERISP = "\u0342";
var COMBINING = /[\u0300-\u0345]/;
var BASIC_VOWELS = "\u03B1\u03B5\u03B7\u03B9\u03BF\u03C5\u03C9";
var DIPHTHONGS = /* @__PURE__ */ new Set(["\u03B1\u03B9", "\u03B5\u03B9", "\u03BF\u03B9", "\u03C5\u03B9", "\u03B1\u03C5", "\u03B5\u03C5", "\u03BF\u03C5", "\u03B7\u03C5", "\u03C9\u03C5"]);
var SHORT_FINAL_DIPH = /* @__PURE__ */ new Set(["\u03B1\u03B9", "\u03BF\u03B9"]);
function syllabify(word) {
  const s = word.normalize("NFD").toLowerCase();
  const nuclei = [];
  let i = 0;
  while (i < s.length) {
    if (BASIC_VOWELS.includes(s[i])) {
      let j = i + 1;
      while (j < s.length && COMBINING.test(s[j])) j++;
      nuclei.push({ i, j, text: s.slice(i, j) });
      i = j;
    } else {
      i++;
    }
  }
  const syls = [];
  let k = 0;
  while (k < nuclei.length) {
    const a = nuclei[k];
    const b = k + 1 < nuclei.length ? nuclei[k + 1] : null;
    const joined = b !== null && a.j === b.i && DIPHTHONGS.has(a.text[0] + b.text[0]) && !a.text.includes(ACUTE) && !a.text.includes(GRAVE) && !a.text.includes(PERISP);
    if (joined && b) {
      syls.push({ text: a.text + b.text, accent: "none", morae: 1, hiddenLong: false });
      k += 2;
    } else {
      syls.push({ text: a.text, accent: "none", morae: 1, hiddenLong: false });
      k += 1;
    }
  }
  syls.forEach((sy, idx) => {
    const t = sy.text;
    sy.accent = t.includes(PERISP) ? "circumflex" : t.includes(ACUTE) ? "acute" : t.includes(GRAVE) ? "grave" : "none";
    const bare = [...t].filter((c) => BASIC_VOWELS.includes(c)).join("");
    const isDiph = bare.length === 2 && DIPHTHONGS.has(bare);
    const isLast = idx === syls.length - 1;
    if (isDiph) {
      sy.morae = isLast && SHORT_FINAL_DIPH.has(bare) ? 1 : 2;
    } else {
      const ch = t[0];
      sy.morae = ch === "\u03B7" || ch === "\u03C9" ? 2 : sy.accent === "circumflex" && "\u03B1\u03B9\u03C5".includes(ch) ? 2 : 1;
    }
    sy.hiddenLong = sy.morae === 2 && !isDiph && "\u03B1\u03B9\u03C5".includes(t[0]);
  });
  return syls;
}
function accentSummary(word) {
  const syllables = syllabify(word);
  for (let idx = 0; idx < syllables.length; idx++) {
    const sy = syllables[idx];
    if (sy.accent !== "none") {
      return {
        type: sy.accent,
        fromEnd: syllables.length - 1 - idx,
        total: syllables.length,
        accentedMorae: sy.morae,
        hiddenLong: sy.hiddenLong,
        syllables
      };
    }
  }
  return {
    type: "none",
    fromEnd: -1,
    total: syllables.length,
    accentedMorae: 1,
    hiddenLong: false,
    syllables
  };
}
var ACUTE_A = 0.45;
var CIRC_A = 0.45;
var FALL = 0.14;
var SMOOTH_WIN = 0.022;
function isDiphthongIpa(ipa) {
  return ipa.includes("\u026A") || ipa.includes("\u028A");
}
function targetContour(baseF0, t0, t1, accent, morae, isDiph, amp = 1) {
  const T = Math.max(t1 - t0, 0.02);
  const n = 12;
  const pts = [];
  const long = morae >= 2 || isDiph;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let v;
    if (accent === "none") v = 0.96 - 0.04 * u;
    else if (accent === "grave") v = 1.05 - 0.05 * u;
    else if (accent === "acute") {
      const A = ACUTE_A * amp;
      v = long ? u > 0.5 ? 1 + A * (0.3 + 0.7 * u) : 1 + A * 0.6 * u : 1 + A * Math.pow(u, 1.5);
    } else if (accent === "circumflex") {
      const A = CIRC_A * amp;
      v = 1 + A * Math.exp(-Math.pow((u - 0.45) / 0.34, 2)) - FALL * Math.max(0, (u - 0.45) / 0.55);
    } else {
      v = 1 + 0.12 * amp * Math.sin(Math.PI * u);
    }
    pts.push([t0 + T * u, baseF0 * v]);
  }
  return pts;
}
function smoothContour(pts, win = SMOOTH_WIN) {
  if (pts.length < 5) return pts;
  const a = [...pts].sort((x, y) => x[0] - y[0]);
  const half = win / 2;
  const out = [];
  for (let i = 0; i < a.length; i++) {
    let sw = 0, sv = 0;
    for (let j = 0; j < a.length; j++) {
      if (Math.abs(a[j][0] - a[i][0]) > half) continue;
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (a[j][0] - a[i][0] + half) / (2 * half));
      sw += w;
      sv += a[j][1] * w;
    }
    out.push([a[i][0], sw > 0 ? sv / sw : a[i][1]]);
  }
  return out;
}
function interp(pts, t) {
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return last[1];
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (pts[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
  const d = t1 - t0;
  return d <= 0 ? v1 : v0 + (v1 - v0) * (t - t0) / d;
}
var VOWEL_RE = /[aeiouyɛɔɑ]/;
function parseEvents(events, text, totalSec) {
  const words = [];
  for (const e of events) {
    if (e.type !== "word") continue;
    const pos = e.text_position - 1;
    words.push({
      t0: e.audio_position / 1e3,
      t1: totalSec,
      text: text.slice(pos, pos + e.word_length)
    });
  }
  for (let i = 0; i + 1 < words.length; i++) words[i].t1 = words[i + 1].t0;
  const ph = events.filter((e) => e.type === "phoneme" && e.id !== "" && e.id !== void 0);
  const phones = ph.map((e, i) => ({
    t0: e.audio_position / 1e3,
    t1: i + 1 < ph.length ? ph[i + 1].audio_position / 1e3 : totalSec,
    ipa: String(e.id)
  }));
  if (words.length && phones.length) words[words.length - 1].t1 = phones[phones.length - 1].t1;
  return { words, phones };
}
var MORA_GAIN = 1.55;
function planAccent(events, text, totalSec, baseF0, amp = 1) {
  const { words, phones } = parseEvents(events, text, totalSec);
  const decl = (t) => {
    const u = Math.min(Math.max(totalSec > 0 ? t / totalSec : 0, 0), 1);
    return baseF0 * (1.06 - 0.16 * u);
  };
  const points = [[0, decl(0)]];
  const roles = [];
  const stretch = [];
  for (const p of phones) {
    const bare = p.ipa.replace(/^[ˈˌ]/, "");
    if (!VOWEL_RE.test(bare)) continue;
    const wi = words.findIndex((w2) => p.t0 + 1e-6 >= w2.t0 && p.t0 < w2.t1 + 1e-6);
    const w = wi >= 0 ? words[wi] : null;
    const info = w ? accentSummary(w.text) : null;
    const isLong = bare.includes("\u02D0") || isDiphthongIpa(bare);
    let accent;
    let morae = isLong ? 2 : 1;
    if (p.ipa.startsWith("\u02C8") && info && info.type !== "none") {
      accent = info.type;
      morae = Math.max(morae, info.accentedMorae);
    } else if (p.ipa.startsWith("\u02C8")) {
      accent = "none";
    } else if (p.ipa.startsWith("\u02CC")) {
      accent = "secondary";
    } else {
      accent = "none";
    }
    points.push(...targetContour(decl(p.t0), p.t0, p.t1, accent, morae, isDiphthongIpa(bare), amp));
    roles.push({ ipa: p.ipa, t0: p.t0, t1: p.t1, accent, morae });
    if (info?.hiddenLong && !bare.includes("\u02D0") && !isDiphthongIpa(bare)) {
      stretch.push([p.t0, p.t1]);
    }
  }
  points.push([totalSec, decl(totalSec)]);
  points.sort((a, b) => a[0] - b[0]);
  const anchors = [[0, 0]];
  let shift = 0;
  for (const [a, b] of stretch.sort((x, y) => x[0] - y[0])) {
    anchors.push([a, a + shift], [b, a + shift + (b - a) * MORA_GAIN]);
    shift += (b - a) * (MORA_GAIN - 1);
  }
  anchors.push([totalSec, totalSec + shift]);
  const ded = [];
  for (const [a, b] of anchors) {
    if (!ded.length || a > ded[ded.length - 1][0] + 1e-9 && b > ded[ded.length - 1][1] + 1e-9) ded.push([a, b]);
    else ded[ded.length - 1] = [a, b];
  }
  return { points: smoothContour(points), durAnchors: ded, roles };
}
var ROUGH = "\u0266";
function restoreAncientPhonetics(text) {
  return text.replace(/φ/g, "\u03C0" + ROUGH).replace(/Φ/g, "\u03A0" + ROUGH).replace(/θ/g, "\u03C4" + ROUGH).replace(/Θ/g, "\u03A4" + ROUGH).replace(/χ/g, "\u03BA" + ROUGH).replace(/Χ/g, "\u039A" + ROUGH).replace(/ζ/g, "\u03B6\u03B4").replace(/Ζ/g, "\u0396\u0394");
}
function splitSentences(text) {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return [];
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "." && c !== ";" && c !== "\xB7" && c !== "!") continue;
    let j = i + 1;
    while (j < s.length && /["'”’）)\]·]/.test(s[j])) {
      if (s[j] === "\xB7" && j + 1 < s.length && /\S/.test(s[j + 1])) break;
      j++;
    }
    const piece = s.slice(start, j).trim();
    if (piece) out.push(piece);
    while (j < s.length && /\s/.test(s[j])) j++;
    start = j;
    i = j - 1;
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  const merged = [];
  for (const p of out) {
    if (merged.length && p.replace(/[^\p{L}]/gu, "").length < 3) merged[merged.length - 1] += " " + p;
    else merged.push(p);
  }
  return merged;
}

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
    const w = new Float64Array(L);
    for (let i = 0; i < L; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1));
    return w;
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
      const w = hann(L);
      const p = Math.round(u * sr) - (L >> 1) + pad;
      const p0 = Math.max(p, 0), p1 = Math.min(p + L, out.length);
      for (let i = p0; i < p1; i++) {
        const k = i - p;
        out[i] += seg[k] * w[k];
        wsum[i] += w[k];
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
export {
  ACUTE_A,
  CIRC_A,
  MORA_GAIN,
  accentSummary,
  interp,
  isDiphthongIpa,
  parseEvents,
  pitchMarks,
  pitchTrack,
  planAccent,
  restoreAncientPhonetics,
  smoothContour,
  splitSentences,
  syllabify,
  targetContour,
  tdPsola
};
