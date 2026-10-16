/**
 * 字体验收：子集化后的 woff2 是否真的能渲染出全部需要的字形。
 *
 * 为什么必须实测而不是只看文件大小
 * --------------------------------
 * 子集化最容易出的错是「切掉了某个字形」——文件变小了，但页面上那个字变成方框（豆腐块）。
 * 光看 `pyftsubset` 的码位统计不够，因为：
 *   · 浏览器可能因为 `@font-face` 写错而根本没加载这个字体（回退到系统衬线，看着「也对」）
 *   · 变音符号是**组合字符**，要靠 `locl`/`ccmp` 排版特性叠加，子集时丢特性就会散架
 * 所以这里量三件事：字体是否真的加载、希腊语/音标的渲染宽度是否与回退字体不同、
 * 以及组合变音是否正常叠加。
 *
 * 用法: node scripts/font-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-font'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (n, ok, d = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch({
  executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2500)

// ---------------------------------------------------------------- 1. 字体是否加载
console.log('▶ 字体加载')
const loaded = await page.evaluate(async () => {
  try {
    await document.fonts.load('40px "Gentium Plus"', 'λόγος')
    await document.fonts.load('700 40px "Gentium Plus"', 'λόγος')
    await document.fonts.load('italic 40px "Gentium Plus"', 'λόγος')
  } catch (e) { return { err: String(e) } }
  const faces = [...document.fonts].map((f) => ({
    family: f.family, weight: f.weight, style: f.style, status: f.status,
  }))
  return { faces, ready: document.fonts.status }
})
// 看**各字体面**的状态才是有效证据；document.fonts.status 在这个时机可能还是 loading
const faces = loaded.faces || []
check('Gentium Plus 三档都已加载', faces.length >= 3 && faces.every((f) => f.status === 'loaded'),
  faces.map((f) => `${f.weight}/${f.style}:${f.status}`).join(' '))

// 请求过的字体文件（确认加载的是 woff2 而不是回退）
const fontReqs = await page.evaluate(() => performance.getEntriesByType('resource')
  .map((r) => r.name).filter((n) => /font|woff|ttf/i.test(n)))
check('请求的是 woff2（不是原来的 TTF）',
  fontReqs.some((n) => n.endsWith('.woff2')) && !fontReqs.some((n) => n.endsWith('.ttf')),
  fontReqs.map((n) => n.split('/').pop()).join(' ') || '（页面尚未用到字体）')

// ---------------------------------------------------------------- 2. 字形渲染
console.log('\n▶ 字形渲染')
/**
 * 用 canvas 量宽度：同一个字符，指定 Gentium Plus 与指定一个不存在字体的回退宽度。
 * 若两者相同，说明这个字形并没有由 Gentium Plus 提供（走了回退）。
 */
const measured = await page.evaluate(async () => {
  const cv = document.createElement('canvas')
  cv.width = 1200; cv.height = 200
  const ctx = cv.getContext('2d')
  const measure = (font, text) => { ctx.font = font; return ctx.measureText(text).width }
  await document.fonts.ready
  const samples = {
    '希腊字母': 'αβγδεζηθικλμνξοπρστυφχψω',
    '大写': 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ',
    '带变音': 'άέήίόύώἀἁἐἑἠἡὀὁὐὑὠὡῥᾶῆῖῦῶ',
    '国际音标': 'ɛɔɑʰŋyɪʊːˈˌ.ló.gos',
    '图表符号': '·—–…',
  }
  const out = {}
  for (const [k, v] of Object.entries(samples)) {
    out[k] = {
      text: v,
      gp: measure('40px "Gentium Plus"', v),
      fb: measure('40px "NoSuchFontFamilyXYZ", cursive', v),
    }
  }
  // 组合变音是否叠加：预组合 vs 基字+组合记号，宽度应接近
  const pre = measure('40px "Gentium Plus"', '\u1F71')      // ά 预组合
  const comb = measure('40px "Gentium Plus"', 'α\u0301')    // α + 组合尖音符
  out._comb = { pre, comb }
  return out
})

for (const [k, v] of Object.entries(measured)) {
  if (k === '_comb') continue
  const differs = Math.abs(v.gp - v.fb) > 0.5
  check(`${k}由 Gentium Plus 渲染（非回退）`, differs,
    `宽度 ${v.gp.toFixed(1)} vs 回退 ${v.fb.toFixed(1)}`)
}
const c = measured._comb
check('组合变音能叠加（不是豆腐块）', Math.abs(c.pre - c.comb) < c.pre * 0.6,
  `预组合 ${c.pre.toFixed(1)} · α+组合记号 ${c.comb.toFixed(1)}`)

// ---------------------------------------------------------------- 3. 缺字检测
console.log('\n▶ 缺字检测')
/** 逐个字符量宽度：宽度为 0 或与「明显缺字形」的字符一致，判为缺 */
const tofu = await page.evaluate(async () => {
  await document.fonts.ready
  const cv = document.createElement('canvas'); cv.width = 600; cv.height = 100
  const ctx = cv.getContext('2d')
  ctx.font = '40px "Gentium Plus"'
  // 一个几乎肯定没有的私用区码位，作为「豆腐宽度」基准
  const tofuW = ctx.measureText('\uE000').width
  const need = 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'
    + 'άέήίόύώἀἁἐἑἠἡἰἱὀὁὐὑὠὡῥᾶῆῖῦῶᾳῃῳ'
    + 'ɛɔɑʰŋyɪʊːˈˌ˘.·—–…«»“”‘’'
  const bad = []
  for (const ch of need) {
    const w = ctx.measureText(ch).width
    if (w < 0.5 || Math.abs(w - tofuW) < 0.01) bad.push(ch)
  }
  return { bad, n: [...need].length, tofuW }
})
check('全部必需字形都有（无豆腐块）', tofu.bad.length === 0,
  tofu.bad.length ? `缺 ${tofu.bad.length} 个: ${tofu.bad.slice(0, 20).join('')}` : `检查 ${tofu.n} 个字符`)

// ---------------------------------------------------------------- 4. 截图供人眼确认
await page.evaluate(() => {
  const d = document.createElement('div')
  d.id = 'font-specimen'
  d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#111;padding:20px;font-family:"Gentium Plus",serif;line-height:1.9'
  d.innerHTML = `
    <div style="font:12px -apple-system,sans-serif;color:#64748b;margin-bottom:8px">Gentium Plus 子集 · 试字</div>
    <div style="font-size:30px">λόγος ἄνθρωπος φῶς θεός χείρ Ζεύς</div>
    <div style="font-size:30px">ἀγαπήσω ῥήτωρ ᾆσμα ῳδή ῥυθμός</div>
    <div style="font-size:26px">ló.gos ɑ́n.tʰrɔː.pos pʰɔ̂ːs zdéws</div>
    <div style="font-size:26px">ɛ ɔ ɑ ʰ ŋ y ɪ ʊ ː ˈ ˌ</div>
    <div style="font-size:30px;font-weight:700">粗体 λόγος φῶς</div>
    <div style="font-size:30px;font-style:italic">斜体 λόγος φῶς</div>`
  document.body.appendChild(d)
})
await page.waitForTimeout(600)
await page.locator('#font-specimen').screenshot({ path: join(outDir, 'specimen.png') })

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n试字图: ${join(outDir, 'specimen.png')}`)
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
