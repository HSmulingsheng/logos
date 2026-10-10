/**
 * 词库详情页验收：任意词都能打开、打开即发音、内容齐全、按 R 重放。
 *
 * 用法: node scripts/detail-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-detail'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(() => {
  window.__plays = 0
  const o = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) { window.__plays++; return o.apply(this, a) }
  localStorage.setItem('greek-welcomed-v2', '1')
})

const plays = () => page.evaluate(() => window.__plays)
const sheetCount = () => page.locator('div.fixed.z-50').count()
const sheetText = async () => ((await sheetCount()) ? page.locator('div.fixed.z-50').innerText() : '')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2200)

// 「词典」已并入「学习 → 单词」，不再是底部独立菜单
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(700)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(1800)

const rows = page.locator('main button.card-surface')

// 1) 默认列表第一个词：打开 + 自动发音 + 内容齐全
let before = await plays()
await rows.first().click()
await page.waitForTimeout(1600)
const t1 = await sheetText()
check('点击词条弹出详情页', (await sheetCount()) > 0)
check('详情页打开时自动发音', (await plays()) - before > 0)
for (const [label, re] of [
  ['中文释义', /中文释义/], ['英文释义', /英文释义/],
  ['词性', /名词|动词|形容词|代词|冠词|副词|介词|连词|数词|小品词/],
  ['屈折变形', /词形变化/], ['真实语料例句', /语料例句/], ['词频', /新约出现/],
]) {
  check(`详情页显示${label}`, re.test(t1))
}
await page.screenshot({ path: `${outDir}/detail-open.png` })

// 2) 按 R 重放（大小写都要）
before = await plays()
await page.keyboard.press('r')
await page.waitForTimeout(700)
const r1 = (await plays()) - before
before = await plays()
await page.keyboard.press('R')
await page.waitForTimeout(700)
const r2 = (await plays()) - before
check('详情页按 R 重放发音', r1 > 0 && r2 > 0, `r=${r1} R=${r2}`)

// 3) Esc 关闭后 R 不应再触发
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
check('Esc 可关闭详情页', (await sheetCount()) === 0)
before = await plays()
await page.keyboard.press('r')
await page.waitForTimeout(500)
check('关闭后按 R 不再发音', (await plays()) - before === 0)

// 4) 跨课程搜索的词也能打开（默认列表只有第 1 课，这些来自后期课程）
const input = page.locator('input[placeholder^="搜索希腊语"]')
let crossOk = 0
const probes = ['ἀρνίον', 'βασιλεία', 'πιστεύω', 'ἀγάπη']
for (const w of probes) {
  await input.fill(w)
  await page.waitForTimeout(1100)
  const n = await rows.count()
  if (n === 0) { console.log(`   ⚠️ 搜索「${w}」没有结果`); continue }
  const b0 = await plays()
  await rows.first().click()
  await page.waitForTimeout(1800)
  const opened = (await sheetCount()) > 0
  const played = (await plays()) - b0 > 0
  const body = await sheetText()
  if (opened && played && /中文释义/.test(body)) crossOk++
  else console.log(`   ⚠️「${w}」面板=${opened} 发音=${played}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}
check(`跨课程词也能打开（${crossOk}/${probes.length}）`, crossOk === probes.length)

// 5) 列表中间与末尾的词同样可点（不限第一条）
await input.fill('')
await page.waitForTimeout(800)
let spotOk = 0
for (const i of [0, 40, 80, 119]) {
  if ((await rows.count()) <= i) break
  await rows.nth(i).click()
  await page.waitForTimeout(1500)
  if ((await sheetCount()) > 0 && /中文释义/.test(await sheetText())) spotOk++
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
}
check('列表任意位置都能打开', spotOk >= 3, `抽查 ${spotOk} 条`)

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 6).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
