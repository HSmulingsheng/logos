/**
 * 例句发音验收：点例句喇叭 → 浏览器内 eSpeak 合成 → 播放 → 解码确认不是静音。
 *
 * 用法: node scripts/sentence-audio-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-sentence'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })

const errors = []
const fetched = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('request', (r) => {
  const u = r.url()
  if (/\/espeak\//.test(u)) fetched.push(u.split('/').pop())
})
await page.addInitScript(() => {
  window.__plays = []
  window.__blobs = []
  const o = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    window.__plays.push(this.src)
    return o.apply(this, a)
  }
  // 直接拦截 createObjectURL 拿到 Blob 本体：
  // blob: URL 的生命周期不好把握，用它去 fetch 有时会失败
  const orig = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (obj) => {
    if (obj instanceof Blob) window.__blobs.push(obj)
    return orig(obj)
  }
  localStorage.setItem('greek-welcomed', '1')
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}
const plays = () => page.evaluate(() => window.__plays.length)

await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 })
await page.waitForTimeout(2200)

// 本脚本专门验证「轻量」eSpeak 引擎，所以先把引擎切过去
// （默认引擎是「高清」神经语音，那部分由 neural-test.mjs 覆盖）
await page.locator('nav >> text="我的"').click()
await page.waitForTimeout(700)
await page.locator('text="设置"').first().click()
await page.waitForTimeout(1200)
await page.locator('button:has-text("轻量")').first().click()
await page.waitForTimeout(800)

// 「词典」已并入「学习 → 单词」，不再是底部独立菜单
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(600)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(1500)
await page.locator('input[placeholder^="搜索希腊语"]').fill('λόγος')
await page.waitForTimeout(1000)
await page.locator('main button.card-surface').first().click()
await page.waitForTimeout(1600)

const sheet = page.locator('div.fixed.z-50')
const speaker = sheet.locator('button[aria-label="朗读例句"]').first()
check('例句旁有朗读按钮', (await sheet.locator('button[aria-label="朗读例句"]').count()) >= 1)

// 首次点击：需要加载 24MB 引擎
const t0 = Date.now()
const before = await plays()
await speaker.click()
let fired = false
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500)
  if ((await plays()) > before) { fired = true; break }
}
const firstMs = Date.now() - t0
check('点击后触发播放', fired, `首次耗时 ${(firstMs / 1000).toFixed(1)}s（含引擎加载）`)
check('加载了 eSpeak 引擎与数据', fetched.includes('espeak-ng.js') && fetched.includes('espeak-ng.data'),
  [...new Set(fetched)].join(', '))

// 播放源应是 blob（实时合成的 WAV）
const src = await page.evaluate(() => (window.__plays || []).slice(-1)[0] || '')
check('播放的是实时合成的音频', src.startsWith('blob:'), src.slice(0, 40))

// 解码确认不是静音、时长合理
const decoded = await page.evaluate(async () => {
  const blob = (window.__blobs || []).slice(-1)[0]
  if (!blob) return null
  const buf = await blob.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 22050)
  const audio = await ctx.decodeAudioData(buf.slice(0))
  const ch = audio.getChannelData(0)
  let peak = 0, sum = 0
  for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; sum += v }
  return { seconds: audio.duration, rate: audio.sampleRate, peak, avg: sum / ch.length, bytes: buf.byteLength }
})
check('合成音频可解码', !!decoded, decoded ? `${decoded.seconds.toFixed(1)}s @${decoded.rate}Hz, ${(decoded.bytes / 1024).toFixed(0)}KB` : '')
check('音频不是静音', !!decoded && decoded.peak > 0.05 && decoded.avg > 0.001,
  decoded ? `峰值 ${decoded.peak.toFixed(3)} 均值 ${decoded.avg.toFixed(4)}` : '')
check('时长与句子长度相称', !!decoded && decoded.seconds > 0.5 && decoded.seconds < 30,
  decoded ? `${decoded.seconds.toFixed(1)}s` : '')

// 第二次点击：应走缓存，明显更快
const t1 = Date.now()
const b2 = await plays()
await speaker.click()
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(200)
  if ((await plays()) > b2) break
}
const secondMs = Date.now() - t1
check('第二次点击立即播放（命中缓存）', (await plays()) > b2 && secondMs < 3000, `${secondMs}ms`)
await page.screenshot({ path: `${outDir}/sentence-audio.png` })

// 语法闯关里的教材例句也能读
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
await page.locator('nav >> text="学习"').click()      // 语法在「学习」标签下
await page.waitForTimeout(800)
await page.locator('text="语法"').first().click()
await page.waitForTimeout(1800)
const tbBtn = page.locator('text=教材对照')
if (await tbBtn.count()) {
  await tbBtn.first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const unit = page.locator('button:has-text("第一变格")').first()
  if (await unit.count()) {
    await unit.click()
    await page.waitForTimeout(800)
    const sp = page.locator('button[aria-label="朗读例句"]').first()
    const hasSp = await sp.count()
    const b3 = await plays()
    if (hasSp) { await sp.click(); await page.waitForTimeout(1500) }
    check('教材例句也能朗读', hasSp > 0 && (await plays()) > b3)
    await page.screenshot({ path: `${outDir}/textbook-audio.png` })
  }
}

// 断网后仍能合成：引擎已被 Service Worker 缓存，例句发音同样离线可用
const ctx = page.context()
const cachedEngine = await page.evaluate(async () => {
  for (const k of await caches.keys()) {
    const c = await caches.open(k)
    const hit = (await c.keys()).filter((r) => /\/espeak\//.test(r.url)).map((r) => r.url.split('/').pop())
    if (hit.length) return hit
  }
  return []
})
check('引擎已进入离线缓存', cachedEngine.includes('espeak-ng.js') && cachedEngine.includes('espeak-ng.data'),
  cachedEngine.join(', '))

await ctx.setOffline(true)
const offline = await page.evaluate(async () => {
  try {
    const base = new URL('./espeak/', document.baseURI).href
    const mod = await import(/* @vite-ignore */ base + 'espeak-ng.js')
    const M = await mod.default({ locateFile: (x) => base + x })
    const w = new M.eSpeakNGWorker()
    w.set_voice('grc'); w.set_rate(120)
    let n = 0
    w.synthesize('καὶ ὁ λόγος σὰρξ ἐγένετο', (d) => { if (d?.length) n += d.length; return false })
    return { ok: n > 1000, n }
  } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 120) } }
})
check('断网后仍能合成例句发音', offline.ok, offline.ok ? `${offline.n} 个采样` : offline.err)
await ctx.setOffline(false)

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 6).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
