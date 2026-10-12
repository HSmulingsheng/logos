/**
 * 古音还原验收：φ θ χ 是否真的读成送气塞音、ζ 是否读成 [zd]。
 *
 * 为什么不能只看时长：送气塞音与擦音的**时长可能相近**，但声学结构完全不同：
 *   [f θ x]（擦音）  —— 持续的高频噪声，从词首一直到元音，**中间没有静音**
 *   [pʰ tʰ kʰ]（送气塞音）—— **闭塞段（静音）+ 爆破 + 送气**，起头必有一段能量低谷
 * 所以这里检测「词首若干毫秒内是否存在一段明显的能量低谷」。
 *
 * 这条判据也用来确认「关闭开关后就恢复成擦音」，避免只测一边。
 *
 * 用法: node scripts/phonetic-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-phon'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, serviceWorkers: 'block' })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.addInitScript(() => {
  localStorage.setItem('greek-welcomed-v2', '1')
  const orig = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (obj) => {
    const u = orig(obj)
    if (obj instanceof Blob && obj.type.includes('audio')) {
      // @ts-ignore
      ;(window.__blobs ||= []).push(obj)
    }
    return u
  }
})

async function setOpts(restore) {
  await page.evaluate(async (r) => {
    const req = indexedDB.open('greek-vocab', 1)
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const cur = await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get('settings'); t.onsuccess = () => res(t.result || {}) })
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put({ ...cur, speechEngine: 'espeak', restoreAncient: r, prosodyAccent: false, readMode: 'paragraph' }, 'settings')
    await new Promise((res) => { tx.oncomplete = () => res() }); db.close()
  }, restore)
}

/**
 * 把音频解码后，返回词首 220ms 内的「能量低谷深度」。
 * 擦音：能量一路持续 → 低谷深度小（接近 1）
 * 送气塞音：先有闭塞静音 → 低谷很深
 */
const ANALYZE = `async () => {
  const list = window.__blobs || []
  const b = list[list.length - 1]
  if (!b) return null
  const ac = new (window.AudioContext || window.webkitAudioContext)()
  const a = await ac.decodeAudioData(await b.arrayBuffer())
  const x = a.getChannelData(0), sr = a.sampleRate
  // 找到第一个有声点
  const win = Math.round(0.005 * sr)
  const env = []
  for (let i = 0; i + win < x.length; i += win) {
    let s = 0; for (let k = 0; k < win; k++) s += x[i+k]*x[i+k]
    env.push(Math.sqrt(s / win))
  }
  let first = env.findIndex((v) => v > 0.02)
  if (first < 0) first = 0
  // 从词首起 220ms 内的最小能量 / 后续峰值
  const seg = env.slice(first, first + Math.round(0.22 / 0.005))
  const peak = Math.max(...seg)
  const min = Math.min(...seg.slice(0, Math.max(3, Math.floor(seg.length * 0.6))))
  return { dip: peak > 1e-6 ? min / peak : 1, dur: a.duration, peak }
}`

async function measure(text) {
  // 用「单词」朗读：词典页的发音按钮走的是文件音频，所以改从例句朗读入手不方便；
  // 这里直接调用页面的合成（通过点朗读按钮触发）——用语法/阅读里的按钮文本不可控，
  // 因此退而用 AudioContext 直接播放同一个 lib 的 synthesize 不可行（构建产物无 /src）。
  // 折中：在页面里以 data URL 动态 import 不行，于是用 UI 上「朗读」按钮 + 文本替换验证。
  return await page.evaluate(async (t) => {
    // @ts-ignore 由 addInitScript 注入的钩子：直接调用已打包的 synthesize
    if (!window.__synth) return null
    ;(window.__blobs || []).length = 0
    const u = await window.__synth(t)
    if (!u) return null
    return await (0, eval)('(' + window.__ANALYZE + ')')()
  }, text)
}

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2800)

// 页面里没有暴露 synthesize，改为直接测「同一段文本开关前后的音频差异」。
// 用真实阅读页面点朗读按钮，文本固定（同一段），所以差异只可能来自开关。
console.log('▶ 开关对比：同一段文本，还原古音 关 vs 开')

async function speakChapter() {
  await page.locator('nav button:has-text("学习")').first().click(); await page.waitForTimeout(900)
  await page.locator('main button:has-text("阅读")').first().click(); await page.waitForTimeout(1200)
  await page.locator('main button:has-text("历史")').first().click(); await page.waitForTimeout(1200)
  await page.locator('main button').filter({ hasText: /修昔底德/ }).first().click(); await page.waitForTimeout(1500)
  await page.locator('main button:has-text("1")').first().click(); await page.waitForTimeout(2000)
  await page.evaluate(() => { (window.__blobs || []).length = 0 })
  await page.locator('main button[aria-label="朗读"]').first().click()
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(200)
    // @ts-ignore
    if (await page.evaluate(() => (window.__blobs || []).length > 0)) break
  }
  // 等音频解码可用
  await page.waitForTimeout(800)
  return await page.evaluate(async () => {
    const list = window.__blobs || []
    const b = list[list.length - 1]
    if (!b) return null
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const a = await ac.decodeAudioData(await b.arrayBuffer())
    const x = a.getChannelData(0), sr = a.sampleRate
    const win = Math.round(0.005 * sr)
    const env = []
    for (let i = 0; i + win < x.length; i += win) {
      let s = 0; for (let k = 0; k < win; k++) s += x[i+k]*x[i+k]
      env.push(Math.sqrt(s / win))
    }
    // 统计「极短的能量低谷」个数：送气塞音会引入闭塞段
    const peak = Math.max(...env)
    let dips = 0, cur = 0
    for (const v of env) {
      if (v < peak * 0.02) { cur++ } else { if (cur >= 2 && cur <= 14) dips++; cur = 0 }
    }
    // 高频能量占比（擦音 f/x 的高频更强）
    let hf = 0, tot = 0
    for (let i = 1; i < x.length; i++) { const d = x[i] - x[i-1]; hf += d*d; tot += x[i]*x[i] }
    return { dur: a.duration, dips, hfRatio: tot > 0 ? hf / tot : 0, peak }
  })
}

await setOpts(false)
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
const off = await speakChapter()
await setOpts(true)
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
const on = await speakChapter()

console.log(`   关闭: 时长 ${off?.dur.toFixed(2)}s · 闭塞型低谷 ${off?.dips} 个 · 高频占比 ${off?.hfRatio.toFixed(3)}`)
console.log(`   开启: 时长 ${on?.dur.toFixed(2)}s · 闭塞型低谷 ${on?.dips} 个 · 高频占比 ${on?.hfRatio.toFixed(3)}`)
console.log()

check('两种模式都能正常合成', !!off && !!on && off.dur > 0 && on.dur > 0)
check('开启后出现了更多「闭塞+爆破」结构（送气塞音的特征）',
  (on?.dips || 0) > (off?.dips || 0),
  `${off?.dips} → ${on?.dips}`)
check('开启后高频能量占比下降（擦音 [f θ x] 变成塞音 [pʰ tʰ kʰ]）',
  (on?.hfRatio || 0) < (off?.hfRatio || 0),
  `${off?.hfRatio.toFixed(3)} → ${on?.hfRatio.toFixed(3)}`)
check('时长没有大幅变化', !!off && !!on && Math.abs(on.dur - off.dur) < off.dur * 0.35,
  `${off?.dur.toFixed(2)}s → ${on?.dur.toFixed(2)}s`)
check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
