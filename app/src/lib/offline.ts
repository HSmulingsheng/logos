/** 离线资源缓存：把全部词表、语料与音频写入 CacheStorage */

const BASE = import.meta.env.BASE_URL || './'

export interface OfflineProgress {
  total: number
  done: number
  bytes: number
  failed: number
  running: boolean
  phase: string
}

async function activeCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  const keys = await caches.keys()
  const name = keys.find((k) => k.startsWith('greek-vocab-'))
  return caches.open(name ?? 'greek-vocab-manual')
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const e = await navigator.storage.estimate()
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
}

/** 收集需要离线保存的全部 URL */
async function collectUrls(): Promise<{ data: string[]; audio: string[] }> {
  const data: string[] = []
  const res = await fetch(`${BASE}data/manifest.json`)
  const manifest = await res.json()
  data.push('data/manifest.json', 'data/index.json', 'data/formindex.json', 'data/affix.json')
  for (const l of manifest.lessons) {
    data.push(`data/${l.file}`)
    // 例句/词形变化在同课的伴随文件里（生成时拆出）
    data.push(`data/${l.file.replace(/\.json$/, '.ex.json')}`)
  }
  for (const b of manifest.books) data.push(`data/corpus/${b.file}`)

  let audio: string[] = []
  try {
    const a = await fetch(`${BASE}data/audio-index.json`)
    if (a.ok) {
      // 与 audioUrl 的解析保持一致：'xxx.mp3' 在 audio/ 下，'audio-tts/xxx.m4a' 已是完整相对路径
      audio = ((await a.json()) as string[]).map(
        (f) => (f.includes('/') ? f : `audio/${f}`).split('/').map(encodeURIComponent).join('/'),
      )
    }
  } catch { /* 没有清单则跳过音频 */ }
  return { data, audio }
}

/**
 * 缓存全部离线资源。已缓存的会跳过，因此可重复点击续传。
 */
export async function cacheAll(
  onProgress: (p: OfflineProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const state: OfflineProgress = { total: 0, done: 0, bytes: 0, failed: 0, running: true, phase: '统计…' }
  const emit = () => onProgress({ ...state })

  const { data, audio } = await collectUrls()
  const urls = [...data, ...audio]
  state.total = urls.length
  state.phase = '下载中'
  emit()

  const cache = await activeCache()

  const run = async (path: string) => {
    if (signal?.aborted) return
    const url = `${BASE}${path}`
    try {
      if (cache && (await cache.match(url))) return   // 已缓存：done 由 finally 统一累加
      const r = await fetch(url, { signal })
      if (!r.ok) throw new Error(String(r.status))
      const blob = await r.blob()
      state.bytes += blob.size
      if (cache) await cache.put(url, new Response(blob, { headers: r.headers }))
    } catch {
      state.failed++
    } finally {
      state.done++
      if (state.done % 12 === 0 || state.done === state.total) emit()
    }
  }

  const CONCURRENCY = 6
  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= urls.length || signal?.aborted) return
      await run(urls[i])
    }
  })
  await Promise.all(workers)

  state.running = false
  state.phase = signal?.aborted ? '已中断' : '完成'
  emit()
}

export async function clearOfflineCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k.startsWith('greek-vocab-')).map((k) => caches.delete(k)))
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
