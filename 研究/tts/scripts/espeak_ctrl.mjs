/**
 * eSpeak-NG（grc）可控性控制库 —— 研究/tts 原型的基础设施
 *
 * 提供的能力（均已实测）：
 *   1. phonemes(text)  → 音素序列（IPA），来自 convert_to_phonemes(text, true)
 *   2. synth(text,opt) → PCM + 每个音素的起始时刻（ms）+ 事件列表
 *   3. 全局 set_rate / set_pitch / set_range / set_voice
 *
 * 关键发现：eSpeakNGWorker.synthesize() 的回调第二个参数是**事件数组**，
 * 其中 type==='phoneme' 的事件带有 audio_position（毫秒），
 * 因此可以还原「音素 → 起止时间」的完整对齐。这是所有后处理方案的入口。
 *
 * 用法：
 *   import { load, synth, phonemes } from './espeak_ctrl.mjs'
 *   const es = await load()
 *   const r = synth(es, 'ἄνθρωπος')
 *   // r.pcm: Int16Array, r.sr, r.events, r.phonemes(带时间)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')

export async function load({ ipaFile, dataFile } = {}) {
  const jsPath = ipaFile || `${ROOT}/app/public/espeak/espeak-ng.js`
  const Mod = (await import(jsPath)).default
  const M = await (typeof Mod === 'function' ? Mod() : Mod)
  const w = new M.eSpeakNGWorker()
  // eSpeak 的 grc 语音把「重音」实现为音强/音高，重音的落点由希腊语规则决定
  w.set_voice('grc')
  return {
    M, worker: w,
    sr: w.get_samplerate(),
    set_rate: (n) => w.set_rate(n),
    set_pitch: (n) => w.set_pitch(n),
    set_range: (n) => w.set_range(n),
    set_voice: (n) => w.set_voice(n),
    /** 音素序列（IPA，'_' 分隔） */
    phonemes: (text) => w.convert_to_phonemes(text, true)?.ptr != null
      ? readCStr(M, w.convert_to_phonemes(text, true).ptr) : '',
    /** 音素序列（eSpeak 内部记法） */
    phonemesRaw: (text) => {
      const p = w.convert_to_phonemes(text, false)
      return p && p.ptr ? readCStr(M, p.ptr) : ''
    },
  }
}

function readCStr(M, ptr) {
  const h = M.HEAPU8
  const bytes = []
  let i = ptr
  while (h[i] !== 0 && bytes.length < 200000) { bytes.push(h[i]); i++ }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * 合成一段文本。
 * @returns {{pcm:Int16Array, sr:number, dur:number, events:Array, phonemes:Array}}
 *   phonemes: [{ ipa, t0, t1 }]   t0/t1 单位毫秒
 */
export function synth(es, text, { withTrace = true } = {}) {
  const chunks = []
  let events = []
  const cb = (data, ev) => { chunks.push(data); if (ev) events.push(...ev); return false }
  let trace = ''
  if (withTrace) trace = es.worker.synthesize_and_get_phonemes(text, cb)
  else es.worker.synthesize(text, cb)

  let len = 0
  for (const c of chunks) len += c.length
  const pcm = new Int16Array(len)
  let off = 0
  for (const c of chunks) { pcm.set(c, off); off += c.length }

  const durMs = (len / es.sr) * 1000
  // 事件里的 id 不足以标示长音（ɔː 会写成 ɔ），所以标签取自 trace（IPA），
  // 时间轴取自事件。二者按顺序一一对应（实测对齐无偏移）。
  // trace 用 '_' 分隔音素；词边界处会多出一个空格，且空格粘在该词首音素上。
  const labels = (trace || '').replace(/\n/g, '').split('_')
    .map((s) => s.trim()).filter((s) => s.length > 0)
  const timed = events.filter((e) => e.type === 'phoneme')
  const phonemes = []
  // ⚠️ 事件数组里混有 id 为空串的伪事件（音节分隔标记），必须**按 id 是否为空**
  // 来推进标签指针；按下标硬对齐在多词输入下会累积偏移（实测会多出音素）。
  let k = 0
  for (let i = 0; i < timed.length; i++) {
    const e = timed[i]
    if (!e.id) continue
    const next = timed[i + 1]
    const label = labels[k++] ?? e.id
    phonemes.push({
      ipa: label,
      id: e.id,
      t0: e.audio_position,
      t1: next ? next.audio_position : durMs,
    })
  }
  // 词边界：type==='word' 事件给出 text_position（1 基）与 audio_position
  const wev = events.filter((e) => e.type === 'word')
  const words = wev.map((e, wi) => ({
    i: wi, text_position: e.text_position, length: e.word_length,
    t0: e.audio_position,
    t1: wi + 1 < wev.length ? wev[wi + 1].audio_position : durMs,
  }))
  return { pcm, sr: es.sr, dur: len / es.sr, durMs, events, phonemes, words, trace: trace.trim() }
}

/** 16bit 单声道 WAV */
export function wav(pcm, sr) {
  const buf = Buffer.alloc(44 + pcm.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2)
  return buf
}

export const ROOTDIR = ROOT
export function readJSON(p) { return JSON.parse(readFileSync(p, 'utf8')) }
