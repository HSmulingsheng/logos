/**
 * TD-PSOLA（时域基音同步叠加）——浏览器端实现，零依赖。
 *
 * 原理
 * ----
 * PSOLA 在**基音周期**的尺度上剪切并叠加波形，所以每个周期内部的波形
 * （= 共振峰结构 = 元音音值）原样保留。它只改「基频」与「时长」这两个感知量，
 * **不动音素音值**——这正是它能安全地给 eSpeak 补音高重音的原因。
 *
 * 为什么自己写而不用现成库
 * ------------------------
 * 现有 PWA 的全部语音都在浏览器内完成，引入 Python/Praat 不可行；
 * 而 TD-PSOLA 本身只有几十行、无依赖。研究原型已用 numpy 版验证过算法
 * （研究/tts/scripts/psola.py），这里逐行移植。
 *
 * ⚠️ 两条必须遵守的规则，否则恒等重建会退化（实测相关系数从 1.000 掉到 0.1）
 * -------------------------------------------------------------------------
 * 1. **输出位置必须按「分析周期」逐步累加**，而不是按平滑后的 F0 曲线重新铺点。
 *    用前向差分周期 `marks[j+1]-marks[j]` 作增量，恒等时输出位置与分析标记严格重合。
 * 2. **PSOLA 只能在有声段内做**。若在整个信号（含静音）上铺合成标记，
 *    找最近分析帧时会把有声帧复制进静音里。
 *
 * 另一条经验：加窗必须用 **Hann**（50% 叠加下严格和为 1）；窗长取 2×分析周期。
 */

export interface PitchAnalysis {
  /** 基音标记（声门脉冲）时间戳，秒；只落在有声区 */
  marks: number[]
  /** 基频轨迹 */
  times: number[]
  f0: number[]
}

/**
 * 基频估计：归一化自相关。
 *
 * 对应 Praat 的 `To PointProcess (periodic, cc)` 那一步。自相关对周期信号
 * 在基音周期处出现峰值，归一化后可以按阈值判断有声/无声。
 */
export function pitchTrack(
  x: Float32Array, sr: number, floor = 70, ceiling = 400,
  hopSec = 0.01, winSec = 0.04,
): { times: number[]; f0: number[] } {
  const hop = Math.max(1, Math.round(hopSec * sr))
  const win = Math.max(8, Math.round(winSec * sr))
  const lagMin = Math.max(2, Math.floor(sr / ceiling))
  const lagMax = Math.min(win - 2, Math.ceil(sr / floor))
  const times: number[] = []
  const f0: number[] = []
  const half = win >> 1

  for (let c = 0; c + half < x.length; c += hop) {
    const a = Math.max(0, c - half)
    const b = Math.min(x.length, c + half)
    const n = b - a
    if (n < lagMax + 2) { times.push(c / sr); f0.push(0); continue }

    // 均方根能量太低就判为无声，省掉自相关
    let e = 0
    for (let i = a; i < b; i++) e += x[i] * x[i]
    if (Math.sqrt(e / n) < 1e-4) { times.push(c / sr); f0.push(0); continue }

    let bestLag = 0, bestR = 0
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let num = 0, d1 = 0, d2 = 0
      const m = n - lag
      for (let i = 0; i < m; i++) {
        const u = x[a + i], v = x[a + i + lag]
        num += u * v; d1 += u * u; d2 += v * v
      }
      const den = Math.sqrt(d1 * d2)
      const r = den > 1e-12 ? num / den : 0
      if (r > bestR) { bestR = r; bestLag = lag }
    }
    // 0.42 是「够周期」的门槛；太低会把清音当有声
    if (bestR >= 0.42 && bestLag > 0) {
      // 抛物线插值细化峰位，减少量化误差
      let lag = bestLag
      if (lag > lagMin && lag < lagMax) {
        const rAt = (l: number) => {
          let num = 0, d1 = 0, d2 = 0
          const m = n - l
          for (let i = 0; i < m; i++) { const u = x[a + i], v = x[a + i + l]; num += u * v; d1 += u * u; d2 += v * v }
          const den = Math.sqrt(d1 * d2)
          return den > 1e-12 ? num / den : 0
        }
        const r0 = rAt(lag - 1), r1 = bestR, r2 = rAt(lag + 1)
        const dd = r0 - 2 * r1 + r2
        if (Math.abs(dd) > 1e-12) lag = lag + 0.5 * (r0 - r2) / dd
      }
      times.push(c / sr)
      f0.push(sr / lag)
    } else {
      times.push(c / sr)
      f0.push(0)
    }
  }
  return { times, f0 }
}

