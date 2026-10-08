/**
 * 音频可播放性验证：确认原牌组 mp3 与 eSpeak 生成的 m4a 都能在本环境中真正解码播放。
 * 用 Audio 元素 + AudioContext.decodeAudioData 双重确认，避免「能下载但不能播」。
 *
 * 用法: node scripts/audio-test.mjs <url> [outDir]
 */
import { chromium } from 'playwright-core'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url] = process.argv.slice(2)

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(1500)

// 从应用数据里取一个有原录音的词、一个有 TTS 的词
const targets = await page.evaluate(async () => {
  const out = []
  const idx = await (await fetch('./data/audio-index.json')).json()
  const mp3 = idx.find((f) => f.endsWith('.mp3'))
  const m4a = idx.find((f) => f.endsWith('.m4a'))
  if (mp3) out.push({ kind: '原录音 mp3', path: mp3 })
  if (m4a) out.push({ kind: 'TTS m4a', path: m4a })
  return out
})

console.log('测试目标:', JSON.stringify(targets))

const results = []
for (const t of targets) {
  const r = await page.evaluate(async ({ path, kind }) => {
    // 与应用的 audioUrl 保持一致：无目录前缀的原录音在 audio/ 下
    const full = path.includes('/') ? path : 'audio/' + path
    const url = './' + full.split('/').map(encodeURIComponent).join('/')
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    const info = { kind, url, status: res.status, bytes: buf.byteLength, contentType: res.headers.get('content-type') }

    // 1) 用 Audio 元素判断能否播放
    info.canPlay = await new Promise((resolve) => {
      const a = new Audio(url)
      const done = (v) => { a.src = ''; resolve(v) }
      a.addEventListener('canplaythrough', () => done(true), { once: true })
      a.addEventListener('error', () => done(false), { once: true })
      setTimeout(() => done('timeout'), 6000)
      a.load()
    })

    // 2) 用 WebAudio 真正解码，拿到时长
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const decoded = await ctx.decodeAudioData(buf.slice(0))
      info.decodedSeconds = Number(decoded.duration.toFixed(3))
      info.channels = decoded.numberOfChannels
      info.sampleRate = decoded.sampleRate
      await ctx.close()
    } catch (e) {
      info.decodeError = String(e).slice(0, 120)
    }
    return info
  }, t)
  results.push(r)
  const ok = r.canPlay === true && r.decodedSeconds > 0.1
  console.log(`${ok ? '✅' : '❌'} ${r.kind}  ${r.path ?? ''}`)
  console.log(`   HTTP ${r.status} · ${r.bytes} B · ${r.contentType}`)
  console.log(`   canplaythrough=${r.canPlay} · 解码时长=${r.decodedSeconds ?? '失败'}s · ${r.channels ?? '?'}ch @ ${r.sampleRate ?? '?'}Hz`)
  if (r.decodeError) console.log(`   解码错误: ${r.decodeError}`)
}

const failed = results.filter((r) => !(r.canPlay === true && r.decodedSeconds > 0.1))
console.log('')
console.log(failed.length === 0 ? `全部 ${results.length} 项可播放` : `${failed.length}/${results.length} 项不可播放`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
