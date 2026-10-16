/**
 * 神经语音（MMS-TTS）验收：切换引擎 → 下载模型 → 朗读例句 → 解码确认音质。
 *
 * 用法: node scripts/neural-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-neural'] = process.argv.slice(2)
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
  if (/\/mms-grc\/|\/ort\//.test(u)) fetched.push(u.split('/').slice(-1)[0])
})
await page.addInitScript(() => {
  window.__plays = []
  window.__blobs = []
  const o = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    window.__plays.push({ src: this.src, rate: this.playbackRate, pitch: this.preservesPitch })
    return o.apply(this, a)
  }
  const co = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (x) => { if (x instanceof Blob) window.__blobs.push(x); return co(x) }
  localStorage.setItem('greek-welcomed-v2', '1')
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}
const plays = () => page.evaluate(() => window.__plays.length)
const playInfo = () => page.evaluate(() => window.__plays[window.__plays.length - 1])

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2500)

// 1) 设置里切到高清引擎
await page.locator('nav >> text="我的"').click()
await page.waitForTimeout(700)
await page.locator('text="设置"').first().click()
await page.waitForTimeout(1200)
check('设置里有引擎选择器', (await page.locator('button:has-text("高清")').count()) > 0)

const t0 = Date.now()
await page.locator('button:has-text("高清")').first().click()
let ready = false
let note = ''
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1500)
  const t = await page.evaluate(() => document.body.innerText)
  // 默认引擎就是高清、启动时已预热好，此时点击不会产生「已就绪」提示
  // （无事可做），所以状态标签显示「已就绪」也算通过
  if (t.includes('高清语音已就绪')) { ready = true; break }
  if (t.includes('已就绪')) { ready = true; note = '启动预热已完成'; break }
  if (t.includes('下载失败')) { note = '下载失败'; break }
}
check('切换到高清引擎', ready, `${((Date.now() - t0) / 1000).toFixed(1)}s${note ? ' · ' + note : ''}`)
// 模型是分片下发的（托管平台单文件上限 25MiB），所以检查分片而不是整份文件
const p01 = [...new Set(fetched)].filter((f) => /^model\.onnx\.part-\d+$/.test(f))
check('下载了模型分片与运行时',
  p01.length >= 2 && fetched.includes('parts.json') && fetched.some((f) => /ort.*\.wasm$/.test(f)),
  `${p01.length} 个分片 · ${[...new Set(fetched)].filter((f) => /ort/.test(f)).join(',')}`)
await page.screenshot({ path: `${outDir}/neural-setting.png` })

// 2) 朗读例句
// 「词典」已并入「学习 → 单词」，不再是底部独立菜单
// 线上首访要装 Service Worker 并拉词表索引，导航栏可能还没渲染出来。
// 固定等待不够稳，这里等它真正出现再点。
await page.locator('nav').first().waitFor({ state: 'visible', timeout: 60000 })
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(700)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(1500)
await page.locator('input[placeholder^="搜索希腊语"]').fill('λόγος')
await page.waitForTimeout(1100)
await page.locator('main button.card-surface').first().click()
await page.waitForTimeout(1600)

const before = await plays()
await page.locator('div.fixed.z-50 button[aria-label="朗读例句"]').first().click()
let played = false
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500)
  if ((await plays()) > before) { played = true; break }
}
check('点击例句触发播放', played)

// 3) 解码并确认是神经语音（16kHz）且不是静音
const info = await page.evaluate(async () => {
  const blob = window.__blobs[window.__blobs.length - 1]
  if (!blob) return null
  const buf = await blob.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const a = await ctx.decodeAudioData(buf.slice(0))
  const ch = a.getChannelData(0)
  let peak = 0, sum = 0
  for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; sum += v }
  return { secs: a.duration, rate: a.sampleRate, peak, avg: sum / ch.length, bytes: buf.byteLength }
})
check('音频可解码', !!info, info ? `${info.secs.toFixed(2)}s @${info.rate}Hz ${(info.bytes / 1024).toFixed(0)}KB` : '')
check('是神经语音（16kHz 采样）', !!info && info.rate === 16000, info ? `${info.rate}Hz` : '')
check('音频不是静音', !!info && info.peak > 0.2 && info.avg > 0.03,
  info ? `峰值 ${info.peak.toFixed(3)} 均值 ${info.avg.toFixed(4)}` : '')
// 神经语音的语音密度显著高于 eSpeak（eSpeak 均值约 0.04，神经约 0.12）
check('语音密度明显优于 eSpeak', !!info && info.avg > 0.08, info ? `均值 ${info.avg.toFixed(4)}（eSpeak 约 0.04）` : '')
await page.screenshot({ path: `${outDir}/neural-detail.png` })

// 4) 第二次点击走缓存，应很快
const t1 = Date.now()
const b2 = await plays()
await page.locator('div.fixed.z-50 button[aria-label="朗读例句"]').first().click()
for (let i = 0; i < 20; i++) { await page.waitForTimeout(200); if ((await plays()) > b2) break }
check('重复朗读走缓存', (await plays()) > b2 && Date.now() - t1 < 4000, `${Date.now() - t1}ms`)

// 5) 语速（保音高变速）——模型本身调不了语速，用 playbackRate 实现
const pi = await playInfo()
check('应用了语速且保音高', !!pi && pi.rate > 0.5 && pi.rate < 1.4 && pi.pitch === true,
  pi ? `playbackRate=${pi.rate} preservesPitch=${pi.pitch}` : '')

// 6) 长句应当是**一个**拼接好的音频，而不是多个音频元素顺序播放
//    （多个元素切换处有间隙，节奏会散）
await page.waitForTimeout(9000)
const nn = await plays()
check('整句拼接为单个音频播放', nn === 3, `本次共触发播放 ${nn} 次（词条音 + 例句 + 重放）`)

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 6).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