/**
 * 由基频轨迹铺基音标记。
 *
 * 做法（与 Praat 的 `To PointProcess` 同思路）：在每段有声区里先找到**最强峰**，
 * 再以它为锚点向**两侧**按周期连续追踪，每一步只在 `[0.5T, 1.5T]` 的预测窗口里
 * 找波形极大值。
 *
 * ⚠️ 早期版本用「预测位置 ±0.4T 直接找极大值」，在多音节词上恒等重建只有 0.73
 * —— 因为每步都独立搜索，标记会跳到相邻的次强峰，相位不连贯。
 * 连续追踪能保证跨周期的相位一致性，这正是 PSOLA 不发抖的前提。
 */
export function pitchMarks(
  x: Float32Array, sr: number, floor = 70, ceiling = 400,
): PitchAnalysis {
  const { times, f0 } = pitchTrack(x, sr, floor, ceiling)

  // 切出连续有声段。段与段之间是清音/静音，PSOLA 不在那里铺点。
  const segs: [number, number][] = []
  let st = -1
  for (let i = 0; i < f0.length; i++) {
    const voiced = f0[i] > 0
    if (voiced && st < 0) st = i
    if (st >= 0 && (!voiced || i === f0.length - 1)) {
      segs.push([st, voiced ? i : i - 1]); st = -1
    }
  }

  /** 某时刻的基音周期（秒） */
  const periodAt = (t: number): number => {
    const f = sampleF0(times, f0, t)
    return f > 0 ? 1 / f : 1 / 120
  }

  const marks: number[] = []
  for (const [i0, i1] of segs) {
    if (i1 < i0) continue
    // ⚠️ 段的搜索范围**不能外扩**：早期版本把末端 +20ms，导致相邻段在重叠区
    //    各铺一遍点，密度翻倍（λόγος 实测 54 个点、间隔只有应有周期的一半），
    //    后面的去重又把它们成片砍掉。范围严格取本段的音频区间。
    const a = Math.max(0, Math.round(times[i0] * sr))
    const b = Math.min(x.length - 1, Math.round((times[i1] + 0.01) * sr))
    if (b - a < 8) continue

    // 锚点：本段内绝对振幅最大的位置（真正的声门脉冲一定在这里面）
    let anchor = -1, best = 0
    for (let i = a; i <= b; i++) {
      const v = x[i] > 0 ? x[i] : -x[i]
      if (v > best) { best = v; anchor = i }
    }
    if (anchor < 0 || best <= 1e-5) continue

    /** 把位置吸附到 ±25% 周期内的波形极值上；找不到就原样返回 */
    const snap = (i: number, T: number): number => {
      const r = Math.max(1, Math.round(0.25 * T * sr))
      let bi = i, bv = -Infinity
      for (let k = Math.max(a, i - r); k <= Math.min(b, i + r); k++) {
        if (x[k] > bv) { bv = x[k]; bi = k }
      }
      return bi
    }

    // 以锚点为中心，向两侧按周期累加铺点。
    // 每一步都从**上一个实际标记**出发累加，保证相位连续（这正是 PSOLA 不发抖的前提）。
    const local: number[] = [anchor / sr]
    let cur = anchor
    while (true) {
      const T = periodAt(cur / sr)
      const nxt = snap(Math.round(cur + T * sr), T)
      if (nxt <= a || nxt > b || nxt <= cur) break
      local.push(nxt / sr); cur = nxt
    }
    cur = anchor
    while (true) {
      const T = periodAt(cur / sr)
      const prv = snap(Math.round(cur - T * sr), T)
      if (prv < a || prv >= b || prv >= cur) break
      local.push(prv / sr); cur = prv
    }
    local.sort((p, q) => p - q)
    marks.push(...local)
  }

  // 兜底：几乎没找到标记时按固定周期铺，至少让后续流程能跑
  if (marks.length < 3) {
    const f = sampleF0(times, f0, 0) || 120
    for (let t = 0; t < x.length / sr; t += 1 / f) marks.push(t)
  }
  return { marks, times, f0 }
}

function sampleF0(times: number[], f0: number[], t: number): number {
  if (!times.length) return 0
  if (t <= times[0]) return f0[0]
  const last = times.length - 1
  if (t >= times[last]) return f0[last]
  let lo = 0, hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid; else hi = mid
  }
  const d = times[hi] - times[lo]
  if (d <= 0) return f0[hi]
  const u = (t - times[lo]) / d
  return f0[lo] * (1 - u) + f0[hi] * u
}

export interface PsolaOptions {
  /** 基音标记；不给则自行估计 */
  marks?: number[]
  /** 时长映射锚点 [t_in, t_out]；不给则不改时长 */
  durAnchors?: [number, number][]
  floor?: number
  ceiling?: number
}

/**
 * TD-PSOLA 主函数。
 *
 * @param x        输入波形（单声道，-1..1）
 * @param sr       采样率
 * @param f0Pts    目标基频曲线 [[时刻秒, 目标F0(Hz)], ...]，时刻用**原信号**时间轴
 */
