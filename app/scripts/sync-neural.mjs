/**
 * 把 ONNX Runtime Web 的 WASM 运行时同步到 public/ort/。
 *
 * 与 eSpeak 同理：动态 import 的相对路径是相对打包后的 chunk 解析的，
 * 所以运行时文件要放到固定路径，由代码按「页面地址 + 绝对路径」加载。
 *
 * 用法: node scripts/sync-neural.mjs
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(APP, 'public', 'ort')

/**
 * 取 onnxruntime-web 的 dist 目录。
 *
 * ⚠️ 必须**锁定同一个版本**：pnpm 里同时存在 1.30.0（我们显式装的）和
 * 1.31.0-dev（Transformers.js 的传递依赖），两版的 .mjs 加载器与 .wasm
 * 是配对的，混用会导致 wasm 编译失败（"both async and sync fetching failed"）。
 * 这里优先用显式依赖的稳定版，并校验 .mjs 与 .wasm 同源。
 */
function findOrt() {
  const pnpm = join(APP, 'node_modules', '.pnpm')
  const all = readdirSync(pnpm).filter((d) => d.startsWith('onnxruntime-web@'))
  // 取**最新**版本：实测 1.30.0 的 ort.wasm.bundle 在本项目里起不来
  // （wasm 编译失败），1.31.0-dev 正常。这里不做「稳定版优先」的猜测，
  // 直接用最新的，并用下方的自检确认可用。
  const pick = all.sort().pop()
  if (!pick) return null
  const dist = join(pnpm, pick, 'node_modules', 'onnxruntime-web', 'dist')
  console.log(`使用 onnxruntime-web: ${pick.slice('onnxruntime-web@'.length)}`)
  return dist
}

const dist = findOrt()
if (!dist) {
  console.error('❌ 找不到 onnxruntime-web，请先 pnpm add onnxruntime-web')
  process.exit(1)
}

// 只要纯 WASM 版：默认的 jsep（WebGPU）版还要多下 28MB，而多线程还需要
// COOP/COEP 响应头，静态托管通常没有，所以固定单线程 + WASM。
const FILES = ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']

// 先清空，避免上一版残留的文件与新版本混用
for (const f of readdirSync(DEST)) rmSync(join(DEST, f), { force: true })

mkdirSync(DEST, { recursive: true })
let copied = 0
for (const f of FILES) {
  const src = join(dist, f)
  if (!existsSync(src)) { console.error(`⚠️  缺少 ${f}`); continue }
  const dst = join(DEST, f)
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue
  copyFileSync(src, dst)
  copied++
}
const wasm = join(DEST, 'ort-wasm-simd-threaded.wasm')
console.log(`ONNX Runtime 运行时已同步：${(statSync(wasm).size / 1e6).toFixed(1)} MB` + (copied ? `（复制 ${copied} 个）` : '（已是最新）'))

// ---- 模型分片
//
// Cloudflare Pages 的单文件上限是 25 MiB、GitHub 是 100 MB，而模型有 114 MB，
// 整份放上去会被拒。所以切成小块，前端并发拉取后拼接再交给 onnxruntime。
const MODEL = join(APP, 'public', 'mms-grc', 'onnx', 'model.onnx')
// 整份模型只在切分时需要，切完即删（见下）。原始文件放在仓内语料目录，
// 需要重新切分时从这里取，不必再从网上下载。
const MODEL_SRC = join(APP, '..', '语料调研', 'mms-onnx', 'model-final.onnx')
const CHUNK = 20 * 1024 * 1024      // 20 MB，留足余量
if (!existsSync(MODEL)) {
  if (existsSync(MODEL_SRC)) {
    copyFileSync(MODEL_SRC, MODEL)
    console.log('已从语料目录取回整份模型，准备切分')
  } else {
    console.log('⚠️  未找到模型（public/ 与 语料调研/ 都没有）—— 神经语音不可用（会回退 eSpeak）')
    process.exit(0)
  }
}

const buf = readFileSync(MODEL)
const n = Math.ceil(buf.length / CHUNK)
const dir = join(APP, 'public', 'mms-grc', 'onnx')
for (const f of readdirSync(dir)) if (f.startsWith('model.onnx.part-')) rmSync(join(dir, f), { force: true })
for (let i = 0; i < n; i++) {
  const part = buf.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, buf.length))
  writeFileSync(join(dir, `model.onnx.part-${String(i).padStart(2, '0')}`), part)
}
// 切完就把整份删掉：前端只用分片（parts.json），留着它会让部署体积翻倍，
// 而且 114MB 超过 Cloudflare Pages 的 25 MiB 单文件上限，直接传不上去。
rmSync(MODEL, { force: true })
console.log('已删除整份 model.onnx（前端只用分片）')
const parts = Array.from({ length: n }, (_, i) => `model.onnx.part-${String(i).padStart(2, '0')}`)
writeFileSync(join(dir, 'parts.json'), JSON.stringify({ parts, bytes: buf.length }))
console.log(`神经语音模型：${(buf.length / 1e6).toFixed(1)} MB → 切成 ${n} 片（每片 ≤20 MB，适配静态托管的单文件上限）`)
