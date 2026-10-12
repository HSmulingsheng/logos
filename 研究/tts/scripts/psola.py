"""
TD-PSOLA（时域基音同步叠加）——自研实现，numpy 版。

为什么自己写而不是用 Praat 的 Manipulation：
  1. parselmouth 不暴露 Replacement 命令（实测：Objects 窗口里对 Manipulation
     调用 "Replace Pitch Tier" 报 "not available for current selection"），
     "Get end time" 之类查询命令同样不可用；
  2. 更重要的：**同样的算法能直接翻译成 JavaScript**，在浏览器里跑。
     现有 PWA 的全部 TTS 都在浏览器内完成，引入 Python 依赖不可行；
     TD-PSOLA 只有几十行、无依赖，是唯一能落地到现有架构的路线。
只用到 Praat 的 F0 估计与基音标记（To PointProcess），这两条命令实测可用。

原理：PSOLA 在**基音周期**的尺度上剪切/复制波形并叠加，因此只改变基频与时长，
      每个基音周期内部的波形（= 共振峰结构 = 元音音值）原样保留。
"""
import numpy as np
import parselmouth
from parselmouth.praat import call


def pitch_marks(snd, floor=70, ceiling=400):
    """基音标记（glottal pulses）时间戳，秒。只落在有声区。"""
    pp = call(snd, 'To PointProcess (periodic, cc)', floor, ceiling)
    n = call(pp, 'Get number of points')
    return np.array([call(pp, 'Get time from index', i + 1) for i in range(n)])


def f0_track(snd, floor=70, ceiling=400, step=0.005):
    p = snd.to_pitch(time_step=step, pitch_floor=floor, pitch_ceiling=ceiling)
    return p.xs(), p.selected_array['frequency'].copy()


def interp_curve(pts, t):
    """pts: [(time, value)] 已排序；t 可为数组。端点外取最近值。"""
    ts = np.array([p[0] for p in pts], dtype=float)
    vs = np.array([p[1] for p in pts], dtype=float)
    return np.interp(t, ts, vs)


def piecewise_linear_map(anchors):
    """anchors: [(t_in, t_out)] 单调递增 → 返回 t_in→t_out 与逆映射。
    用于时长改动（只改动局部区段）。"""
    a = np.array(sorted(anchors), dtype=float)
    xs, ys = a[:, 0], a[:, 1]
    if xs[0] > 0:
        xs = np.concatenate([[0.0], xs]); ys = np.concatenate([[0.0], ys])
    if ys[-1] <= ys[-2]:
        ys = ys.copy()
    def fwd(t):
        return np.interp(t, xs, ys)
    def inv(u):
        # 保证 u 单调 ⇒ np.interp 需要 xs 递增；ys 已递增
        return np.interp(u, ys, xs)
    return fwd, inv


