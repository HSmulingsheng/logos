/**
 * AI 翻译（自带 Key）验收。
 *
 * 不依赖真实 Key：用 route 拦截模拟服务商返回，
 * 但**请求本身是真的**——所以能验证 URL、鉴权头、提示词内容、JSON 解析、
 * 渲染、以及缓存是否生效。
 *
 * 用法: node scripts/ai-translate-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-ai'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

/** 学习 → 阅读 → 历史。用 text-is 精确匹配：`has-text("学习")` 会命中「开始学习」 */
async function goReading(p) {
  // 限定在 <nav> 内，避免 "学习" 命中「开始学习」
  await p.locator('nav button:has-text("学习")').first().click()
  await p.waitForTimeout(1000)
  await p.locator('main button:has-text("阅读")').first().click()
  await p.waitForTimeout(1300)
  await p.locator('main button:has-text("历史")').first().click()
  await p.waitForTimeout(1300)
}

const browser = await chromium.launch({
  executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

// ---------------------------------------------------------------- 模拟服务商
const requests = []
/** 由测试切换：'ok' 正常返回，其余模拟各类失败 */
let mockMode = 'ok'
await page.route('**/chat/completions', async (route) => {
  if (mockMode === 'badkey') {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid api key' } }) })
  }
  if (mockMode === 'ratelimit') {
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limited' } }) })
  }
  if (mockMode === 'garbage') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '抱歉，我不能…' } }] }) })
  }
  const req = route.request()
  let texts = []
  try {
    const body = JSON.parse(req.postData() || '{}')
    const user = body.messages?.find((m) => m.role === 'user')?.content || ''
    // 提示词正文里也有 {"zh": [...]}，所以不能找第一个 '['——
    // 要取最后一行（就是待翻译的 JSON 数组）
    texts = JSON.parse(user.slice(user.lastIndexOf('\n') + 1))
  } catch { /* 保底 */ }
  requests.push({
    url: req.url(),
    auth: req.headers()['authorization'] || '',
    model: (() => { try { return JSON.parse(req.postData()).model } catch { return '' } })(),
    system: (() => { try { return JSON.parse(req.postData()).messages?.[0]?.content || '' } catch { return '' } })(),
    n: texts.length,
    first: texts[0] || '',
  })
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ zh: texts.map((t, i) => `【模拟译文${i + 1}】${String(t).slice(0, 8)}`) }) } }],
    }),
  })
})

// ---------------------------------------------------------------- 预置设置
await page.addInitScript(() => {
  localStorage.setItem('greek-welcomed-v2', '1')
})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2500)
await page.evaluate(async () => {
  const req = indexedDB.open('greek-vocab', 1)
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const cur = await new Promise((res) => {
    const t = db.transaction('kv', 'readonly').objectStore('kv').get('settings')
    t.onsuccess = () => res(t.result || {})
  })
  const next = { ...cur, aiProvider: 'deepseek', aiKey: 'sk-test-key-123', aiModel: '', aiBaseUrl: '' }
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put(next, 'settings')
  await new Promise((res) => { tx.oncomplete = () => res() })
  db.close()
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2800)

// ---------------------------------------------------------------- 进入古典阅读
console.log('▶ 进入 学习 → 阅读 → 历史')
await goReading(page)
const listText = await page.locator('body').innerText()
check('历史体裁下有作品', /修昔底德|希罗多德|波利比奥斯/.test(listText), (listText.match(/修昔底德|希罗多德|波利比奥斯/) || [''])[0])
await page.locator('button:has-text("修昔底德")').first().click()
await page.waitForTimeout(1500)
await page.locator('main button:has-text("1")').first().click()
await page.waitForTimeout(2000)
await page.screenshot({ path: join(outDir, 'chapter.png') })

// ---------------------------------------------------------------- 翻译按钮
const btn = page.locator('button:has-text("AI 翻译本章")').first()
const hasBtn = await btn.count()
check('出现「AI 翻译本章」按钮', hasBtn > 0, hasBtn ? (await btn.innerText()).trim() : '没有')
if (!hasBtn) {
  console.log('\n后续断言跳过'); await browser.close()
  console.log(`\n=== 结果 ===\n${fail}/${pass + fail} 项失败`); process.exit(1)
}

console.log('\n▶ 点击翻译')
await btn.click()
// 大章节会分多次请求，等到按钮文案不再是「翻译中」
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(700)
  const t = await btn.innerText().catch(() => '')
  if (!/翻译中/.test(t)) break
}
await page.waitForTimeout(1200)

