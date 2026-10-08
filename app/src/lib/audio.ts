/** 发音播放：优先卡片自带音频；缺失时用 eSpeak 实时合成，再兜底系统语音 */
import { audioUrl } from './data'
import { speakText } from './tts'

let current: HTMLAudioElement | null = null

export function playAudio(file?: string, fallbackText?: string): void {
  if (file) {
    if (current) { current.pause(); current = null }
    const url = audioUrl(file)
    if (url) {
      const a = new Audio(url)
      a.volume = 1
      current = a
      void a.play().catch(() => speak(fallbackText))
      return
    }
  }
  speak(fallbackText)
}

let voices: SpeechSynthesisVoice[] = []
function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return
  voices = speechSynthesis.getVoices()
}
if (typeof speechSynthesis !== 'undefined') {
  loadVoices()
  speechSynthesis.onvoiceschanged = loadVoices
}

/**
 * 朗读任意古希腊语文本。
 * 优先用内置的 eSpeak（音质与词条音频一致），引擎不可用时退回系统语音。
 */
export function playText(text?: string): void {
  if (!text) return
  void speakText(text).then((ok) => { if (!ok) speak(text) })
}

/** 兜底 TTS：浏览器对古希腊语的发音支持有限，仅作提示 */
export function speak(text?: string): void {
  if (!text || typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(text)
  const greek = voices.find((v) => /el|greek/i.test(v.lang))
  if (greek) u.voice = greek
  u.lang = greek?.lang ?? 'el-GR'
  u.rate = 0.85
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

export function hasAudio(file?: string): boolean {
  return Boolean(file)
}
