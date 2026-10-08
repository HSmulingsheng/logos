/**
 * 端到端冒烟测试：自动走完「新词学习 → 测试 → 复习」全流程，
 * 记录每种题型的出现次数、是否报错，并在每种题型首次出现时截图。
 *
 * 用法: node scripts/smoke.mjs <url> <outDir> [maxSteps]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url, outDir = '/tmp/greek-smoke', maxSteps = '80'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })

const errors = []
const autoLogs = []
// 用挂钩 Audio.play() 计数，而不是监听网络请求：
// 同一个词在「学习→测试」里会多次发音，第二次起走浏览器缓存，网络层面看不到请求。
await page.addInitScript(() => {
  window.__autoDebug = true
  window.__audioPlays = []
  window.__audioCreated = []
  window.__speaks = []
  const origPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...args) {
    try { window.__audioPlays.push({ src: this.src, t: Date.now() }) } catch { /* 忽略 */ }
    return origPlay.apply(this, args)
  }
  const OrigAudio = window.Audio
  window.Audio = function (src) {
    try { window.__audioCreated.push(src) } catch { /* 忽略 */ }
    return new OrigAudio(src)
  }
  window.Audio.prototype = OrigAudio.prototype
  if (window.speechSynthesis) {
    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis)
    window.speechSynthesis.speak = (u) => { try { window.__speaks.push(u?.text) } catch { /* 忽略 */ } return origSpeak(u) }
  }
})
const playCount = () => page.evaluate(() => (window.__audioPlays || []).length).catch(() => 0)
page.on('console', (m) => {
  const t = m.text()
  if (t.startsWith('[auto]')) autoLogs.push(`${Date.now() % 100000} ${t}`)
  if (m.type() === 'error') errors.push(`[console] ${t}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2000)

// 首次访问会弹「游客模式」说明，先关掉再操作
await page.locator('text="开始使用"').click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(500)


// 首页 -> 开始学习
if (await page.locator('text=开始学习').count()) {
  await page.locator('text=开始学习').first().click()
  await page.waitForTimeout(1200)
} else {
  console.log('⚠️ 首页没有「开始学习」（今日任务可能已完成），仍尝试进入学习页')
}

const seen = {}
const log = []
const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

// 进入学习后先确认「单词出现即自动发音」
await page.waitForTimeout(1200)
const autoCount = await playCount()
check('新词出现时自动发音', autoCount > 0, `窗口内已触发 ${autoCount} 次播放`)
await page.keyboard.press('r')
await page.waitForTimeout(800)
check('按 R 可重放发音', (await playCount()) > autoCount, `累计 ${await playCount()} 次播放`)
async function headerKind() {
  const t = await page.locator('[data-testid=study] header').first().innerText().catch(() => '')
  return t.replace(/\s+/g, ' ').trim()
}

for (let i = 0; i < Number(maxSteps); i++) {
  await page.waitForTimeout(320)
  // 「一组新词学完」的岔路口要先处理：它没有 <header>，也不是已知题型，
  // 不先跳过的话循环会直接结束。岔路口本身由 offer-test.mjs 专门覆盖。
  if (await page.locator('[data-testid=study] >> text=拼写这一组').count()) {
    await page.keyboard.press('2')
    await page.waitForTimeout(900)
    continue
  }
  const head = await headerKind()
  if (!head) break
  const kind = ['新词学习', '复习', '选义', '拼写', '听音辨词', '回想'].find((k) => head.includes(k))
  if (!kind) break
  seen[kind] = (seen[kind] ?? 0) + 1
  log.push(`${i + 1}. ${head.slice(0, 40)}`)

  if (!seen[`shot:${kind}`]) {
    seen[`shot:${kind}`] = 1
    await page.screenshot({ path: `${outDir}/${kind}.png` })
  }

  // 自动发音的正确性由应用内部的 [auto] 日志核对（见末尾的 schedule→FIRE 不变式检查）
    // ---- 选择题（新词四选一 / 选义 / 听音）：点第一个选项，再按 Enter 继续
  const opts = page.locator('[data-testid=study] .grid button')
  if ((await opts.count()) > 0 && !(await page.locator('[data-testid=study] >> text=显示答案').count())) {
    // 第一次遇到选择题走键盘路径，验证 1-4 快捷键真的能用
    if (!seen['kbd:choice']) {
      seen['kbd:choice'] = 1
      await page.keyboard.press('1')
      await page.waitForTimeout(700)
      const picked = await page.locator('[data-testid=study] button[disabled]').count()
      if (picked === 0) { console.log('⚠️ 按 1 后选项没有进入已作答状态'); seen['FAIL:kbd-choice'] = 1 }
      // 顺便验证 R 重放发音不会报错
      await page.keyboard.press('r')
      await page.waitForTimeout(300)
    } else {
      await opts.first().click()
    }
    await page.waitForTimeout(900)
    if (!seen[`shot:${kind}-revealed`]) {
      seen[`shot:${kind}-revealed`] = 1
      await page.screenshot({ path: `${outDir}/${kind}-revealed.png` })
    }
    await page.keyboard.press('Enter')   // 用键盘继续，顺带验证快捷键
    await page.waitForTimeout(900)
    continue
  }

  // ---- 复习：翻卡后四档自评（用数字键，顺带验证快捷键）
  const revealBtn = page.locator('[data-testid=study] >> text=显示答案')
  if (await revealBtn.count()) {
    await revealBtn.first().click()
    await page.waitForTimeout(600)
    if (!seen[`shot:${kind}-revealed`]) {
      seen[`shot:${kind}-revealed`] = 1
      await page.screenshot({ path: `${outDir}/${kind}-revealed.png` })
    }
    await page.keyboard.press('3')       // 3 = 记得
    await page.waitForTimeout(700)
    continue
  }

  // ---- 拼写题：先故意答错，验证判分与反馈
  const input = page.locator('[data-testid=study] input[placeholder^="在此输入"]')
  if (await input.count()) {
    await input.fill('λόγος')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1400)
    if (!seen[`shot:${kind}-revealed`]) {
      seen[`shot:${kind}-revealed`] = 1
      await page.screenshot({ path: `${outDir}/${kind}-revealed.png` })
    }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    continue
  }
  break
}

await page.screenshot({ path: `${outDir}/end.png` })

console.log('=== 题型出现次数 ===')
for (const [k, v] of Object.entries(seen)) if (!k.startsWith('shot:')) console.log(`  ${k}: ${v}`)
console.log('=== 步骤轨迹（前 30） ===')
console.log(log.slice(0, 30).join('\n'))
// 不变式：每次 schedule 后必须有一次 FIRE，且中间不能被 cleanup 掐掉
// （这正是「单词出现不出声、按 R 才出声」那个 bug 的形态）
const seq = autoLogs.map((l) => {
  const m = l.match(/\[auto\] (\w+) (\S+)/)
  return m ? { tag: m[1], key: m[2] } : null
}).filter(Boolean)
// FIRE 记录形如 "wordId:kind:cursor#actualWordId"，两者必须一致，否则就是「用旧词发音」
const fired = new Set()
const wrongWord = []
let cancelled = []
let pending = null
for (const e of seq) {
  if (e.tag === 'schedule') pending = e.key
  else if (e.tag === 'FIRE') {
    const [key, actual] = e.key.split('#')
    fired.add(key)
    const expect = key.split(':')[0]
    if (actual && actual !== expect) wrongWord.push(`${key} 实际发音=${actual}`)
    if (pending === key || pending === e.key) pending = null
  }
  else if (e.tag === 'cleanup' && pending === e.key) { cancelled.push(e.key); pending = null }
}
const stepsSeen = log.length
console.log('=== 自动发音检查（schedule→FIRE 不变式）===')
console.log(`  schedule ${seq.filter((e) => e.tag === 'schedule').length} 次 · FIRE ${seq.filter((e) => e.tag === 'FIRE').length} 次 · 被取消 ${cancelled.length} 次`)
check('每次排定的自动发音都真正播放了', cancelled.length === 0,
  cancelled.length ? `被 cleanup 掐掉 ${cancelled.length} 次：${cancelled.slice(0, 5).join('、')}` : '')
check('每个步骤都触发了自动发音', fired.size >= stepsSeen - 1,
  `覆盖 ${fired.size} / ${stepsSeen} 步`)
check('自动发音用的都是当前词（没有拿上一个词顶替）', wrongWord.length === 0,
  wrongWord.length ? `${wrongWord.length} 处用错词：${wrongWord.slice(0, 3).join('、')}` : '')
console.log('=== 功能检查 ===')
const failedChecks = checks.filter((c) => !c.ok)
console.log(failedChecks.length === 0 ? `全部 ${checks.length} 项通过` : `${failedChecks.length}/${checks.length} 项失败：${failedChecks.map((c) => c.name).join('、')}`)
console.log('=== 页面问题 ===')
console.log(errors.length ? [...new Set(errors)].slice(0, 20).join('\n') : '无')
console.log('截图目录:', outDir)

await browser.close()
