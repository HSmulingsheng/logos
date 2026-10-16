/**
 * 国际音标（IPA）验收。
 *
 * 音标由 tools/build_ipa.py 用 CLTK 的 Probert(2010) 古典阿提卡重建生成，
 * 存进 data/ipa.json，构建时写进 lesson-*.json 的 `ipa` 字段与 index.json 第 6 项。
 *
 * 这里校验两件事：
 *   1. 数据层：覆盖率、字段存在、以及几个「能验对错」的音值特征
 *   2. 界面层：词典列表与词条详情真的把音标渲染出来了
 *
 * 用法: node scripts/ipa-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')          // app/
const ROOT = join(APP, '..')          // 仓库根（data/ 在这里，不在 app/ 下）

const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-ipa'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

// ---------------------------------------------------------------- 1) 数据层
console.log('▶ 1. 数据层')
const ipa = JSON.parse(readFileSync(join(ROOT, 'data/ipa.json'), 'utf8'))
const greek = JSON.parse(readFileSync(join(ROOT, 'data/greek.json'), 'utf8'))
check('ipa.json 覆盖率 100%', Object.keys(ipa).length === greek.length,
  `${Object.keys(ipa).length} / ${greek.length}`)

const byWord = new Map()
for (const r of greek) {
  const w = (r._raw || {}).Greek
  const v = ipa[String(r.id)]
  if (w && v) byWord.set(w, v)
}

// 阿提卡重建里有几个「一望即知对错」的特征，用来防止换实现后音值悄悄退化。
// 注意：CLTK 输出做过 NFC，所以带调的拉丁字母是**预组合**的（ý 是 U+00FD 而不是
// y+U+0301）。比对前统一转成 NFD，否则 includes('y') 会误判。
const FEATURES = [
  ['ζ = [zd]（不是 [z]）', 'Ζεύς', (s) => s.includes('zd')],
  ['θ = [tʰ]（送气塞音）', 'θεός', (s) => s.includes('tʰ')],
  ['φ = [pʰ]', 'φιλοσοφία', (s) => s.includes('pʰ')],
  ['χ = [kʰ]', 'ψυχή', (s) => s.includes('kʰ')],
  ['η = [ɛː]（长 e）', 'ἡμέρα', (s) => s.includes('ɛː')],
  ['ω = [ɔː]（长 o）', 'λέγω', (s) => s.includes('ɔː')],
  ['υ = [y]（不是 [u]）', 'ψυχή', (s) => s.includes('y')],
  ['粗气号 → h', 'ὁ', (s) => s.startsWith('h')],
  ['γ 在 μ 前 → [ŋ]', 'πρᾶγμα', (s) => s.includes('ŋ')],
  ['音节用 . 分隔', 'ἄνθρωπος', (s) => s.includes('.')],
]
for (const [name, word, test] of FEATURES) {
  const v = byWord.get(word)
  const flat = v ? v.normalize('NFD') : ''
  check(`音值：${name}`, !!v && test(flat), v ? `${word} → [${v}]` : `${word} 没有音标`)
}

// 每个音标都应是可打印字符、且不含方括号（方括号由界面加）
const bad = Object.entries(ipa).filter(([, v]) => /[[\]]/.test(v) || !v.trim())
check('音标里不含方括号或空值', bad.length === 0, bad.length ? `${bad.length} 条异常` : '')

const lesson = JSON.parse(readFileSync(join(APP, 'public/data/lesson-01.json'), 'utf8'))
const ws = Array.isArray(lesson) ? lesson : lesson.words
check('lesson 数据带 ipa 字段', ws.every((w) => typeof w.ipa === 'string' && w.ipa),
  `${ws.filter((w) => w.ipa).length} / ${ws.length}`)

const idx = JSON.parse(readFileSync(join(APP, 'public/data/index.json'), 'utf8'))
check('index 每条 6 个字段（末位是音标）', idx.every((e) => e.length === 6 && typeof e[5] === 'string'),
  `首条 ${JSON.stringify(idx[0]).slice(0, 70)}`)

// ---------------------------------------------------------------- 2) 界面层
console.log('\n▶ 2. 界面层')
const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(() => localStorage.setItem('greek-welcomed-v2', '1'))

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(2500)
// 线上首访要装 Service Worker 并拉词表索引，导航栏可能还没渲染出来。
// 固定等待不够稳，这里等它真正出现再点。
await page.locator('nav').first().waitFor({ state: 'visible', timeout: 60000 })
await page.locator('nav >> text="学习"').click()
await page.waitForTimeout(600)
await page.locator('main button:has-text("词典")').first().click()
await page.waitForTimeout(2500)

const box = page.locator('input[placeholder^="搜索希腊语"]')
await box.click()
for (const ch of 'logos') { await box.type(ch, { delay: 60 }); await page.waitForTimeout(140) }
// 线上要加载 1.4MB 的词典索引，固定等待会不够——改成轮询到出结果为止
let listText = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400)
  listText = await page.locator('main').innerText()
  if (/\[[^\]]*[ɑɛɔʰŋy][^\]]*\]/.test(listText)) break
}
const shown = listText.match(/\[[^\]]*[ɑɛɔʰŋy][^\]]*\]/g) || []
check('词典列表渲染出音标', shown.length >= 3, `${shown.length} 处，如 ${shown.slice(0, 2).join(' ')}`)
await page.screenshot({ path: join(outDir, 'ipa-list.png') })

// 打开第一条词条详情
await page.locator('main button').filter({ hasText: 'λόγος' }).first().click()
await page.waitForTimeout(1400)
const detailText = await page.locator('body').innerText()
check('词条详情出现「发音」行', /发音[\s\S]{0,40}\[/.test(detailText),
  (detailText.match(/发音[^\n]*/) || [''])[0].slice(0, 40))
await page.screenshot({ path: join(outDir, 'ipa-detail.png') })

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
