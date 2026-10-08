/**
 * Electron 外壳自检：不开窗口，验证桌面版能真正加载并运行应用。
 * 用法: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron desktop/selftest.cjs
 * 注意：环境里若有 ELECTRON_RUN_AS_NODE=1，必须清掉，否则 Electron 会退化成纯 Node。
 */
const { app, BrowserWindow } = require('electron')
const { existsSync, mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { startServer } = require('./server.cjs')

const DIST = resolve(__dirname, '..', 'dist')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('缺少 dist/index.html，请先构建')
    app.exit(1)
    return
  }

  const { origin, close } = await startServer(DIST)
  console.log(`内置服务: ${origin}`)

  const win = new BrowserWindow({
    show: false,
    width: 1180,
    height: 840,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  const errors = []
  win.webContents.on('console-message', (...a) => {
    // 新版签名是 (event)，旧版是 (event, level, message)
    const ev = a[0] && typeof a[0] === 'object' && 'level' in a[0] ? a[0] : null
    const level = ev ? ev.level : a[1]
    const message = ev ? ev.message : a[2]
    if (level === 'error' || level >= 2) errors.push(String(message))
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`))

  await win.loadURL(origin)
  await new Promise((r) => setTimeout(r, 3000))

  const evalJs = (code) => win.webContents.executeJavaScript(code, true)

  // 首次访问会弹「游客模式」说明，先关掉
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '开始使用'); if (b) { b.click(); return true } return false })()`)
  await new Promise((r) => setTimeout(r, 600))

  check('页面标题', (await evalJs('document.title')) === '逻各斯', await evalJs('document.title'))
  check('应用已渲染（首页）', await evalJs(`document.body.innerText.includes('今日任务')`))

  const manifest = await evalJs(`fetch('./data/manifest.json').then(r=>r.json()).then(m=>m.totalWords).catch(()=>-1)`)
  check('词表元数据可读', manifest === 15686, `totalWords=${manifest}`)

  const lesson = await evalJs(`fetch('./data/lesson-01.json').then(r=>r.json()).then(d=>d.words.length).catch(()=>-1)`)
  check('首课词表可读', lesson > 300, `${lesson} 词`)

  const audio = await evalJs(`fetch('./audio/3588g.mp3').then(r=>r.ok?r.arrayBuffer().then(b=>b.byteLength):-1).catch(()=>-1)`)
  check('音频可读', audio > 1000, `${audio} 字节`)

  // 音频解码：Chromium/Electron 是否真的能解出 m4a（AAC）与 mp3
  const audioDecode = await evalJs(`(async () => {
    const idx = await (await fetch('./data/audio-index.json')).json()
    const pick = (ext) => idx.find((f) => f.endsWith(ext))
    const targets = [pick('.mp3'), pick('.m4a')].filter(Boolean)
    const out = []
    for (const f of targets) {
      const full = f.includes('/') ? f : 'audio/' + f
      const url = './' + full.split('/').map(encodeURIComponent).join('/')
      try {
        const buf = await (await fetch(url)).arrayBuffer()
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const d = await ctx.decodeAudioData(buf.slice(0))
        out.push({ ext: f.slice(f.lastIndexOf('.')), seconds: Number(d.duration.toFixed(2)) })
        await ctx.close()
      } catch (e) { out.push({ ext: f, error: String(e).slice(0, 60) }) }
    }
    return out
  })()`)
  const audioOk = Array.isArray(audioDecode) && audioDecode.length >= 1 && audioDecode.every((a) => a.seconds > 0.1)
  check('音频可解码（mp3 + m4a）', audioOk, JSON.stringify(audioDecode))

  const idb = await evalJs(`new Promise(res=>{try{const q=indexedDB.open('greek-vocab',1);q.onsuccess=()=>res(!!q.result.objectStoreNames.length);q.onerror=()=>res(false)}catch(e){res(false)}})`)
  check('IndexedDB 可用（学习进度存储）', idb === true)

  // 进入学习流程
  const clicked = await evalJs(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='开始学习');if(!b)return false;b.click();return true})()`)
  await new Promise((r) => setTimeout(r, 2500))
  const inStudy = await evalJs(`!!document.querySelector('[data-testid=study]')`)
  check('可进入学习流程', clicked && inStudy)

  // 从渲染进程直接截图，作为桌面版真实渲染的证据
  const shots = process.env.GREEK_SHOT_DIR
  if (shots) {
    try {
      mkdirSync(shots, { recursive: true })
      const img = await win.webContents.capturePage()
      writeFileSync(`${shots}/desktop-学习页.png`, img.toPNG())
      // 显示释义后再截一张
      const rv = await evalJs(`(()=>{const b=[...document.querySelectorAll('[data-testid=study] button')].find(x=>x.textContent.trim()==='显示释义');if(!b)return false;b.click();return true})()`)
      if (rv) {
        await new Promise((r) => setTimeout(r, 1500))
        const img2 = await win.webContents.capturePage()
        writeFileSync(`${shots}/desktop-卡片详情.png`, img2.toPNG())
      }
      check('窗口截图已保存', true, shots)
    } catch (e) {
      check('窗口截图已保存', false, e.message)
    }
  }

  const fontOk = await evalJs(`document.fonts.check('24px "Gentium Plus"')`)
  check('Gentium 字体已加载', fontOk === true)

  check('无渲染错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  console.log('')
  const failed = results.filter((r) => !r.ok)
  console.log(failed.length === 0 ? `全部 ${results.length} 项通过` : `${failed.length}/${results.length} 项失败`)
  if (errors.length) console.log('错误：\n' + [...new Set(errors)].slice(0, 8).join('\n'))

  close()
  app.exit(failed.length === 0 ? 0 : 1)
})
