/**
 * 把 deploy/ 发布到 Cloudflare Pages，得到一个**永久网址**。
 *
 * 为什么用 Cloudflare Pages：
 *   * 免费、永久（不是临时隧道，不依赖本机开着）
 *   * 项目名即子域名，可以取到又短又贴题的名字
 *
 * 需要两个环境变量（都在 Cloudflare 后台免费获取，见 DEPLOY.md）：
 *   CLOUDFLARE_API_TOKEN   权限至少含 Account → Cloudflare Pages → Edit
 *   CLOUDFLARE_ACCOUNT_ID  Workers & Pages 页面右侧的 Account ID
 *
 * 用法:
 *   node scripts/publish.mjs                  # 用默认项目名 logos-grc
 *   node scripts/publish.mjs --name=logoi     # 指定项目名（决定子域名）
 *   node scripts/publish.mjs --check          # 只体检 deploy/，不上传
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(APP, '..')
const DIR = join(ROOT, 'deploy')

const arg = (k, d) => {
  const hit = process.argv.find((x) => x.startsWith(`--${k}=`))
  return hit ? hit.split('=')[1] : d
}
const NAME = arg('name', 'logos-grc')
const CHECK_ONLY = process.argv.includes('--check')

// Cloudflare Pages 的硬限制
const MAX_FILE = 25 * 1024 * 1024   // 单文件 25 MiB
const MAX_FILES = 20000

function wrangler(args, env) {
  const bin = readdirSync(join(APP, 'node_modules', '.pnpm'))
    .filter((d) => d.startsWith('wrangler@'))
    .sort()
    .pop()
  if (!bin) throw new Error('没找到 wrangler，请先 pnpm add -D wrangler')
  const js = join(APP, 'node_modules', '.pnpm', bin, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  return execFileSync(process.execPath, [js, ...args], { stdio: 'inherit', env: { ...process.env, ...env } })
}

function inspect() {
  if (!existsSync(DIR)) {
    console.error(`❌ 没有 ${DIR}，先跑：cd app && node scripts/make-deploy.mjs`)
    process.exit(1)
  }
  let files = 0
  let biggest = 0
  let biggestName = ''
  let total = 0
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      files++
      total += st.size
      if (st.size > biggest) { biggest = st.size; biggestName = p.replace(`${DIR}/`, '') }
    }
  }
  walk(DIR)

  console.log('部署包体检')
  console.log(`  文件数 ${files} / 上限 ${MAX_FILES}${files > MAX_FILES ? '  ❌ 超标' : '  ✅'}`)
  console.log(`  最大文件 ${(biggest / 1048576).toFixed(1)} MB（${biggestName}）/ 上限 25 MiB${biggest > MAX_FILE ? '  ❌ 超标' : '  ✅'}`)
  console.log(`  总体积 ${(total / 1048576).toFixed(0)} MB`)
  const ok = files <= MAX_FILES && biggest <= MAX_FILE
  if (!ok) console.log('\n超标的话上传会被拒：检查是否误把整份大文件塞进了 public/。')
  return ok
}

const ok = inspect()
if (CHECK_ONLY) process.exit(ok ? 0 : 1)
if (!ok) { console.error('\n❌ 体检未通过，已中止。'); process.exit(1) }

const token = process.env.CLOUDFLARE_API_TOKEN
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !account) {
  console.error(`
❌ 缺少 Cloudflare 凭证。

请先设置这两个环境变量（获取方式见 DEPLOY.md「取得永久网址」一节）：
  export CLOUDFLARE_API_TOKEN=...
  export CLOUDFLARE_ACCOUNT_ID=...

然后重新运行：
  node scripts/publish.mjs --name=${NAME}
`)
  process.exit(1)
}

console.log(`\n▶ 发布到 Cloudflare Pages，项目名 ${NAME}`)
console.log(`  预计网址：https://${NAME}.pages.dev\n`)
wrangler(['pages', 'deploy', DIR, `--project-name=${NAME}`, '--commit-dirty=true'],
  { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account })
console.log(`\n✅ 完成。网址：https://${NAME}.pages.dev`)
