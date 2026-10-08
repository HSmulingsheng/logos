/**
 * 浏览器内的古希腊语语音合成（eSpeak-NG WASM）。
 *
 * 为什么放在浏览器里而不是预生成音频：
 *   应用里的例句去重后有 1.8 万条、合计 81 小时，预生成要 380–760 MB，
 *   网页版扛不住。实时合成只需要一次 24 MB 的引擎加载，之后任意文本都能读。
 *
 * 授权：eSpeak-NG 是 GPL-3.0，随应用分发会把整体置于 GPL-3.0（见项目根 LICENSE）。
 */
import { USE_TTS } from './flags'
import { synthNeural, neuralStatus, neuralProgress, onNeuralStatus, getNeuralRate, warmupNeural } from './neuralTts'

type Worker = {
  synthesize: (text: string, cb: (data: Int16Array) => boolean) => void
  set_voice: (v: string) => void
  set_rate: (r: number) => void
  set_pitch: (p: number) => void
  set_range: (r: number) => void
  get_samplerate: () => number
}

export type TtsStatus = 'idle' | 'loading' | 'ready' | 'failed'

let worker: Worker | null = null
/** 朗读语速：eSpeak 的 rate。120 太慢（有效语速仅 12.9 字符/秒），168 接近自然 */
let rate = 168
export function setSpeechRate(r: number) { rate = Math.max(80, Math.min(260, Math.round(r))) }
export function getSpeechRate() { return rate }

/**
 * 音色变体。eSpeak 的 grc 声音支持 +f1..+f3 / +m1..+m7 等变体，
 * 实测女声变体的停顿更少（静音占比 31–35% vs 默认 38%），听起来更连贯。
 * 音色好坏因人而异，所以做成可选项交给使用者。
 */
let voice = 'grc'
export const VOICE_OPTIONS = [
  { value: 'grc', label: '默认' },
  { value: 'grc+f2', label: '女声 1' },
  { value: 'grc+f3', label: '女声 2' },
  { value: 'grc+f1', label: '女声 3' },
  { value: 'grc+m3', label: '男声' },
  { value: 'grc+m7', label: '男声 2' },
]
export function setSpeechVoice(v: string) {
  voice = v || 'grc'
  if (worker) worker.set_voice(voice)
}
export function getSpeechVoice() { return voice }
let samplerate = 22050
let initPromise: Promise<boolean> | null = null
let status: TtsStatus = 'idle'
const listeners = new Set<(s: TtsStatus) => void>()

/** 已合成文本 → blob URL。例句会有大量重复引用，缓存能省掉重复合成。 */
const cache = new Map<string, string>()
const CACHE_MAX = 300

export function ttsStatus(): TtsStatus {
  return status
}

export function onTtsStatus(fn: (s: TtsStatus) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function setStatus(s: TtsStatus) {
  if (status === s) return
  status = s
  for (const fn of listeners) fn(s)
}

/** 按需加载引擎（首次调用会下载 24MB，之后走浏览器缓存） */
function ensure(): Promise<boolean> {
  if (initPromise) return initPromise
  if (!USE_TTS) { setStatus('failed'); return Promise.resolve(false) }

  setStatus('loading')
  initPromise = (async () => {
    try {
      // 关键：从 public 目录按原样加载，不走 Vite 打包。
      // 这样模块内部的 import.meta.url 指向 /espeak/espeak-ng.js，
      // emscripten 默认就能在同目录找到 espeak-ng.data。
      //
      // 注意 URL 必须基于「页面地址」而不是相对路径：BASE_URL 是 './'，
      // 但动态 import 的相对路径是相对 chunk（/assets/）解析的，
      // 会拼成 /assets/espeak/… 而 404。
      const base = new URL(import.meta.env.BASE_URL || './', document.baseURI)
      const espeakDir = new URL('espeak/', base).href
      const mod = await import(/* @vite-ignore */ `${espeakDir}espeak-ng.js`)
      const factory = (mod as unknown as { default: (arg?: unknown) => Promise<unknown> }).default
      const Module = await (factory as (arg?: unknown) => Promise<{
        eSpeakNGWorker: new () => Worker
      }>)({
        locateFile: (p: string) => `${espeakDir}${p}`,
      })
      worker = new Module.eSpeakNGWorker()
      samplerate = worker.get_samplerate()
      worker.set_rate(rate)
      worker.set_range(60)      // 语调起伏：避免长句念得太平
      worker.set_pitch(50)
      worker.set_voice(voice)
      setStatus('ready')
      return true
    } catch (e) {
      console.warn('[tts] eSpeak 初始化失败，回退到系统语音', e)
      setStatus('failed')
      return false
    }
  })()
  return initPromise
}

/**
 * 预生成整句（悬停或打开词条面板时调用）。
 *
 * 必须和 speakText 用**同一段文本**：之前悬停预生成整句、点击却按分段合成，
 * 两者无法复用，在同一条 WASM 单线程上白跑一遍（3.6 秒被拖成 6.1 秒）。
 * 现在合成与缓存都以「整句」为单位，预生成即可被点击直接命中。
 */
export function prepareSpeech(text: string): void {
  const t = normalizeForSpeech(text)
  if (!t) return
  if (engine === 'neural') { void synthNeural(t).catch(() => {}); return }
  void synthesize(t).catch(() => {})
}

/** 提前加载引擎（用户点开例句面板时调用，摊薄等待） */
export function warmupTts(): void {
  void ensure()
}

function pcmToWav(pcm: Int16Array, rate: number): Blob {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)          // PCM
  v.setUint16(22, 1, true)          // 单声道
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)   // 字节率
  v.setUint16(32, 2, true)          // 块对齐
  v.setUint16(34, 16, true)         // 位深
  writeStr(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  return new Blob([header, pcm.buffer as ArrayBuffer], { type: 'audio/wav' })
}

