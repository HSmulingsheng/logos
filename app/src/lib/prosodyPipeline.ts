/**
 * 韵律改造管线：PCM → 音高重音 + 长音补偿 → PCM。
 *
 * ## 为什么要单独成一个模块
 *
 * 这段逻辑原来有**两份拷贝**：一份在应用里（`lib/tts.ts`，实时合成用），
 * 一份在离线生成单词音频的脚本里（`tools/gen_word_audio_prosody.ts`）。
 * 两份靠注释「请保持同步」维系，但已经漂移了：
 *
 * | | 应用的拷贝 | 离线脚本的拷贝 |
 * |---|---|---|
 * | 采样率 | 参数 `sr` | 写死常量 `SR` |
 * | 重音幅度 | 参数 `amp` | 写死 `1` |
 * | 失败时 | `console.warn` | 完全静默 |
 *
 * 这正是重复实现最典型的结局。而且这条管线**改一次就要重跑 15,710 个音频**，
 * 两边不一致等于「你听到的效果和你批量生成的效果不是一回事」。
 *
 * 所以抽到这里，两边都 import 这一份。
 *
 * ## 管线做了什么
 *
 * 1. `pitchTrack` 估基频轨迹，取有声部分的中位数作基准基频
 *    （eSpeak 的 `pitch=50` 大致落在 86~110Hz）
 * 2. `planAccent` 从 eSpeak 的**音素事件**与**词边界**推出每个音节的音高目标，
 *    以及哪些音节需要延长（eSpeak 对 ᾱ/ῑ/ῡ 带 circumflex 时完全不延长）
 * 3. `pitchMarks` 找基音标记（**复用步骤 1 的轨迹**，避免重复估计；
 *    在 28 秒的段落上重复估计要多花约 800ms）
 * 4. `tdPsola` 按目标曲线重写波形
 *
 * ## 失败一定要原样返回
 *
 * 每一步都可能因为数据不理想而失败（没有浊音、标记太少、规划点太少）。
 * 任何一步失败都返回**原始 PCM**——绝不因为「想让它更好听」而让词没有声音。
 */
import type { Word } from '../types'
import type { EspeakEvent } from './prosody'
import { pitchMarks, pitchTrack, tdPsola } from './psola'
import { planAccent } from './prosody'

/** 基音标记的搜索范围。低于 70Hz 会把噪声当浊音，高于 400Hz 是儿童/假声区间 */
export const F0_FLOOR = 70
export const F0_CEILING = 400

/** 16 位整型 ↔ 浮点的换算。超出范围的样本要夹住，否则会爆音 */
const I16 = 32768

export interface ProsodyOptions {
  /** 重音幅度：0 等于不加强，1 是默认，>1 更夸张。用户可在设置里调 */
  amp?: number
  /** 这些词形不参与重音规划（一般不需要） */
  skip?: Set<string>
}

/**
 * 对一段 PCM 施加音高重音与长音补偿。
 *
 * @param pcm    eSpeak 合成的 16 位单声道 PCM
 * @param sr     采样率（eSpeak 通常是 22050）
 * @param events eSpeak 回调里给的事件数组（含 phoneme 与 word 两类）
 * @param text   这段 PCM 对应的原文（用于把事件位置映射回音节）
 * @param opts   见 {@link ProsodyOptions}
 * @returns      改造后的 PCM；任何一步失败都原样返回入参
 */
export function applyProsody(
  pcm: Int16Array, sr: number, events: EspeakEvent[], text: string, opts: ProsodyOptions = {},
): Int16Array {
  const amp = opts.amp ?? 1
  try {
    if (!events.length || pcm.length < sr * 0.05) return pcm

    const x = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) x[i] = pcm[i] / I16
    const dur = pcm.length / sr

    // 基准基频：取有声帧的中位数。用均值会被句末的降调拖低
    const track = pitchTrack(x, sr, F0_FLOOR, F0_CEILING)
    const voiced = track.f0.filter((v) => v > 0).sort((a, b) => a - b)
    if (!voiced.length) return pcm
    const base = voiced[voiced.length >> 1]

    const plan = planAccent(events, text, dur, base, amp)
    if (plan.points.length < 3) return pcm

    // 复用上面已经算好的轨迹：pitchMarks 内部本来会再估一次
    const { marks } = pitchMarks(x, sr, F0_FLOOR, F0_CEILING, track)
    if (marks.length < 3) return pcm

    const y = tdPsola(x, sr, plan.points, { marks, durAnchors: plan.durAnchors })
    const out = new Int16Array(y.length)
    for (let i = 0; i < y.length; i++) {
      const v = Math.round(y[i] * I16)
      out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
    }
    return out
  } catch (e) {
    // 静默降级会让「偶尔没重音」难以排查，这里一律打出来
    console.warn('[prosody] 韵律改造失败，回退原始音频', e)
    return pcm
  }
}

/** 词条级封装：给离线批量生成用。实时合成路径直接用上面的 applyProsody */
export function applyProsodyToWord(pcm: Int16Array, sr: number, events: EspeakEvent[], word: Word): Int16Array {
  return applyProsody(pcm, sr, events, word.w, { amp: 1 })
}
