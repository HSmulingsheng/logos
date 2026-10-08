const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { startServer } = require('./server.cjs')

const ROOT = resolve(__dirname, '..', 'dist')
const STATE_FILE = () => join(app.getPath('userData'), 'window-state.json')

let server = null
let origin = null

async function bootServer() {
  const s = await startServer(ROOT)
  server = { close: s.close }
  origin = s.origin
  return origin
}

function loadState() {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE(), 'utf8'))
    if (s && typeof s.width === 'number') return s
  } catch { /* 首次运行 */ }
  return { width: 1180, height: 840 }
}

function saveState(win) {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getNormalBounds()
    writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch { /* 忽略 */ }
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 逻各斯' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: '前置全部窗口' }] : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const state = loadState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    minWidth: 380,
    minHeight: 560,
    title: '逻各斯',
    backgroundColor: '#fbfaf7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  if (state.maximized) win.maximize()
  await win.loadURL(origin)

  // 外链（Logeion / BibleHub）用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(origin)) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  let t = null
  const save = () => { clearTimeout(t); t = setTimeout(() => saveState(win), 400) }
  win.on('resize', save)
  win.on('move', save)
  win.on('close', save)
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) { if (w.isMinimized()) w.restore(); w.focus() }
  })

  app.whenReady().then(async () => {
    if (!existsSync(ROOT)) {
      dialog.showErrorBox('缺少构建产物', `找不到 ${ROOT}\n\n请先在 app/ 目录运行:\n  node node_modules/vite/bin/vite.js build && node scripts/build-sw.mjs`)
      app.quit()
      return
    }
    try {
      await bootServer()
    } catch (e) {
      dialog.showErrorBox('无法启动内部服务', String(e))
      app.quit()
      return
    }
    buildMenu()
    // createWindow 内部 await 了 loadURL，返回时页面已经加载完毕
    await createWindow()
    console.log(`[ready] ${origin}`)   // 供启动自检判断「应用真的起来了」
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => { if (server) server.close() })
}
