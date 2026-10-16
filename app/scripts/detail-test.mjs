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

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2200)

// 「词典」已并入「学习 → 单词」，不再是底部独立菜单
// 线上首访要装 Service Worker 并拉词表索引，导航栏可能还没渲染出来。
// 固定等待不够稳，这里等它真正出现再点。
await page.locator('nav').first().waitFor({ state: 'visible', timeout: 60000 })
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(700)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(1800)

// 词典要加载 1.4MB 的索引；线上（到 GitHub 只有几十 KB/s）固定等待不够，
// 统一轮询到列表出现再继续。
const rows = page.locator('main button.card-surface')
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500)
  if (await rows.count() > 0) break
}

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
// 例句与词形变化是**按需加载**的（生成时拆到 lesson-NN.ex.json，
// 占整课 70%，不进首屏关键路径）。这条断言就是守这个拆分的：
// 拆出后详情页必须仍能拿到并渲染它们，否则用户会「例句凭空消失」。
{
  const t = await sheetText()
  const hasEx = /真实语料例句/.test(t)
  const hasFm = /词形变化/.test(t)
  // 例句正文应当是一句希腊语（而不是只有标题）
  const greekLine = /[\u0370-\u03ff\u1f00-\u1fff]{6,}/.test(t)
  check('详情页按需加载并渲染了例句', hasEx && greekLine,
    hasEx ? (greekLine ? '有标题且含希腊语句子' : '有标题但没有例句正文') : '没有例句区块')
  check('详情页按需加载并渲染了词形变化', hasFm, hasFm ? '有词形变化表' : '没有词形变化区块')
}

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
  // 搜索要过滤 1.4MB 的索引；线上慢，固定等待不够（第一个探针尤其慢）
  let n = 0
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400)
    n = await rows.count()
    if (n > 0) break
  }
  if (n === 0) { console.log(`   ⚠️ 搜索「${w}」没有结果`); continue }
  const b0 = await plays()
  await rows.first().click()
  // ⚠️ 这些词来自后期课程，而列表默认只加载了第 1 课：
  //    open() 里要先 fetch lesson-XX.json 才能拿到词条。
  //    线上到 GitHub 只有几十 KB/s，一个 lesson 文件要十几秒——
  //    所以这里的等待必须**按「下载一个课程文件」的量级给足**，不能按毫秒算。
  let opened = false
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(500)
    opened = (await sheetCount()) > 0
    if (opened && (await plays()) - b0 > 0) break
  }
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
