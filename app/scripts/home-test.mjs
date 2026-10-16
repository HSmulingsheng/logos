/**
 * 单词板块首页验收。
 *
 * 覆盖四件事：
 *   1. 「开始学习 / 开始复习」两个按钮存在，底色分别与新词/复习标识同色，文字居中
 *   2. 有到期复习时，点「开始学习」会弹出「还有 N 个词没复习」岔路口
 *   3. 没有到期复习时不弹窗（直接开始）
 *   4. 弹窗两个选项确实分别跳进复习 / 新词会话
 *
 * 用法: node scripts/home-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-home'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

// 标识色：新词 = laurel-500，复习 = aegean-500（见 tailwind.config.js）
const LAUREL = 'rgb(61, 167, 92)'
const AEGEAN = 'rgb(6, 163, 240)'

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] })

/** 造几张「已到期」的卡片，让首页出现待复习 */
async function seedDue(page, n = 3) {
  await page.evaluate(async (count) => {
    const req = indexedDB.open('greek-vocab', 1)
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const tx = db.transaction('cards', 'readwrite')
    const st = tx.objectStore('cards')
    const ids = [1634921079368, 1634921079369, 1634921079370, 1634921079371, 1634921079372]
    for (const id of ids.slice(0, count)) {
      st.put({ id, lesson: 1, due: Date.now() - 60000, stability: 5, difficulty: 5, elapsed_days: 1,
        scheduled_days: 1, learning_steps: 0, reps: 3, lapses: 0, state: 2,
        introduced: Date.now() - 86400000, ms: 0 })
    }
    await new Promise((res) => { tx.oncomplete = () => res() })
    db.close()
  }, n)
}

/**
 * 读首页那两个按钮。
 *
 * ⚠️ 线上加载慢（词表索引 1.4MB + Service Worker 安装），固定等待经常不够——
 * 之前线上跑出「两个按钮都在」失败，但同一轮的弹窗断言全过，说明按钮其实是有的，
 * 只是读得太早。所以这里**轮询到出现为止**。
 */
const buttons = async (page) => {
  for (let i = 0; i < 40; i++) {
    const r = await rawButtons(page)
    if (r.length >= 2) return r
    await page.waitForTimeout(400)
  }
  return rawButtons(page)
}
const rawButtons = (page) => page.evaluate(() => [...document.querySelectorAll('button')]
  .filter((b) => /^(开始学习|开始复习)$/.test((b.textContent || '').trim()))
  .map((b) => ({
    t: (b.textContent || '').trim(),
    bg: getComputedStyle(b).backgroundColor,
    just: getComputedStyle(b).justifyContent,
    disabled: b.disabled,
  })))

// ---------------------------------------------------------------- 场景 A：有到期复习
console.log('▶ 场景 A：有 3 个词待复习')
{
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  // 场景 A 是第一个跑的：线上首访要装 Service Worker 并拉 1.4MB 词表索引，
  // 比后面几个场景慢得多。先等应用真正就绪，再种数据、再重载。
  await page.waitForTimeout(2500)
  await buttons(page)
  await seedDue(page, 3)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2600)

  const bs = await buttons(page)
  const learn = bs.find((b) => b.t === '开始学习')
  const review = bs.find((b) => b.t === '开始复习')
  check('两个按钮都在', !!learn && !!review, bs.map((b) => b.t).join(' / '))
  check('开始学习用「新词」标识色（laurel-500）', learn?.bg === LAUREL, `${learn?.bg}（期望 ${LAUREL}）`)
  check('开始复习用「复习」标识色（aegean-500）', review?.bg === AEGEAN, `${review?.bg}（期望 ${AEGEAN}）`)
  check('两个按钮文字居中', learn?.just === 'center' && review?.just === 'center', `${learn?.just} / ${review?.just}`)
  check('待复习时「开始复习」可点', review?.disabled === false)
  await page.screenshot({ path: join(outDir, 'home-buttons.png') })

  // 点「开始学习」→ 弹窗
  await page.locator('button:has-text("开始学习")').first().click()
  await page.waitForTimeout(900)
  const dlg = await page.locator('body').innerText()
  const m = dlg.match(/还有 (\d+) 个词没复习/)
  check('弹出未复习提醒', !!m, m ? m[0] : '没弹窗')
  check('提醒数量正确', m?.[1] === '3', `显示 ${m?.[1]}`)
  check('给出两个选项', /先复习/.test(dlg) && /继续学新词/.test(dlg))
  // 选项配色与首页一致：先复习=蓝、继续学新词=绿
  const optColors = await page.evaluate(() => {
    const find = (t) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(t))
    return { rev: find('先复习') ? getComputedStyle(find('先复习')).backgroundColor : '',
             nw: find('继续学新词') ? getComputedStyle(find('继续学新词')).backgroundColor : '' }
  })
  check('弹窗选项配色一致', optColors.rev === AEGEAN && optColors.nw === LAUREL,
    `先复习 ${optColors.rev} / 继续学新词 ${optColors.nw}`)
  await page.screenshot({ path: join(outDir, 'home-dialog.png') })

  // 选「先复习」→ 进入复习会话
  await page.locator('button:has-text("先复习")').first().click()
  await page.waitForTimeout(3000)
  const study = await page.locator('[data-testid=study]').innerText().catch(() => '')
  check('「先复习」进入复习会话', study.includes('复习'), study ? study.split('\n').slice(0, 2).join(' / ') : '未进入学习界面')
  await page.screenshot({ path: join(outDir, 'home-review.png') })
  check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// ---------------------------------------------------------------- 场景 B：没有到期复习
console.log('\n▶ 场景 B：没有到期复习（全新用户）')
{
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
  await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2600)

  const bs = await buttons(page)
  const learn = bs.find((b) => b.t === '开始学习')
  const review = bs.find((b) => b.t === '开始复习')
  check('「开始复习」在无待复习时禁用', review?.disabled === true)
  check('「开始学习」仍可点', learn?.disabled === false)

  await page.locator('button:has-text("开始学习")').first().click()
  await page.waitForTimeout(3000)
  const body = await page.locator('body').innerText()
  check('无待复习时不弹窗，直接开始', !/还有 \d+ 个词没复习/.test(body))
  const study = await page.locator('[data-testid=study]').innerText().catch(() => '')
  check('进入新词会话', /新词|学习/.test(study), study ? study.split('\n').slice(0, 2).join(' / ') : '未进入学习界面')
  await page.screenshot({ path: join(outDir, 'home-nodialog.png') })
  await page.close()
}

// ---------------------------------------------------------------- 场景 C：一直点「开始复习」
console.log('\n▶ 场景 C：直接点「开始复习」')
{
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
  await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2200)
  await seedDue(page, 2)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2600)

  await page.locator('button:has-text("开始复习")').first().click()
  await page.waitForTimeout(3000)
  const body = await page.locator('body').innerText()
  check('「开始复习」不弹岔路口直接进', !/还有 \d+ 个词没复习/.test(body))
  const study = await page.locator('[data-testid=study]').innerText().catch(() => '')
  check('进入复习会话', study.includes('复习'), study ? study.split('\n').slice(0, 2).join(' / ') : '未进入学习界面')
  await page.close()
}

await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
