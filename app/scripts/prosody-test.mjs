/**
 * 音高重音（韵律改造）验收。
 *
 * eSpeak 的 `grc` 语音**完全没实现音高重音**：acute 与 circumflex 的输出
 * 逐字符相同（φῶς 与 φώς 都是 f_ˈɔː_s_，整词 F0 差 0.1 Hz）。
 * 这个测试验证改造后确实产生了调型差异。
 *
 * 做法：拦截 `URL.createObjectURL` 抓下合成的音频，在页面里用 WebAudio 解码，
 * 再用自相关估 F0。**不依赖试听**，全部是可测量。
 *
 * 用法: node scripts/prosody-test.mjs [url] [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const [url = 'http://127.0.0.1:4178/', outDir = '/tmp/greek-prosody'] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++; else fail++
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 932 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error') errors.push(t)
  if (/tts|韵律|prosody/i.test(t)) console.log('   [console] ' + t.slice(0, 140))
})

await page.addInitScript(() => {
  localStorage.setItem('greek-welcomed-v2', '1')
  // 拦截音频 blob，供测试解码分析
  const orig = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (obj) => {
    const u = orig(obj)
    if (obj instanceof Blob && obj.type.includes('audio')) {
      // 必须存 **Blob 本身**：应用会 revokeObjectURL，之后 fetch 那个 URL 会失败
      // @ts-ignore
      ;(window.__blobs ||= []).push(obj)
    }
    return u
  }
})

/** 设置韵律开关，并等应用就绪 */
async function setProsody(on, amp = 1) {
  await page.evaluate(async ([on, amp]) => {
    const req = indexedDB.open('greek-vocab', 1)
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
    const cur = await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get('settings'); t.onsuccess = () => res(t.result || {}) })
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put({ ...cur, prosodyAccent: on, prosodyAmp: amp, speechEngine: 'espeak' }, 'settings')
    await new Promise((res) => { tx.oncomplete = () => res() }); db.close()
  }, [on, amp])
}

/**
 * 抓最近一次合成的音频并分析。
 *
 * 走**真实 UI**（点朗读按钮）而不是 import 源码：测试服务器跑的是构建产物，
 * 没有 /src/ 路径；而且这样连「设置有没有真的传进语音模块」一起验了。
 */
async function analyzeLastBlob() {
  return await page.evaluate(async () => {
    // @ts-ignore
    const list = window.__blobs || []
    const blob = list[list.length - 1]
    if (!blob) return { err: '没有抓到音频' }
    const buf = await blob.arrayBuffer()
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const audio = await ac.decodeAudioData(buf)
    const x = audio.getChannelData(0)
    const sr = audio.sampleRate
    const win = Math.round(0.04 * sr), hop = Math.round(0.01 * sr)
    const lagMin = Math.floor(sr / 400), lagMax = Math.ceil(sr / 70)
    const vals = []
    for (let c = win; c + win < x.length; c += hop) {
      let best = 0, bestLag = 0
      for (let lag = lagMin; lag <= lagMax; lag++) {
        let num = 0, d1 = 0, d2 = 0
        for (let i = -win; i < 0; i++) {
          const u = x[c + i], v = x[c + i + lag]
          num += u * v; d1 += u * u; d2 += v * v
        }
        const den = Math.sqrt(d1 * d2)
        const r = den > 1e-12 ? num / den : 0
        if (r > best) { best = r; bestLag = lag }
      }
      if (best >= 0.45 && bestLag) vals.push(sr / bestLag)
    }
    const sorted = [...vals].sort((a, b) => a - b)
    const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
    let rms = 0
    for (let i = 0; i < x.length; i++) rms += x[i] * x[i]
    return {
      n: vals.length, f0: q(0.5), lo: q(0.1), hi: q(0.9),
      range: q(0.9) - q(0.1), dur: audio.duration,
      rms: Math.sqrt(rms / x.length),
    }
  })
}


