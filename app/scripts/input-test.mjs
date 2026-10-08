/**
 * 拉丁键盘输入 → 希腊语转写验收。
 *
 * 校验：逐字符打字能正确合成双字母与变音符号（这正是「即时转写」最容易错的地方，
 * 因为 t 会先变成 τ，之后 h 就拼不回 θ 了）。
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-input'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(() => localStorage.setItem('greek-welcomed', '1'))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 })
await page.waitForTimeout(2200)

// 走到拼写步骤：用键盘逐题推进（与 offer-test 相同、已跑通的流程）
const input = () => page.locator('[data-testid=study] input[placeholder^="在此输入"]')
const S = () => page.locator('[data-testid=study]').innerText()

await page.locator('main button:has-text("开始学习")').first().click()
await page.waitForTimeout(2500)

let clicked = false
for (let k = 0; k < 90 && !clicked; k++) {
  const t = await S()
  if (t.includes('这一组')) {
    // 岔路口：选「拼写这一组」，然后**立刻跳出循环**，
    // 否则下一轮会把刚插入的拼写题也自动填掉，就测不到了
    const offer = page.locator('[data-testid=study] button').filter({ hasText: /拼写/ })
    if (await offer.count()) {
      await offer.first().click()
      clicked = true
      break
    }
  }
  if (await input().count()) { await input().fill('λάθος'); await page.keyboard.press('Enter') }
  else if (/显示答案/.test(t)) await page.keyboard.press('Space')
  else if (/1–4 选择/.test(t) && !/答对了|正确答案|再记一下/.test(t)) await page.keyboard.press('1')
  else await page.keyboard.press('Enter')
  await page.waitForTimeout(480)
}

// 等拼写输入框出现（中间可能还夹着别的题型）
for (let k = 0; k < 40; k++) {
  if (await input().count()) break
  const t = await S()
  if (/1–4 选择/.test(t) && !/答对了|正确答案|再记一下/.test(t)) await page.keyboard.press('1')
  else await page.keyboard.press('Enter')
  await page.waitForTimeout(450)
}

check('到达拼写输入步骤', (await input().count()) > 0)
if (!(await input().count())) console.log('   最后界面:', (await S()).replace(/\n+/g,' | ').slice(0,200))
if (!(await input().count())) { await browser.close(); process.exit(1) }
await page.screenshot({ path: `${outDir}/input-empty.png` })

// 逐字符打字，验证转写
const box = input().first()
await box.click()
const typing = [
  ['l', 'λ'], ['o', 'λο'], ['g', 'λογ'], ['o', 'λογο'], ['s', 'λογος'],
]
let typedOk = true
for (const [key, want] of typing) {
  await box.type(key, { delay: 40 })
  await page.waitForTimeout(180)
  const got = await box.inputValue()
  if (got !== want) { typedOk = false; console.log(`   打 ${key} 后应为 ${want}，实际 ${got}`) }
}
check('逐字符打字正确转写', typedOk, `logos → ${await box.inputValue()}`)

// 双字母：清空后打 th / ch / ps
await box.fill('')
for (const key of 'theos') await box.type(key, { delay: 60 })
await page.waitForTimeout(300)
check('双字母 th → θ', (await box.inputValue()).startsWith('θε'), await box.inputValue())

await box.fill('')
for (const key of 'psyche') await box.type(key, { delay: 60 })
await page.waitForTimeout(300)
check('双字母 ps → ψ', (await box.inputValue()).startsWith('ψ'), await box.inputValue())

// 数字变音符号
await box.fill('')
for (const key of 'logos1') await box.type(key, { delay: 60 })
await page.waitForTimeout(300)
check('数字 1 → 重音', (await box.inputValue()) === 'λογός', await box.inputValue())

await box.fill('')
for (const key of 'hēme1ra') await box.type(key, { delay: 60 })
await page.waitForTimeout(300)
const hemera = await box.inputValue()
check('h+长音符+数字', hemera === 'ἡμέρα', hemera)

// 词首元音自动柔气号
await box.fill('')
for (const key of 'anthropos') await box.type(key, { delay: 50 })
await page.waitForTimeout(300)
// 注意：o→ο、ō→ω，所以 anthropos 得到 ἀνθροπος 才对（要 ω 得打 anthrōpos）
check('词首元音自动柔气号', (await box.inputValue()) === 'ἀνθροπος', await box.inputValue())

// 退格
await box.fill('')
await box.type('logos', { delay: 50 })
await page.waitForTimeout(250)
await page.keyboard.press('Backspace')
await page.waitForTimeout(250)
check('退格可删除', (await box.inputValue()) === 'λογο', await box.inputValue())

await page.screenshot({ path: `${outDir}/input-typed.png` })

// 提交后判分（忽略变音符号）
await box.fill('')
for (const key of 'x') await box.type(key, { delay: 40 })
await page.keyboard.press('Enter')
await page.waitForTimeout(900)
const after = await page.locator('[data-testid=study]').innerText()
check('可用拉丁输入提交并判分', !/在此输入/.test(after) || /正确答案|拼写/.test(after))

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 5).join('\n')}` : '无控制台错误')

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
