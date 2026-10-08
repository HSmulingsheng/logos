/**
 * 浏览器内的神经语音合成（Meta MMS-TTS 的古希腊语模型，经 ONNX Runtime Web 推理）。
 *
 * 为什么要它：eSpeak 是共振峰合成器，音色机械、停顿占比 ~40%，
 * 例句朗读效果差。这个模型是 VITS 架构的神经 TTS，音质接近真人。
 *
 * 代价：
 *   * 模型 114 MB + ONNX Runtime WASM 14 MB，**一次性下载**（之后走缓存，可离线）
 *   * 首句推理约 2.5 秒（约 0.75× 实时），同句重复走内存缓存
 *
 * ⚠️ 授权：模型 facebook/mms-tts-grc 为 **CC-BY-NC 4.0（非商用）**，
 * 与本项目主体 GPL-3.0 不同。公开发布前请确认使用场景，详见 NOTICE.md。
 */
// 只声明用到的最小类型，不依赖 onnxruntime-web 自带的 d.ts
// （它由动态 import 从 public/ort/ 加载，不参与打包）
interface OrtTensor { data: Float32Array | BigInt64Array }
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>
}
interface OrtRuntime {
  env: { wasm: { wasmPaths: string; numThreads: number }; logLevel: string }
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown
  InferenceSession: {
    create(source: Uint8Array, opts?: unknown): Promise<OrtSession>
  }
}

export type NeuralStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'failed'

const MODEL_DIR = 'mms-grc/'
const ORT_DIR = 'ort/'
const SAMPLE_RATE = 16000

let ort: OrtRuntime | null = null
let session: OrtSession | null = null
let vocab: Record<string, number> | null = null
let initPromise: Promise<boolean> | null = null

/**
 * 同一句的并发请求合并。
 *
 * 悬停会预生成、点击又会请求一次，两者会**同时**跑推理；而 WASM 是单线程的，
 * 两次并发推理会让各自耗时翻倍（实测把 3.5 秒拖成 7.5 秒）。
 * 这里用「文本 → Promise」的表，让同一句只跑一次推理，后来者共享结果。
 */
const inflight = new Map<string, Promise<string | null>>()

let status: NeuralStatus = 'idle'
let progress = 0
const listeners = new Set<(s: NeuralStatus, p: number) => void>()

const cache = new Map<string, string>()
const CACHE_MAX = 120

/**
 * 语速。模型本身的语速调不了（VITS 的时长由权重决定，config 里的
 * speaking_rate 改了没用，实测只是随机时长预测器的噪声），
 * 所以改用 <audio> 的 playbackRate + preservesPitch 做**保音高变速**，
 * 由浏览器完成，不需要自己写变速算法。
 */
let rate = 0.82
export function setNeuralRate(r: number) { rate = Math.max(0.5, Math.min(1.4, r)) }
export function getNeuralRate() { return rate }

// ---- 持久化音频缓存：同一句话重进页面也能秒出
const TTS_CACHE = 'greek-tts-v1'

