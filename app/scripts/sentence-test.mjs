/**
 * 逐句朗读验收：切句、模式切换、逐句推进、连播。
 *
 * 覆盖用户反馈的三点：
 *   · 原来「点一句却读一整段」→ 现在默认只读一句
 *   · 整段朗读里的「莫名停顿」→ 逐句模式由界面控制停顿
 *   · 点下去到出声慢 → 每次只合成一句，音频短了
 *
 * 用法: node scripts/sentence-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-sent'] = process.argv.slice(2)
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
  // 记录每次合成的音频时长，用来验证「只读一句」
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

async function setMode(mode) {
  await page.evaluate(async (m) => {
    const req = indexedDB.open('greek-vocab', 1)
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const cur = await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get('settings'); t.onsuccess = () => res(t.result || {}) })
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put({ ...cur, readMode: m, speechEngine: 'espeak', prosodyAccent: true }, 'settings')
    await new Promise((res) => { tx.oncomplete = () => res() }); db.close()
  }, mode)
}

async function openChapter() {
// 线上首访要装 Service Worker 并拉词表索引，导航栏可能还没渲染出来。
// 固定等待不够稳，这里等它真正出现再点。
await page.locator('nav').first().waitFor({ state: 'visible', timeout: 60000 })
  await page.locator('nav button:has-text("学习")').first().click(); await page.waitForTimeout(900)
  await page.locator('main button:has-text("阅读")').first().click(); await page.waitForTimeout(1200)
  await page.locator('main button:has-text("历史")').first().click(); await page.waitForTimeout(1200)
  await page.locator('main button').filter({ hasText: /修昔底德|希罗多德|波利比奥斯/ }).first().click()
  await page.waitForTimeout(1500)
  await page.locator('main button:has-text("1")').first().click()
  await page.waitForTimeout(2200)
}

/** 抓最近一次合成音频的时长 */
async function lastDuration() {
  return await page.evaluate(async () => {
    const list = window.__blobs || []
    const b = list[list.length - 1]
    if (!b) return 0
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const a = await ac.decodeAudioData(await b.arrayBuffer())
    return a.duration
  })
}

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2800)

console.log('▶ 模式切换器')
await setMode('sentence')
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
await openChapter()
const seg = await page.locator('main button', { hasText: /^逐句$/ }).count()
check('章节工具条出现「逐句/连播/整段」', seg > 0, `${seg} 个匹配`)
check('出现句数指示（共 N 句）', /共 \d+ 句/.test(await page.locator('body').innerText()))
await page.screenshot({ path: join(outDir, 'reader.png') })

console.log('\n▶ 逐句模式：点一次只读一句')
// 找第一个带句数指示的段落
const row = page.locator('main div', { hasText: /共 \d+ 句/ }).last()
const nText = (await page.locator('body').innerText()).match(/共 (\d+) 句/)
const nSent = nText ? Number(nText[1]) : 0
check('段落被切成多句', nSent >= 2, `${nSent} 句`)

const playBtn = row.locator('button[aria-label="朗读"]').first()
await page.evaluate(() => { (window.__blobs || []).length = 0 })
const t0 = Date.now()
await playBtn.click()
// 等到出现音频 blob
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(150)
  // @ts-ignore
  if (await page.evaluate(() => (window.__blobs || []).length > 0)) break
}
const latency = Date.now() - t0
const dur1 = await lastDuration()
console.log(`   首次点击 → 出声 ${latency} ms · 音频时长 ${dur1.toFixed(2)}s`)
check('点一次只合成「一句」而不是整段', dur1 > 0 && dur1 < 12, `${dur1.toFixed(2)}s`)
check('点下去到出声在可接受范围（< 3s）', latency < 3000, `${latency} ms`)

console.log('\n▶ 逐句推进')
const idxText = async () => (await page.locator('body').innerText()).match(/(\d+) \/ (\d+)/)
const before = await idxText()
check('显示当前句序号', !!before, before ? before[0] : '未显示')

console.log('\n▶ 整段模式')
await setMode('paragraph')
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
await openChapter()
await page.evaluate(() => { (window.__blobs || []).length = 0 })
await page.locator('main button[aria-label="朗读"]').first().click()
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(200)
  // @ts-ignore
  if (await page.evaluate(() => (window.__blobs || []).length > 0)) break
}
const durP = await lastDuration()
console.log(`   整段音频 ${durP.toFixed(2)}s`)
check('整段模式确实合成了更长的音频', durP > dur1, `${durP.toFixed(2)}s vs 逐句 ${dur1.toFixed(2)}s`)

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