// ---------------------------------------------------------------- 断言
console.log('\n▶ 请求断言')
check('发生了网络请求', requests.length > 0, `${requests.length} 次`)
const r0 = requests[0]
check('请求地址指向 DeepSeek', r0?.url.startsWith('https://api.deepseek.com/v1/chat/completions'), r0?.url)
check('带上了 Bearer 鉴权头', r0?.auth === 'Bearer sk-test-key-123', r0?.auth ? '已带' : '未带')
check('模型名用了默认值', r0?.model === 'deepseek-chat', r0?.model)
check('系统提示词说明了古希腊语→中文', /古希腊语/.test(r0?.system || '') && /中文/.test(r0?.system || ''))
// 不断言具体是哪位作者——作品列表顺序会变；只要求确实是古希腊语
check('提示词里带了真实希腊语原文', /[\u0370-\u03ff\u1f00-\u1fff]{3,}/.test(r0?.first || ''), (r0?.first || '').slice(0, 34))
check('按每批 ≤8 段切分', requests.every((r) => r.n <= 8), `最大 ${Math.max(...requests.map((r) => r.n))} 段/次`)

const bodyText = await page.locator('body').innerText()
check('译文渲染出来了', /【模拟译文1】/.test(bodyText))
check('标了「AI」来源标记', (await page.locator('text=AI').count()) > 0)
check('翻译完成后按钮状态复位', !/翻译中/.test(await btn.innerText().catch(() => '')))
await page.screenshot({ path: join(outDir, 'translated.png') })

// ---------------------------------------------------------------- 缓存
console.log('\n▶ 缓存验证：刷新后不该重复请求')
const before = requests.length
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
await goReading(page)
await page.locator('button:has-text("修昔底德")').first().click(); await page.waitForTimeout(1500)
await page.locator('main button:has-text("1")').first().click(); await page.waitForTimeout(3500)
const after = requests.length
const t2 = await page.locator('body').innerText()
check('刷新后译文仍在（读自本机缓存）', /【模拟译文1】/.test(t2))
check('刷新后没有重新请求', after === before, `${before} → ${after} 次`)

// ---------------------------------------------------------------- 错误路径
// 用户一定会遇到 Key 填错、限流、模型乱输出，这里逐条验证提示是否可操作。
console.log('\n▶ 错误路径')
const page2 = await browser.newPage({ viewport: { width: 430, height: 932 } })
let mockMode2 = 'badkey'   // 必须在 route 注册前声明，否则处理器里是 TDZ 错误
page2.on('pageerror', (e) => errors.push('p2: ' + e.message))
await page2.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
await page2.route('**/chat/completions', (route) => {
  const map = {
    badkey: { status: 401, body: { error: { message: 'invalid api key' } } },
    ratelimit: { status: 429, body: { error: { message: 'rate limited' } } },
    garbage: { status: 200, body: { choices: [{ message: { content: '抱歉，我不能…' } }] } },
  }
  const m = map[mockMode2] || map.badkey
  return route.fulfill({ status: m.status, contentType: 'application/json', body: JSON.stringify(m.body) })
})
async function tryTranslate() {
  // 每轮都重载：上一轮停在阅读器里，体裁切换条已经不可见了
  await page2.reload({ waitUntil: 'domcontentloaded' })
  await page2.waitForTimeout(2600)
  try { await goReading(page2) } catch (e) {
    const t = await page2.locator('body').innerText().catch(() => '(取不到)')
    console.log('   ⚠️ 导航失败，当前页面：', t.replace(/\n+/g, ' | ').slice(0, 140))
    throw e
  }
  await page2.locator('main button:has-text("修昔底德")').first().click()
  await page2.waitForTimeout(1500)
  await page2.locator('main button:has-text("1")').first().click()
  await page2.waitForTimeout(2000)
  const b = page2.locator('button:has-text("AI 翻译本章")').first()
  if (!(await b.count())) return ''
  await b.click()
  for (let i = 0; i < 20; i++) {
    await page2.waitForTimeout(500)
    if (!/翻译中/.test(await b.innerText().catch(() => ''))) break
  }
  await page2.waitForTimeout(600)
  return await page2.locator('body').innerText()
}
await page2.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page2.waitForTimeout(2500)
await page2.evaluate(async () => {
  const req = indexedDB.open('greek-vocab', 1)
  const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
  const cur = await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get('settings'); t.onsuccess = () => res(t.result || {}) })
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put({ ...cur, aiProvider: 'deepseek', aiKey: 'sk-wrong', aiModel: '', aiBaseUrl: '' }, 'settings')
  await new Promise((res) => { tx.oncomplete = () => res() }); db.close()
})
await page2.reload({ waitUntil: 'domcontentloaded' }); await page2.waitForTimeout(2800)

const tBad = await tryTranslate()
check('Key 无效时提示可操作', /Key 无效|没有权限/.test(tBad), (tBad.match(/[^\n]*Key 无效[^\n]*/) || [''])[0].slice(0, 40))
check('Key 无效时给出补救建议', /服务商后台|确认 Key/.test(tBad))

mockMode2 = 'ratelimit'
const tRate = await tryTranslate()
check('限流时提示额度问题', /限流|余额不足/.test(tRate))

mockMode2 = 'garbage'
const tGar = await tryTranslate()
check('模型乱输出时提示 JSON 问题', /不是合法 JSON|结构不对/.test(tGar))

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
