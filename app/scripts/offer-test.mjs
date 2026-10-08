/**
 * 验证「一组新词学完后可以选拼写这一组」。
 *
 * 用法: node scripts/offer-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-offer'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(() => localStorage.setItem('greek-welcomed', '1'))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

const S = () => page.locator('[data-testid=study]').innerText()
const input = () => page.locator('[data-testid=study] input[placeholder^="在此输入"]')
const idxOf = (t) => (t.match(/(\d+) \/ (\d+)/) || ['', '0', '0']).slice(1).map(Number)

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2200)
await page.locator('text="开始学习"').first().click()
await page.waitForTimeout(2500)

// 逐键推进，每次都重新判读界面（一题可能只需 1~2 次按键）
const learned = []
let offer = ''
let lastTotal = 0
for (let k = 0; k < 80; k++) {
  const t = await S()
  if (t.includes('个词学完了')) { offer = t; break }
  const idx = (t.match(/(\d+) \/ (\d+)/) || [])
  if (idx[2]) lastTotal = Number(idx[2])
  if (await input().count()) {
    await input().fill('λάθος')
    await page.keyboard.press('Enter')
  } else if (/显示答案/.test(t)) {
    await page.keyboard.press('Space')
  } else if (/1–4 选择/.test(t) && !/答对了|正确答案|再记一下/.test(t)) {
    // 尚未作答的选择题：题干是「这是新词，选出正确的释义」+ 单独一行的词形
    const g = (t.match(/选出正确的释义\s*([\u0370-\u03ff\u1f00-\u1fff][^\n]*)/) || ['', ''])[1]
    if (g) learned.push(g.trim().split(/\s+/)[0])
    await page.keyboard.press('1')
  } else {
    await page.keyboard.press('Enter')
  }
  await page.waitForTimeout(480)
}

check('学完一组后出现拼写岔路口', !!offer)
const listed = offer
  ? offer.split('\n').map((x) => x.trim()).filter((x) => /^[\u0370-\u03ff\u1f00-\u1fff]/.test(x))
      .map((x) => x.split(/\s+/)[0])
  : []
check('岔路口列出了这一组的词', listed.length === 5, listed.join(' '))
check('列出的正是刚学过的词', learned.length > 0 && learned.every((w) => listed.includes(w)),
  `学过 ${learned.join(' ')}`)

const beforeTotal = lastTotal
await page.screenshot({ path: `${outDir}/offer.png` })

// 选「拼写这一组」
await page.keyboard.press('1')
await page.waitForTimeout(1500)
const t2 = await S()
check('选择拼写后进入拼写题', /拼写/.test(t2))
const afterTotal = idxOf(t2)[1]
check('总题数增加了 5 道', afterTotal === beforeTotal + 5, `${beforeTotal} → ${afterTotal}`)

// 第一下 Enter 必须停留在本题并显示对错，第二下才继续
await input().fill('λάθος')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
const t3 = await S()
check('提交后停留在本题并给出对错', /答对了|正确答案|再记一下/.test(t3) && idxOf(t3)[0] === idxOf(t2)[0],
  `题号 ${idxOf(t3)[0]}`)
await page.screenshot({ path: `${outDir}/spell-feedback.png` })

await page.keyboard.press('Enter')
await page.waitForTimeout(800)
check('再按 Enter 才进入下一题', idxOf(await S())[0] === idxOf(t2)[0] + 1)

// 把插入的拼写题做完
let n = 1
for (let k = 0; k < 20; k++) {
  if (!(await input().count())) break
  await input().fill('λάθος')
  await page.keyboard.press('Enter'); await page.waitForTimeout(550)
  await page.keyboard.press('Enter'); await page.waitForTimeout(550)
  n++
}
check('插入的 5 道拼写题都能做完', n >= 5, `完成 ${n} 道`)
check('之后自动回到正常流程', !/个词学完了/.test(await S()))

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 6).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
