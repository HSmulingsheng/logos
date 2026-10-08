/**
 * 离线可用性验证（端到端）：
 *   1. 在线加载 → 等待 Service Worker 装好并完成安装期预缓存
 *   2. 在「我的」里点「缓存全部词表与发音」，把 30 课词表 + 新约全文 + 全部音频写入本地
 *   3. 切断网络 → 重新加载 → 检查渲染、学习流程、释义/例句、音频、检索索引
 *
 * 用法: node scripts/offline-test.mjs <url> [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url, outDir = '/tmp/greek-offline'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const page = await context.newPage()

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
const badResponses = []
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`) })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

// ---------------------------------------------------------------- 1
console.log('▶ 1. 在线加载并安装 Service Worker')
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2000)

// 首次访问会弹「游客模式」说明，先关掉再操作
await page.locator('text="开始使用"').click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(500)


const swState = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  return reg.active ? 'active' : 'registered'
})
check('Service Worker 已激活', swState === 'active', swState)

const precache = await page.evaluate(async () => {
  const res = await fetch('./precache-manifest.json').catch(() => null)
  if (!res || !res.ok) return { total: 0, missing: -1 }
  const { files } = await res.json()
  const cache = await caches.open((await caches.keys()).find((k) => k.startsWith('greek-vocab-')) || 'x')
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname))
  const missing = files.filter((f) => !have.has(new URL(f, location.href).pathname))
  return { total: files.length, missing: missing.length }
})
check('安装期预缓存完成', precache.missing === 0, `共 ${precache.total} 个文件`)

// ---------------------------------------------------------------- 2
console.log('\n▶ 2. 在「我的」里缓存全部离线资源')
await page.locator('nav >> text="我的"').click()
await page.waitForTimeout(600)
await page.locator('text="设置"').first().click()   // 我的默认停在「学习统计」，切到设置
await page.waitForTimeout(800)
const startBtn = page.locator('button', { hasText: /^(开始|继续)$/ })
if (await startBtn.count()) {
  await startBtn.first().click()
  const deadline = Date.now() + 300000
  let done = false
  while (Date.now() < deadline) {
    await page.waitForTimeout(2500)
    if ((await page.locator('text=/^完成：/').count().catch(() => 0)) > 0) { done = true; break }
    if ((await page.locator('text=/^已中断/').count().catch(() => 0)) > 0) break
  }
  const summary = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /^(完成|已中断|下载中)：?/.test(d.textContent || ''))
    return el ? (el.textContent || '').trim().slice(0, 120) : '(未读到进度文本)'
  })
  check('离线资源缓存完成', done, summary)
  await page.screenshot({ path: `${outDir}/offline-settings.png` })
} else {
  check('离线资源缓存完成', false, '找不到「开始」按钮')
}

const cached = await page.evaluate(async () => {
  const name = (await caches.keys()).find((k) => k.startsWith('greek-vocab-'))
  const cache = await caches.open(name)
  const keys = await cache.keys()
  const audio = keys.filter((r) => r.url.includes('/audio/') || r.url.includes('/audio-tts/')).length
  return { name, total: keys.length, audio }
})
console.log(`   缓存库 ${cached.name}：${cached.total} 条目，其中音频 ${cached.audio}`)
check('音频已写入缓存', cached.audio > 3000, `${cached.audio} 个`)

// ---------------------------------------------------------------- 3
console.log('\n▶ 3. 切断网络后重新加载')
await context.setOffline(true)
let reloadOk = true
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
} catch (e) {
  reloadOk = false
  check('离线重新加载', false, e.message.split('\n')[0])
}
if (reloadOk) {
  await page.waitForTimeout(2500)
  check('离线重新加载后应用已渲染', (await page.locator('text=今日任务').count()) > 0)
  await page.screenshot({ path: `${outDir}/offline-home.png` })
}

// ---------------------------------------------------------------- 4
console.log('\n▶ 4. 断网状态下走学习流程')
try {
  await page.locator('text=开始学习').first().click({ timeout: 10000 })
  await page.waitForTimeout(2500)
  const kind = await page.locator('[data-testid=study] header').first().innerText()
  check('离线可进入学习页', /新词学习|复习|选义|拼写|听音辨词/.test(kind), kind.replace(/\s+/g, ' ').trim())

  // 新词已是四选一：用键盘 1 作答，再检查详情（中英释义 + 例句）是否离线可读
  const reveal = page.locator('[data-testid=study] >> text=显示答案')
  if (await reveal.count()) {
    await reveal.first().click()
    await page.waitForTimeout(600)
    await page.keyboard.press('3')
    await page.waitForTimeout(800)
  } else {
    await page.keyboard.press('1')
    await page.waitForTimeout(1200)
  }
  const detail = await page.evaluate(() => {
    const t = document.querySelector('[data-testid=study]')?.textContent || ''
    return {
      zh: t.includes('中文释义'),
      en: t.includes('英文释义'),
      ex: t.includes('真实语料例句') || t.includes('语料例句'),
    }
  })
  check('离线可读到中英释义与例句', detail.zh && detail.en && detail.ex, JSON.stringify(detail))
  await page.screenshot({ path: `${outDir}/offline-study.png` })

  const audioOk = await page.evaluate(async () => {
    for (const id of ['3588g.mp3', '2532g.mp3']) {
      try {
        const r = await fetch('./audio/' + id)
        if (r.ok && (await r.arrayBuffer()).byteLength > 1000) return true
      } catch { /* 试下一个 */ }
    }
    return false
  })
  check('离线可读取音频', audioOk)

  const indexOk = await page.evaluate(async () => {
    try {
      const r = await fetch('./data/index.json')
      return r.ok && (await r.json()).length > 10000
    } catch { return false }
  })
  check('离线可读取检索索引', indexOk)

  const lessonOk = await page.evaluate(async () => {
    try {
      const r = await fetch('./data/lesson-20.json')
      return r.ok && (await r.json()).words.length > 100
    } catch { return false }
  })
  check('离线可读取后期课程词表', lessonOk)
} catch (e) {
  check('离线学习流程', false, e.message.split('\n')[0])
}

await context.setOffline(false)
await page.screenshot({ path: `${outDir}/offline-end.png` })

console.log('\n=== 结果 ===')
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0
  ? `全部 ${results.length} 项通过`
  : `${failed.length}/${results.length} 项失败：${failed.map((f) => f.name).join('、')}`)
console.log(errors.length ? `页面错误：\n${[...new Set(errors)].slice(0, 12).join('\n')}` : '无控制台错误')
if (badResponses.length) {
  console.log('失败请求：')
  for (const b of [...new Set(badResponses)].slice(0, 10)) console.log('  ' + b)
}

await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