/** 进到古典阅读的一章，点第一个朗读按钮 */
/**
 * 点击朗读按钮，直到抓到一段音频。
 *
 * ⚠️ 不能「先预热一次丢掉再点第二次」：第二次会命中 TTS 的内存缓存，
 * 直接返回旧的 blob URL，`createObjectURL` 不会再被调用，于是抓不到新音频。
 * 所以改成**反复点击直到抓到**——重试本身就把冷启动（加载 24MB WASM）消化掉了。
 */
async function clickUntilBlob(maxTries = 3) {
  for (let t = 0; t < maxTries; t++) {
    await page.evaluate(() => { (window.__blobs || []).length = 0 })
    await page.locator('main button[aria-label="朗读"]').first().click()
    for (let i = 0; i < 160; i++) {
      await page.waitForTimeout(250)
      // @ts-ignore
      if (await page.evaluate(() => (window.__blobs || []).length > 0)) return true
    }
    // 可能上一次还在播，先停掉再重试
    await page.locator('main button[aria-label="朗读"]').first().click().catch(() => {})
    await page.waitForTimeout(600)
  }
  return false
}

/** 进到古典阅读的一章，朗读并分析 */
async function speakOneSentence() {
// 线上首访要装 Service Worker 并拉词表索引，导航栏可能还没渲染出来。
// 固定等待不够稳，这里等它真正出现再点。
await page.locator('nav').first().waitFor({ state: 'visible', timeout: 60000 })
  await page.locator('nav button:has-text("学习")').first().click()
  await page.waitForTimeout(900)
  await page.locator('main button:has-text("阅读")').first().click()
  await page.waitForTimeout(1200)
  await page.locator('main button:has-text("历史")').first().click()
  await page.waitForTimeout(1200)
  await page.locator('main button').filter({ hasText: /修昔底德|希罗多德|波利比奥斯/ }).first().click()
  await page.waitForTimeout(1500)
  await page.locator('main button:has-text("1")').first().click()
  await page.waitForTimeout(2000)
  await clickUntilBlob()
  return await analyzeLastBlob()
}

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForTimeout(3000)

// ---------------------------------------------------------------- 开关对比
console.log('▶ 开关对比：同一段文本，韵律关 vs 开')
await setProsody(false)
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
const off = await speakOneSentence()
await setProsody(true, 1)
await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2800)
const on = await speakOneSentence()
console.log(`   关闭: F0 ${off.f0?.toFixed(1)} Hz · 起伏 ${off.range?.toFixed(1)} Hz · 时长 ${off.dur?.toFixed(2)}s · ${off.n} 帧`)
console.log(`   开启: F0 ${on.f0?.toFixed(1)} Hz · 起伏 ${on.range?.toFixed(1)} Hz · 时长 ${on.dur?.toFixed(2)}s · ${on.n} 帧`)
console.log()

// ---------------------------------------------------------------- 断言
check('韵律关闭时也能正常合成', (off.f0 || 0) > 0, `${off.f0?.toFixed(1)} Hz`)
check('韵律开启时也能正常合成（没把音频弄坏）', (on.f0 || 0) > 0, `${on.f0?.toFixed(1)} Hz`)
check('开启后音频时长基本不变（不是靠拉长冒充）',
  Math.abs((on.dur || 0) - (off.dur || 0)) < 0.4,
  `${off.dur?.toFixed(2)}s → ${on.dur?.toFixed(2)}s`)
// 核心：改造的作用就是**增加调型起伏**。同一段文本，开启后 F0 的四分位距应当变大。
check('开启后 F0 起伏变大（调型真的出现了）',
  (on.range || 0) > (off.range || 0),
  `关闭 ${off.range?.toFixed(1)}Hz → 开启 ${on.range?.toFixed(1)}Hz`)
check('中位 F0 没有离谱偏移',
  Math.abs((on.f0 || 0) - (off.f0 || 0)) < 20,
  `${off.f0?.toFixed(1)} → ${on.f0?.toFixed(1)} Hz`)
check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await page.screenshot({ path: join(outDir, 'settings.png') })
await browser.close()
console.log(`\n=== 结果 ===`)
console.log(fail === 0 ? `全部 ${pass} 项通过` : `${fail}/${pass + fail} 项失败`)
process.exit(fail === 0 ? 0 : 1)
