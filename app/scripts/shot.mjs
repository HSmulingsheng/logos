/**
 * 无头浏览器截图 / 冒烟测试
 * 用法: node scripts/shot.mjs <url> <out.png> [width] [height] [--click=selector] [--wait=selector]
 */
import { chromium } from 'playwright-core'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

const [url, out, w = '430', h = '932', ...rest] = process.argv.slice(2)
const opts = Object.fromEntries(rest.map((r) => {
  const s = r.replace(/^--/, '')
  const i = s.indexOf('=')
  return i < 0 ? [s, '1'] : [s.slice(0, i), s.slice(i + 1)]
}))

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
})

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => errors.push(`[404?] ${r.url()} ${r.failure()?.errorText}`))

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

if (opts.wait) {
  try { await page.waitForSelector(opts.wait, { timeout: 20000 }) }
  catch { errors.push(`[timeout] 等待选择器失败: ${opts.wait}`) }
} else {
  await page.waitForTimeout(2500)
}

if (opts.click) {
  for (const sel of opts.click.split('|')) {
    try {
      await page.click(sel, { timeout: 8000 })
      await page.waitForTimeout(1200)
    } catch (e) {
      errors.push(`[click] ${sel}: ${e.message}`)
    }
  }
}

if (opts.fill) {
  const [sel, text] = opts.fill.split('::')
  try { await page.fill(sel, text); await page.waitForTimeout(800) }
  catch (e) { errors.push(`[fill] ${sel}: ${e.message}`) }
}

if (opts.click2) {
  for (const sel of opts.click2.split('|')) {
    try {
      await page.click(sel, { timeout: 8000 })
      await page.waitForTimeout(1200)
    } catch (e) {
      errors.push(`[click2] ${sel}: ${e.message}`)
    }
  }
}

if (opts.eval) {
  const r = await page.evaluate(opts.eval)
  console.log('EVAL:', JSON.stringify(r))
}

await page.screenshot({ path: out, fullPage: opts.full === '1' })
console.log('OK ->', out)
if (errors.length) {
  console.log('--- 页面问题 ---')
  for (const e of [...new Set(errors)].slice(0, 40)) console.log(e)
} else {
  console.log('无控制台错误')
}
await browser.close()