async function cacheKey(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fromPersistentCache(text: string): Promise<string | null> {
  try {
    if (!('caches' in window)) return null
    const key = await cacheKey(text)
    const c = await caches.open(TTS_CACHE)
    const hit = await c.match(key)
    if (!hit) return null
    return URL.createObjectURL(await hit.blob())
  } catch { return null }
}

async function toPersistentCache(text: string, blob: Blob): Promise<void> {
  try {
    if (!('caches' in window)) return
    const key = await cacheKey(text)
    const c = await caches.open(TTS_CACHE)
    await c.put(key, new Response(blob))
  } catch { /* 配额不足等情况忽略 */ }
}

export function neuralStatus(): NeuralStatus { return status }
export function neuralProgress(): number { return progress }

export function onNeuralStatus(fn: (s: NeuralStatus, p: number) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function setStatus(s: NeuralStatus, p = progress) {
  status = s
  progress = p
  for (const fn of listeners) fn(s, p)
}

/** public 下的绝对地址：动态 import 的相对路径是相对 chunk 解析的，必须基于页面地址 */
function abs(path: string): string {
  return new URL((import.meta.env.BASE_URL || './') + path, document.baseURI).href
}

/** 下载一个文件并汇报进度 */
async function fetchWithProgress(url: string, onDelta?: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const total = Number(res.headers.get('content-length') || 0)
  if (!res.body || !total) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onDelta?.(value.length)
  }
  const out = new Uint8Array(got)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out.buffer
}

/**
 * 加载模型（首次会下载 ~128MB）。失败返回 false，调用方回退到 eSpeak。
 */
export function ensureNeural(): Promise<boolean> {
  if (initPromise) return initPromise
  setStatus('downloading', 0)

  initPromise = (async () => {
    try {
      // 1) ONNX Runtime WASM（约 14MB）
      const ortMod = (await import(/* @vite-ignore */ abs(ORT_DIR + 'ort.wasm.bundle.min.mjs'))) as unknown as OrtRuntime
      ortMod.env.wasm.wasmPaths = abs(ORT_DIR)
      ortMod.env.wasm.numThreads = 1        // 多线程需要 COOP/COEP 头，静态托管常常没有
      ortMod.env.logLevel = 'error'
      ort = ortMod
      setStatus('loading', 10)

      // 2) 词表
      vocab = await (await fetch(abs(MODEL_DIR + 'vocab.json'))).json() as Record<string, number>

      // 3) 模型本体（约 114MB）。
      //    它不是一整份文件：托管平台对单文件有上限（Cloudflare Pages 25MiB、
      //    GitHub 100MB），114MB 会被拒，所以构建时切成了 ≤20MB 的分片，
      //    这里并发拉取后拼接。分片数量由 manifest 给出。
      const manifest = await (await fetch(abs(MODEL_DIR + 'onnx/parts.json'))).json() as
        { parts: string[]; bytes: number }
      let loaded = 0
      const chunks = await Promise.all(manifest.parts.map(async (name) => {
        const b = await fetchWithProgress(abs(MODEL_DIR + 'onnx/' + name), (n) => {
          loaded += n
          setStatus('downloading', Math.min(95, 10 + (loaded / manifest.bytes) * 85))
        })
        return new Uint8Array(b)
      }))
      const buf = new Uint8Array(manifest.bytes)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.length }
      setStatus('loading', 96)
      session = await ort!.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      setStatus('ready', 100)
      return true
    } catch (e) {
      console.warn('[neuralTts] 加载失败，回退到 eSpeak', e)
      session = null
      setStatus('failed', 0)
      return false
    }
  })()
  return initPromise
}

/**
 * 分词：MMS 的 VitsTokenizer 是字符级，且**每个字符前插一个空白 token(0)**。
 * 文本先转小写、词尾 ς 归一为 σ，不在词表里的字符（如逗号）跳过。
 * 这几条规则是与 Python 端 transformers 的分词结果逐条比对出来的。
 */
function tokenize(text: string): number[] {
  const s = text.toLowerCase().replace(/ς/g, 'σ')
  const ids: number[] = [0]
  for (const ch of s) {
    const id = vocab?.[ch]
    if (id !== undefined) ids.push(id, 0)
  }
  return ids
}

function floatToWav(pcm: Float32Array, rate: number): Blob {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  const body = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]))
    body[i] = x < 0 ? x * 0x8000 : x * 0x7fff
  }
  return new Blob([header, body.buffer], { type: 'audio/wav' })
}

/**
 * 把句子切成适合分段合成的片段。
 *
 * 例句中位数就有 104 字符，整句一次推理要 5 秒以上，所以必须分段；
 * 但**分段不能分段播放**——多个 <audio> 元素顺序播放时，元素切换处有间隙，
 * 节奏会散（这正是「节奏乱」的来源之一）。做法是分段合成、拼成一个音频再播。
 */
export function splitForSpeech(text: string, maxLen = 42): string[] {
  const parts = text.split(/(?<=[,;·:.!?])\s+/).map((x) => x.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (p.length <= maxLen) { out.push(p); continue }
    let cur = ''
    for (const w of p.split(/\s+/)) {
      if (cur && (cur + ' ' + w).length > maxLen) { out.push(cur); cur = w }
      else cur = cur ? cur + ' ' + w : w
    }
    if (cur) out.push(cur)
  }
  const merged: string[] = []
  for (const seg of out) {
    const last = merged[merged.length - 1]
    if (last && (last + ' ' + seg).length <= maxLen * 0.7) merged[merged.length - 1] = last + ' ' + seg
    else merged.push(seg)
  }
  return merged.length ? merged : [text]
}

/**
 * 合成一句话，返回可播放的 blob URL；未就绪或失败返回 null。
 *
 * 内部按标点分段合成，再拼成一个音频——这样既避免长句一次推理太慢，
 * 又不会在分段之间产生播放间隙。段落之间补一小段静音，对应原标点的停顿。
 */
