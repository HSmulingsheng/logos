/**
 * 词库详情页可用性验证：切到「词典」→ 搜索 → 点词条 → 详情面板是否打开。
 * 用法: node scripts/browse-test.mjs <url> [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url, outDir = '/tmp/greek-browse'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })

const errors = []
const logs = []
page.on('console', (m) => {
  logs.push(`[${m.type()}] ${m.text()}`)
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2000)

// 首次访问会弹「游客模式」说明，先关掉再操作
await page.locator('text="开始使用"').click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(500)


// 1) 切到「词书」标签，再切到「词典」分栏
// 「词典」已并入「学习 → 单词」，不再是底部独立菜单
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(600)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(1500)

const cards = page.locator('main button.card-surface')
const n = await cards.count()
check('词库列表已渲染', n > 0, `${n} 条`)

// 2) 点第一条（默认列表）
const firstText = n > 0 ? (await cards.first().innerText()).replace(/\s+/g, ' ').slice(0, 40) : ''
if (n > 0) {
  await cards.first().click()
  await page.waitForTimeout(1800)
}
const sheetOpen = await page.locator('div.fixed.z-50').count()
check('点击词条后详情面板打开（默认列表）', sheetOpen > 0, `第一条：${firstText}`)
await page.screenshot({ path: `${outDir}/browse-default.png` })

// 关掉
if (sheetOpen > 0) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(900)
  check('Esc 可关闭详情面板', (await page.locator('div.fixed.z-50').count()) === 0)
}

// 3) 搜索后再点
const input = page.locator('input[placeholder^="搜索希腊语"]')
await input.fill('λόγος')
await page.waitForTimeout(1200)
const searched = page.locator('main button.card-surface')
const m = await searched.count()
check('搜索结果出现', m > 0, `${m} 条`)
if (m > 0) {
  await searched.first().click()
  await page.waitForTimeout(1800)
}
const sheetOpen2 = await page.locator('div.fixed.z-50').count()
check('点击搜索结果后详情面板打开', sheetOpen2 > 0)
await page.screenshot({ path: `${outDir}/browse-search.png` })

// 4) 清空搜索后按筛选
await input.fill('')
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
await page.locator('text="全部"').first().click()
await page.waitForTimeout(1000)
const allList = page.locator('main button.card-surface')
if (await allList.count() > 0) {
  await allList.first().click()
  await page.waitForTimeout(1600)
}
check('「全部」筛选下也能打开详情', (await page.locator('div.fixed.z-50').count()) > 0)

// 详情面板里是否有内容
const detailText = await page.evaluate(() => {
  const el = document.querySelector('div.fixed.z-50')
  return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 120) : ''
})
check('详情面板有内容', detailText.length > 10, detailText)

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `全部 ${results.length} 项通过` : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 8).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
