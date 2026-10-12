/**
 * 阅读板块四个体裁的一致性验收。
 *
 * 目标是「哲学/文学/历史 与 宗教 在字号、查词、译文切换、视觉上统一」。
 * 逐个体裁进入实际阅读界面，量出真实样式值，而不是只看代码。
 *
 * 用法: node scripts/reading-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-reading'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2500)

// 进入「学习 → 阅读」。
// ⚠️ 别用 has-text("学习") 去点底部 tab —— 首页的「开始学习」按钮也含这两个字，
//    用 .first() 会点到它并弹出学习浮层，把后续点击全挡住。
await page.locator('button', { hasText: /^阅读$/ }).first().click()
await page.waitForTimeout(1200)

/** 量出正文段落的字号与可点词数 */
const probe = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('p.greek')].filter((p) => (p.textContent || '').trim().length > 20)
  const p = ps[0]
  if (!p) return null
  const cs = getComputedStyle(p)
  return {
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    wordButtons: [...p.querySelectorAll('button')].length,
    text: (p.textContent || '').slice(0, 40),
  }
})

const GENRES = [
  { tab: '宗教', name: '宗教（新约）', open: async () => {
      await page.locator('button:has-text("开始读新约"), button:has-text("继续")').first().click()
    } },
  { tab: '哲学', name: '哲学', open: async () => {
      await page.locator('button:has-text("柏拉图"), button:has-text("亚里士多德"), button:has-text("爱比克泰德")').first().click()
      await page.waitForTimeout(900)
      await page.locator('button:has-text("第"), button:has-text("卷"), button:has-text("全文")').first().click()
    } },
  { tab: '文学', name: '文学', open: async () => {
      await page.locator('button:has-text("荷马"), button:has-text("索福克勒斯"), button:has-text("欧里庇得斯")').first().click()
      await page.waitForTimeout(900)
      await page.locator('button:has-text("卷"), button:has-text("第"), button:has-text("全文")').first().click()
    } },
  { tab: '历史', name: '历史', open: async () => {
      await page.locator('button:has-text("希罗多德"), button:has-text("修昔底德"), button:has-text("色诺芬")').first().click()
      await page.waitForTimeout(900)
      await page.locator('button:has-text("卷"), button:has-text("第"), button:has-text("全文")').first().click()
    } },
]

const measured = []
for (const g of GENRES) {
  console.log(`\n▶ ${g.name}`)
  // 每换一个体裁就重新加载：宗教走的是全屏浮层，返回按钮只有一个图标没有文字，
  // 靠点按钮退出去很脆；重新加载状态最干净。
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2200)
  await page.locator('button', { hasText: /^阅读$/ }).first().click()
  await page.waitForTimeout(1000)
  try {
    await page.locator('button', { hasText: new RegExp(`^${g.tab}$`) }).first().click()
    await page.waitForTimeout(1200)
    await g.open()
    await page.waitForTimeout(3000)
  } catch (e) {
    check(`${g.name} 能进入正文`, false, String(e).split('\n')[0].slice(0, 70))
    continue
  }
  const r = await probe()
  if (!r) { check(`${g.name} 能进入正文`, false, '没找到 greek 段落'); continue }
  console.log(`   字号 ${r.fontSize} · 行高 ${r.lineHeight} · 可点词 ${r.wordButtons} · 「${r.text}…」`)
  measured.push({ g, r })
  await page.screenshot({ path: join(outDir, `reading-${g.tab}.png`) })
}

console.log('\n▶ 一致性断言')
check('四个体裁都进入了正文', measured.length === 4, `${measured.length}/4`)
if (measured.length) {
  const sizes = [...new Set(measured.map((m) => m.r.fontSize))]
  check('正文字号完全一致', sizes.length === 1, sizes.join(' / '))
  const lhs = [...new Set(measured.map((m) => m.r.lineHeight))]
  check('行高完全一致', lhs.length === 1, lhs.join(' / '))
  const noWord = measured.filter((m) => m.r.wordButtons === 0).map((m) => m.g.name)
  check('四个体裁都能逐词点查', noWord.length === 0, noWord.length ? '点不了的: ' + noWord.join('、') : '全部可点')
  check('字号是 19px（与宗教一致）', sizes[0] === '19px', sizes[0] || '?')
}

// 中/英切换开关
const toggles = await page.evaluate(() => [...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim()).filter((t) => ['中', '英', '隐藏', '译文'].includes(t)))
console.log(`  译文开关: ${toggles.join(' / ') || '（无）'}`)

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
console.log(`\n=== 结果 ===\n${fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`}`)
process.exit(fail === 0 ? 0 : 1)