/**
 * 朗读前的文本归一化。
 *
 * 与 Python 侧 tools/textclean.py 保持同样的规则，但这里是**最后一道防线**：
 * 任何来源的文本（含以后新增的数据）在朗读前都会被清一遍。
 *
 * ⚠️ 不要用 [A-Za-z] 一刀切删：希腊大写字母 Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ 与拉丁同形，
 * 但码位不同（Greek 在 U+0370–U+03FF / U+1F00–U+1FFF）。这里只删除**已核实**的
 * 噪声（ASCII 的 E/G 标记、实体残名、校勘符号），希腊字母一律不动。
 */
export function normalizeForSpeech(input: string): string {
  let s = input
  // 校勘符号（⸀⸁⸂⸃）、剑标、省略号、修饰符
  s = s.replace(/[\u2E00-\u2E0F\u2020\u2021\u2026\u02B9\u02BC]/g, ' ')
  // 编辑用括号
  s = s.replace(/[\[\]{}<>]/g, ' ')
  // HTML 实体残名
  s = s.replace(/\b(?:quot|amp|lt|gt|nbsp|apos|mdash|ndash|hellip)\b/g, ' ')
  // ASCII 的 E / G 编辑标记（希腊大写是 Unicode，不受影响）
  s = s.replace(/(?<![A-Za-z])[EG](?![A-Za-z])/g, ' ')
  // 标点归一化：希腊语问号「;」与分号点「·」，让停顿符合预期
  s = s.replace(/·/g, ',')
  s = s.replace(/;/g, '?')
  s = s.replace(/[\u2018\u2019]/g, "'")   // 弯引号 → 直引号
  s = s.replace(/[\u201C\u201D]/g, '"')
  return s.replace(/\s+/g, ' ').trim()
}

/** 合成一段古希腊语，返回可直接播放的 blob URL；失败返回 null */
export async function synthesize(text: string): Promise<string | null> {
  const t = normalizeForSpeech(text)
  if (!t) return null
  const key = `${voice}|${rate}|${t}`
  const hit = cache.get(key)
  if (hit) return hit

  if (!(await ensure()) || !worker) return null

  try {
    const parts: Int16Array[] = []
    // 注意：回调必须返回 false，返回 true 会让 eSpeak 只吐 100ms 就中止
    worker.synthesize(t, (data) => {
      if (data && data.length) parts.push(data)
      return false
    })
    if (!parts.length) return null

    let total = 0
    for (const p of parts) total += p.length
    const merged = new Int16Array(total)
    let off = 0
    for (const p of parts) { merged.set(p, off); off += p.length }

    const url = URL.createObjectURL(pcmToWav(merged, samplerate))
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first !== undefined) {
        const old = cache.get(first)
        if (old) URL.revokeObjectURL(old)
        cache.delete(first)
      }
    }
    cache.set(key, url)
    return url
  } catch (e) {
    console.warn('[tts] 合成失败', e)
    return null
  }
}

/**
 * 例句朗读引擎。
 *   'espeak' —— 内置 eSpeak（24MB，瞬时，音色机械）
 *   'neural' —— MMS-TTS 神经语音（需一次性下载 128MB，音质接近真人，首句约 2.5s）
 * 无论选哪个，失败都会自动回退，用户不会「点不动」。
 */
let engine: 'espeak' | 'neural' = 'espeak'
export function setSpeechEngine(e: string) { engine = e === 'neural' ? 'neural' : 'espeak' }
export function getSpeechEngine() { return engine }

// 神经引擎的状态透出去给界面用（按钮上的下载进度、设置里的状态标签）
export { neuralStatus, neuralProgress, onNeuralStatus, warmupNeural } from './neuralTts'

let current: HTMLAudioElement | null = null

/**
 * 朗读一句话。成功返回 true；引擎不可用时返回 false，调用方可以回退到系统语音。
 */
export async function speakText(text: string): Promise<boolean> {
  const t = normalizeForSpeech(text)
  if (!t) return false

  // 神经语音：整句合成（内部按标点分段后拼接成一个音频，无缝）
  let url: string | null = null
  if (engine === 'neural') url = await synthNeural(t)
  if (!url) url = await synthesize(t)   // eSpeak（或神经不可用时的回退）
  if (!url) return false

  if (current) { current.pause(); current = null }
  const a = new Audio(url)
  if (engine === 'neural') {
    // 语速用播放速率实现：preservesPitch 让浏览器做**保音高**变速，
    // 调慢不会变成低音、调快不会变尖。模型本身调不了语速，
    // 所以这是唯一可行的做法。
    a.preservesPitch = true
    ;(a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
    a.playbackRate = getNeuralRate()
  }
  current = a
  try {
    await a.play()
    return true
  } catch {
    return false
  }
}

export function stopSpeaking(): void {
  if (current) { current.pause(); current = null }
}