export function synthNeural(text: string): Promise<string | null> {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return Promise.resolve(null)
  const hit = cache.get(t)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(t)
  if (running) return running            // 已经在算了，直接共享这一次
  const p = doSynth(t).finally(() => inflight.delete(t))
  inflight.set(t, p)
  return p
}

async function doSynth(t: string): Promise<string | null> {
  const hit = cache.get(t)
  if (hit) return hit

  // 跨会话的持久缓存：同一句话再进来直接秒出，不用重新推理
  const persisted = await fromPersistentCache(t)
  if (persisted) { cache.set(t, persisted); return persisted }

  if (!(await ensureNeural()) || !session || !ort) return null

  try {
    const segs = splitForSpeech(t)
    const parts: Float32Array[] = []
    for (const seg of segs) {
      const pcm = await inferPcm(seg)
      if (!pcm) return null
      parts.push(trimSilence(pcm))     // 裁掉每段自带的首尾静音
    }
    // 拼接：停顿长度由段末标点决定（句末 220ms、逗号 130ms），
    // 而不是让各段自带的静音随意叠加
    const gaps = parts.map((_, i) => (i === 0 ? 0 : Math.round(SAMPLE_RATE * pauseAfter(segs[i - 1]))))
    const total = parts.reduce((a, p) => a + p.length, 0) + gaps.reduce((a, g) => a + g, 0)
    const merged = new Float32Array(total)
    let off = 0
    for (let i = 0; i < parts.length; i++) {
      off += gaps[i]
      merged.set(parts[i], off)
      off += parts[i].length
    }

    const blob = floatToWav(merged, SAMPLE_RATE)
    const url = URL.createObjectURL(blob)
    void toPersistentCache(t, blob)      // 异步写入，不阻塞播放

    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next().value
      if (first !== undefined) {
        const oldUrl = cache.get(first)
        if (oldUrl) URL.revokeObjectURL(oldUrl)
        cache.delete(first)
      }
    }
    cache.set(t, url)
    return url
  } catch (e) {
    console.warn('[neuralTts] 合成失败', e)
    return null
  }
}

/**
 * 裁掉首尾静音。
 *
 * VITS 每段输出都自带首尾静音（实测开头 0.46 秒、段尾也有）。直接拼接的话，
 * 相邻两段的「尾静音 + 间隙 + 首静音」叠起来能到 1.1 秒——比自然停顿长得多，
 * 听感上就是节奏一顿一顿的。所以先裁掉，再按标点补一个受控的停顿。
 */
function trimSilence(pcm: Float32Array, keepMs = 15): Float32Array {
  // 阈值取「本段峰值的 3%」而不是固定值：语音起音是渐强的，
  // 固定低阈值（0.008）裁不掉软起音，实测开头仍残留 0.42 秒静音。
  let peak = 0
  for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v }
  const thr = Math.max(0.01, peak * 0.03)
  let a = 0
  let b = pcm.length - 1
  while (a < pcm.length && Math.abs(pcm[a]) < thr) a++
  while (b > a && Math.abs(pcm[b]) < thr) b--
  if (b <= a) return pcm
  const keep = Math.round((SAMPLE_RATE * keepMs) / 1000)
  const lo = Math.max(0, a - keep)
  const hi = Math.min(pcm.length, b + 1 + keep)
  return pcm.subarray(lo, hi)
}

/** 段末标点决定停顿长短：句末长、逗号短 */
function pauseAfter(seg: string): number {
  const last = seg.trim().slice(-1)
  if ('.;·!?'.includes(last)) return 0.22
  if (',:'.includes(last)) return 0.13
  return 0.16
}

/** 单次推理，返回 PCM。不做缓存（缓存的是整句拼好的音频）。 */
async function inferPcm(t: string): Promise<Float32Array | null> {
  if (!session || !ort) return null
  const ids = tokenize(t)
  if (ids.length < 3) return null
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]),
  }
  const out = await session.run(feeds)
  return out.waveform.data as Float32Array
}

/**
 * 预热：提前把模型加载、建好推理会话，并跑一次很短的合成。
 *
 * 会话创建约 0.9 秒，**首次推理**还要额外约 0.7 秒（JIT 编译 + 算子预热），
 * 这段开销必须在用户点击之前吃掉，否则第一次点击要干等近 2 秒。
 */
export function warmupNeural(): void {
  if (status === 'ready') {
    void synthNeural('λόγος').catch(() => {})
    return
  }
  void ensureNeural().then((ok) => { if (ok) void synthNeural('λόγος').catch(() => {}) })
}

/** 是否已经可以立刻合成（不需要等待下载） */
export function neuralReady(): boolean {
  return status === 'ready' && !!session
}
