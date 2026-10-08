/**
 * 把 Electron 运行时与已构建的前端打成一个可分发的 macOS .app：
 *
 *   release/逻各斯.app
 *     Contents/MacOS/Electron                 ← Electron 运行时
 *     Contents/Resources/app/                 ← 我们的代码 + dist/
 *     Contents/Resources/icon.icns            ← 应用图标
 *
 * 用系统自带的 ditto / sips / iconutil / plutil / codesign，不依赖任何 npm 打包器。
 * 用法: node desktop/bundle.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_APP = join(APP, 'node_modules/electron/dist/Electron.app')
const OUT_DIR = join(APP, 'release')
const NAME = '逻各斯'
const TARGET = join(OUT_DIR, `${NAME}.app`)
// 必须先在工作区之外组装并签名：工作区在 iCloud/FileProvider 管辖下，
// 系统会持续给文件打上 com.apple.provenance / FinderInfo，
// 导致 codesign 报 "resource fork, Finder information, or similar detritus"，
// 签不上名的 app 在 Apple Silicon 上会被内核直接 SIGKILL。
const STAGE = join(tmpdir(), 'greek-vocab-app-stage')
const STAGED = join(STAGE, `${NAME}.app`)
const ICON_PNG = join(APP, 'public/icons/icon-1024.png')

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
// 注意：codesign / iconutil 的诊断信息走 stderr，必须合并两个流再判断
const shOut = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
const sh = (cmd, args) => {
  const r = shOut(cmd, args)
  return r.code === 0 ? r.out : `ERR ${r.out || `exit ${r.code}`}`
}

const dirSize = (p) => {
  let total = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(f)
      else if (e.isFile()) total += statSync(f).size
    }
  }
  walk(p)
  return total
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`

if (process.platform !== 'darwin') {
  console.error('此脚本只支持 macOS')
  process.exit(1)
}
if (!existsSync(ELECTRON_APP)) {
  console.error(`找不到 Electron 运行时：${ELECTRON_APP}\n
请先下载（本机 node 无法加载 electron 的原生解压模块，需手动装）：
  cd app
  V=$(python3 -c "import json;print(json.load(open('node_modules/electron/package.json'))['version'])")
  curl -L -o /tmp/electron.zip \\
    "https://github.com/electron/electron/releases/download/v$V/electron-v$V-darwin-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 ).zip"
  mkdir -p node_modules/electron/dist
  ditto -x -k /tmp/electron.zip node_modules/electron/dist
  printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt`)
  process.exit(1)
}

console.log('▶ 准备临时组装目录（避开 iCloud 管辖）')
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

console.log('▶ 复制 Electron 运行时（ditto 保留符号链接与权限）')
run('ditto', [ELECTRON_APP, STAGED])

console.log('▶ 写入应用代码')
const APP_RES = join(STAGED, 'Contents/Resources/app')
mkdirSync(join(APP_RES, 'desktop'), { recursive: true })
// 只带运行所需：main 进程 + 构建产物 + 精简 package.json
// 复制主进程运行所需的全部 .cjs（跳过自检脚本），避免漏文件
for (const f of readdirSync(join(APP, 'desktop'))) {
  if (f.endsWith('.cjs') && f !== 'selftest.cjs') {
    cpSync(join(APP, 'desktop', f), join(APP_RES, 'desktop', f))
  }
}
cpSync(join(APP, 'dist'), join(APP_RES, 'dist'), { recursive: true })
const pkg = JSON.parse(run('cat', [join(APP, 'package.json')]))
writeFileSync(join(APP_RES, 'package.json'), JSON.stringify({
  name: 'greek-vocab',
  productName: NAME,
  version: pkg.version,
  description: pkg.description,
  main: 'desktop/main.cjs',
}, null, 2))

console.log('▶ 更新 Info.plist')
const PLIST = join(STAGED, 'Contents/Info.plist')
const setKey = (key, value, type = 'string') => {
  for (const action of ['-replace', '-insert']) {
    const r = sh('plutil', [action, key, `-${type}`, value, PLIST])
    if (!r.startsWith('ERR')) return
  }
  console.warn(`  ⚠️ 未能设置 ${key}`)
}
setKey('CFBundleName', '逻各斯')
setKey('CFBundleDisplayName', NAME)
setKey('CFBundleIdentifier', 'local.greekvocab.app')
setKey('CFBundleShortVersionString', pkg.version)
setKey('CFBundleVersion', pkg.version)
setKey('LSApplicationCategoryType', 'public.app-category.education')
setKey('NSHumanReadableCopyright', '逻各斯')

console.log('▶ 生成应用图标')
if (existsSync(ICON_PNG)) {
  const iconset = join(STAGE, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  const sizes = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ]
  for (const [px, name] of sizes) {
    sh('sips', ['-z', String(px), String(px), ICON_PNG, '--out', join(iconset, name)])
  }
  const r = sh('iconutil', ['--convert', 'icns', '--output', join(STAGED, 'Contents/Resources/icon.icns'), iconset])
  if (r.startsWith('ERR')) console.warn('  ⚠️ iconutil 失败，沿用 Electron 默认图标')
  else { setKey('CFBundleIconFile', 'icon'); console.log('  icon.icns 已生成') }
  rmSync(iconset, { recursive: true, force: true })
}

console.log('▶ 重新做 ad-hoc 签名')
rmSync(join(STAGED, 'Contents/Resources/default_app.asar'), { force: true })
// 不要先 --remove-signature：那会把 Electron 自带的合法签名撤掉，
// 一旦随后签名失败，产物就是完全未签名，内核会拒绝启动。
shOut('xattr', ['-cr', STAGED])
const signR = shOut('codesign', ['--force', '--deep', '--sign', '-', STAGED])
const verifyR = shOut('codesign', ['--verify', STAGED])
const infoR = shOut('codesign', ['-dv', STAGED])
if (infoR.out.includes('adhoc') && verifyR.code === 0) {
  console.log('  ad-hoc 签名完成并通过校验')
} else {
  console.error('  ❌ 签名失败——未签名的 app 在 Apple Silicon 上会被内核杀掉')
  console.error(`     codesign: ${signR.out.trim().slice(0, 300) || '(无输出)'}`)
  console.error(`     verify:   ${verifyR.out.trim().slice(0, 300) || '(无输出)'}`)
  process.exit(1)
}

console.log('▶ 搬回工作区')
run('ditto', [STAGED, TARGET])
rmSync(STAGE, { recursive: true, force: true })
// 搬回后系统会给 bundle 补上 FinderInfo/provenance，但可执行文件本身的签名仍然有效；
// 只要不重新签名，应用可以正常启动（已实测）。

const ok = existsSync(join(TARGET, 'Contents/Resources/app/dist/index.html'))
console.log('')
console.log(ok ? '✅ 打包完成' : '❌ 打包失败：dist/index.html 未就位')
console.log(`   ${TARGET}`)
console.log(`   体积 ${mb(dirSize(TARGET))}`)
console.log('   双击即可运行；首次打开若被 Gatekeeper 拦下，右键 →「打开」。')
process.exit(ok ? 0 : 1)
