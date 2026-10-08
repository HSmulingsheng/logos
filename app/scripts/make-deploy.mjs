/**
 * 生成可公开部署的静态站点包。
 *
 * 与本地版的关键区别：**音频全部用自生成（eSpeak）版本**，
 * 不包含来源不明的原牌组录音，避免再分发问题。
 *
 * 产出:
 *   deploy/                     可直接上传的站点目录
 *   logos-site.zip        Cloudflare Pages / Netlify 拖拽上传用
 *
 * 用法: node scripts/make-deploy.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(APP, '..')
const DIST = join(APP, 'dist')
const DEPLOY = join(ROOT, 'deploy')
const ZIP = join(ROOT, 'logos-site.zip')
const PY = process.env.GREEK_PY || 'python3'
const NODE = process.execPath

const run = (cmd, args, opts = {}) => {
  console.log(`  $ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd ?? APP })
}

const dirSize = (p) => {
  let total = 0, files = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.isFile()) { total += statSync(f).size; files++ }
    }
  }
  walk(p)
  return { total, files }
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`

// ---------------------------------------------------------------- 1. 数据（公开发布模式）
console.log('▶ 1/6 用「全部自生成音频」重建数据')
run(PY, ['tools/build_app_data.py', '--audio', 'tts'], { cwd: ROOT })

// ---------------------------------------------------------------- 2. 构建
console.log('▶ 2/6 构建前端')
run(NODE, [join(APP, 'node_modules/vite/bin/vite.js'), 'build'])
run(NODE, [join(APP, 'scripts/build-sw.mjs')])

// ---------------------------------------------------------------- 3. 拷出站点（剔除原牌组录音）
console.log('▶ 3/6 拷出站点目录（不含原牌组录音）')
rmSync(DEPLOY, { recursive: true, force: true })
mkdirSync(DEPLOY, { recursive: true })
run('rsync', ['-a', '--exclude', '/audio/', `${DIST}/`, `${DEPLOY}/`])

// 部署平台的配套文件
writeFileSync(join(DEPLOY, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/audio-tts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/fonts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/data/lesson-*.json',
  '  Cache-Control: public, max-age=86400',
  '',
].join('\n'))
writeFileSync(join(DEPLOY, '.nojekyll'), '')   // GitHub Pages 用：别走 Jekyll
writeFileSync(join(DEPLOY, 'robots.txt'), 'User-agent: *\nAllow: /\n')

const site = dirSize(DEPLOY)
console.log(`  站点：${mb(site.total)} / ${site.files} 个文件`)

// ---------------------------------------------------------------- 4. 打包
console.log('▶ 4/6 打 zip')
rmSync(ZIP, { force: true })
run('zip', ['-qr', ZIP, '.'], { cwd: DEPLOY })
console.log(`  ${ZIP}  ${mb(statSync(ZIP).size)}`)

// ---------------------------------------------------------------- 5. 恢复本地版数据（原录音优先）
console.log('▶ 5/6 恢复本地版数据（原录音优先 + TTS 补齐）')
run(PY, ['tools/build_app_data.py', '--audio', 'mixed'], { cwd: ROOT })

// ---------------------------------------------------------------- 6. 重建本地 dist
console.log('▶ 6/6 重建本地 dist')
run(NODE, [join(APP, 'node_modules/vite/bin/vite.js'), 'build'])
run(NODE, [join(APP, 'scripts/build-sw.mjs')])

console.log('')
console.log('✅ 部署物料已就绪')
console.log(`   站点目录   ${DEPLOY}`)
console.log(`   压缩包     ${ZIP}`)
console.log('   下一步见 DEPLOY.md')
