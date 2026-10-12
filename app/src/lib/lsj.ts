/**
 * LSJ（Liddell-Scott-Jones, *A Greek-English Lexicon*）释义加载。
 *
 * 来源与许可
 * ----------
 * Perseus Digital Library — https://github.com/PerseusDL/lexica
 * **CC BY-SA 4.0**。使用时必须保留出处，见 NOTICE.md。
 *
 * 设计
 * ----
 * `data/lsj.json` 有 2.7 MB，只在真的要看词条时按需拉一次并常驻内存，
 * 不放进首屏包。抽取过程见 tools/build_lsj.py（Beta Code 转换、
 * 剔除引文与希腊语例词等，那里有详细踩坑记录）。
 */
type LsjMap = Record<string, string>

let cache: LsjMap | null = null
let pending: Promise<LsjMap> | null = null

/** 按需加载整表；同一会话内只拉一次（含失败重试：失败后清掉 pending） */
export function loadLsj(): Promise<LsjMap> {
  if (cache) return Promise.resolve(cache)
  if (pending) return pending
  const url = `${import.meta.env.BASE_URL || './'}data/lsj.json`
  pending = fetch(url)
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: LsjMap) => { cache = d; return d })
    .catch(() => { pending = null; return {} as LsjMap })
  return pending
}

/** 同步取已加载的释义；未加载或没有则返回 undefined */
export function lsjOf(id: number): string | undefined {
  return cache?.[String(id)]
}

export function lsjLoaded(): boolean {
  return cache !== null
}