def td_psola(x, sr, f0_pts, dur_anchors=None, marks=None, floor=70, ceiling=400,
             fade_out_len=0):
    """核心 TD-PSOLA。

    x          : float32 单声道波形
    sr         : 采样率
    f0_pts     : [(t_分析时间秒, 目标F0 Hz)] 目标基频曲线（绝对 Hz）
    dur_anchors: [(t_in, t_out)] 时长映射锚点；None = 不改时长
    marks      : 基音标记；None 则自行估计
    """
    N = len(x)
    T_a = N / sr

    if dur_anchors is None or len(dur_anchors) < 2:
        fwd = lambda t: np.asarray(t, dtype=float) * 1.0
        inv = lambda u: np.asarray(u, dtype=float) * 1.0
        T_s = T_a
    else:
        fwd, inv = piecewise_linear_map(list(dur_anchors) + [(T_a, dur_anchors[-1][1] + (T_a - dur_anchors[-1][0]))])
        T_s = float(fwd(T_a))

    N_s = int(round(T_s * sr))
    pad = int(sr * 0.02)
    out = np.zeros(N_s + 2 * pad, dtype=np.float64)
    wsum = np.zeros_like(out)

    if marks is None:
        snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
        marks = pitch_marks(snd, floor, ceiling)
    marks = np.asarray(marks)
    if len(marks) < 3:
        return x.copy()

    # 时长映射的局部斜率（数值微分），用于把「分析周期」换算成「输出周期」
    def slope_at(t):
        if dur_anchors is None:
            return 1.0
        e = 1e-4
        return float((fwd(t + e) - fwd(t - e)) / (2 * e))

    # ⚠️ 两条必须遵守的规则，否则恒等重建会退化（实测相关系数从 1.000 掉到 0.1）：
    #   (1) 输出位置必须**按分析周期逐步累加**，而不是按平滑后的 F0 曲线重新铺点。
    #       用「前向差分周期」marks[j+1]-marks[j] 作增量，恒等时 u_j 与 marks[j] 严格重合。
    #   (2) PSOLA 只能在**有声段**内做。若在整个信号（含静音）上铺合成标记，
    #       找最近分析帧时会把有声帧复制到静音里。所以先按标记间隔切出有声段。
    gaps = np.diff(marks)
    med = np.median(gaps) if len(gaps) else 0.01
    brk = np.where(gaps > 2.5 * med)[0]
    segs, st = [], 0
    for b in brk:
        segs.append((st, b)); st = b + 1
    segs.append((st, len(marks) - 1))

    for (i0, i1) in segs:
        if i1 - i0 < 2:
            continue
        u = float(fwd(marks[i0]))
        for j in range(i0, i1):
            Pa = marks[j + 1] - marks[j]         # 分析周期（前向差分，与累加一致）
            if not (Pa > 0):
                continue
            f_anal = 1.0 / Pa
            # 目标 F0 取自分析时刻（曲线的坐标系是原信号时间轴）
            f_tar = float(interp_curve(f0_pts, marks[j]))
            f_tar = min(max(f_tar, floor), ceiling)
            L = max(int(round(2 * Pa * sr)), 8)
            c = int(round(marks[j] * sr))
            a0 = c - L // 2
            seg = np.zeros(L)
            s0, s1 = max(a0, 0), min(a0 + L, N)
            if s1 > s0:
                seg[s0 - a0:s1 - a0] = x[s0:s1]
            w = np.hanning(L)          # Hann 在 50% 叠加下严格和为 1
            p = int(round(u * sr)) - L // 2 + pad
            p0, p1 = max(p, 0), min(p + L, len(out))
            if p1 > p0:
                out[p0:p1] += seg[p0 - p:p1 - p] * w[p0 - p:p1 - p]
                wsum[p0:p1] += w[p0 - p:p1 - p]
            # 输出周期 = 分析周期 × (分析F0 / 目标F0) × 时长局部斜率
            u += Pa * (f_anal / f_tar) * slope_at(marks[j])

    # 无声/清音区：用时间轴重采样直接填（清音无基频，重采样不改变音值感知）
    grid = np.arange(N_s) / sr
    ta_grid = np.asarray(inv(grid))
    src = np.interp(ta_grid * sr, np.arange(N), x)
    core = slice(pad, pad + N_s)
    good = wsum[core] > 0.35
    y = np.where(good, out[core] / np.maximum(wsum[core], 1e-9), src)
    if fade_out_len:
        k = min(fade_out_len, N_s)
        y[-k:] *= np.linspace(1, 0, k) ** 2
    return y.astype(np.float32)


if __name__ == '__main__':
    # ── 自检：三条验证，确认实现正确
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    snd = parselmouth.Sound(os.path.join(HERE, 'out/demo/min13_anthropos_base.wav'))
    x = snd.values[0].astype(np.float64)
    sr = int(snd.sampling_frequency)
    xt, ft = f0_track(snd)
    v = ft[ft > 0]
    g = float(np.median(v))
    print(f'输入: {len(x)/sr:.3f}s  F0 中位 {g:.1f} Hz')

    # 1) 恒等：不改 F0 不改时长 → 应与原信号高度一致
    pts0 = [(0.0, float(ft[ft > 0][0])), (len(x) / sr, g)]
    y0 = td_psola(x, sr, [(t, gg if gg > 0 else g) for t, gg in zip(xt, ft)])
    n = min(len(x), len(y0))
    c = np.corrcoef(x[:n], y0[:n])[0, 1]
    print(f'  [1] 恒等 PSOLA: 长度 {len(y0)/sr:.3f}s  与原信号相关系数 {c:.4f}')

    # 2) 全段升调 ×1.5
    y1 = td_psola(x, sr, [(t, (gg if gg > 0 else g) * 1.5) for t, gg in zip(xt, ft)])
    s1 = parselmouth.Sound(y1.astype(np.float64), sampling_frequency=sr)
    _, f1 = f0_track(s1)
    print(f'  [2] ×1.5 升调: F0 中位 {np.median(f1[f1>0]):.1f} Hz  '
          f'(期望 {g*1.5:.1f})  比值 {np.median(f1[f1>0])/g:.3f}')

    # 3) 时长 ×1.4
    y2 = td_psola(x, sr, [(t, gg if gg > 0 else g) for t, gg in zip(xt, ft)],
                  dur_anchors=[(0.0, 0.0), (len(x) / sr, len(x) / sr * 1.4)])
    print(f'  [3] 时长 ×1.4: {len(x)/sr:.3f}s → {len(y2)/sr:.3f}s  '
          f'比值 {len(y2)/len(x):.3f}')