export function tdPsola(
  x: Float32Array, sr: number, f0Pts: [number, number][], opts: PsolaOptions = {},
): Float32Array {
  const floor = opts.floor ?? 70
  const ceiling = opts.ceiling ?? 400
  const N = x.length
  const T_a = N / sr

  // ── 时长映射（只动指定区段，其余 1:1）
  let fwd: (t: number) => number = (t) => t
  let inv: (u: number) => number = (u) => u
  const anchors = opts.durAnchors
  if (anchors && anchors.length >= 2) {
    const a = [...anchors].sort((p, q) => p[0] - q[0])
    const xs = a.map((p) => p[0])
    const ys = a.map((p) => p[1])
    if (xs[0] > 0) { xs.unshift(0); ys.unshift(0) }
    const lin = (t: number, X: number[], Y: number[]) => {
      if (t <= X[0]) return Y[0]
      if (t >= X[X.length - 1]) return Y[Y.length - 1]
      let lo = 0, hi = X.length - 1
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= t) lo = m; else hi = m }
      const d = X[hi] - X[lo]
      return d <= 0 ? Y[hi] : Y[lo] + (Y[hi] - Y[lo]) * (t - X[lo]) / d
    }
    fwd = (t) => lin(t, xs, ys)
    inv = (u) => lin(u, ys, xs)
  }
  const T_s = fwd(T_a)
  const N_s = Math.max(1, Math.round(T_s * sr))
  const pad = Math.round(sr * 0.02)
  const out = new Float64Array(N_s + 2 * pad)
  const wsum = new Float64Array(N_s + 2 * pad)

  const marks = opts.marks ?? pitchMarks(x, sr, floor, ceiling).marks
  if (marks.length < 3) return x.slice()

  const slopeAt = (t: number): number => {
    if (!anchors || anchors.length < 2) return 1
    const e = 1e-4
    return (fwd(t + e) - fwd(t - e)) / (2 * e)
  }

  // 规则 (2)：只在有声段内做——按标记间隔切段，间隔突然变大处断开
  const gaps: number[] = []
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1])
  const sorted = [...gaps].sort((a, b) => a - b)
  const med = sorted.length ? sorted[sorted.length >> 1] : 0.01
  const segs: [number, number][] = []
  let st = 0
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > 2.5 * med) { segs.push([st, i]); st = i + 1 }
  }
  segs.push([st, marks.length - 1])

  const hann = (L: number) => {
    const w = new Float64Array(L)
    for (let i = 0; i < L; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1))
    return w
  }

  for (const [i0, i1] of segs) {
    if (i1 - i0 < 2) continue
    // 规则 (1)：u 按分析周期逐步累加，恒等时与 marks 严格重合
    let u = fwd(marks[i0])
    for (let j = i0; j < i1; j++) {
      const Pa = marks[j + 1] - marks[j]
      if (!(Pa > 0)) continue
      const fAnal = 1 / Pa
      // 目标 F0 取自**分析时刻**（曲线的坐标系是原信号时间轴）
      let fTar = interpPts(f0Pts, marks[j])
      fTar = Math.min(Math.max(fTar, floor), ceiling)
      const L = Math.max(Math.round(2 * Pa * sr), 8)
      const c = Math.round(marks[j] * sr)
      const a0 = c - (L >> 1)
      const seg = new Float64Array(L)
      const s0 = Math.max(a0, 0), s1 = Math.min(a0 + L, N)
      if (s1 > s0) for (let i = s0; i < s1; i++) seg[i - a0] = x[i]
      const w = hann(L)
      const p = Math.round(u * sr) - (L >> 1) + pad
      const p0 = Math.max(p, 0), p1 = Math.min(p + L, out.length)
      for (let i = p0; i < p1; i++) {
        const k = i - p
        out[i] += seg[k] * w[k]
        wsum[i] += w[k]
      }
      // 输出周期 = 分析周期 × (分析F0 / 目标F0) × 时长局部斜率
      u += Pa * (fAnal / fTar) * slopeAt(marks[j])
    }
  }

  // 清音/静音区：直接用时间轴重采样填（清音无基频，重采样不改变音值感知）
  const y = new Float32Array(N_s)
  for (let i = 0; i < N_s; i++) {
    const ta = inv(i / sr)
    const src = ta * sr
    const i0 = Math.floor(src)
    const frac = src - i0
    const a = i0 >= 0 && i0 < N ? x[i0] : 0
    const b = i0 + 1 >= 0 && i0 + 1 < N ? x[i0 + 1] : 0
    const core = pad + i
    y[i] = wsum[core] > 0.35 ? out[core] / Math.max(wsum[core], 1e-9) : a + (b - a) * frac
  }
  return y
}

function interpPts(pts: [number, number][], t: number): number {
  if (!pts.length) return 120
  if (t <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (t >= last[0]) return last[1]
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m }
  const d = pts[hi][0] - pts[lo][0]
  return d <= 0 ? pts[hi][1] : pts[lo][1] + (pts[hi][1] - pts[lo][1]) * (t - pts[lo][0]) / d
}
