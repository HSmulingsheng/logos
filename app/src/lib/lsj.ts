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
 * `data/lsj.json` 有 2.6 MB，只在真的要看词条时按需拉一次并常驻内存，
 * 不放进首屏包。抽取过程见 tools/build_lsj.py（Beta Code 转换、
 * 剔除引文与希腊语例词、义项按语料相关度排序等，那里有详细踩坑记录）。
 *
 * 义项**不按 LSJ 原序**呈现：LSJ 按词义的历史顺序排，首位常是词源义
 * （如 λόγος 的 "computation, reckoning"），而阅读时最常用的是
 * "verbal expression or utterance"。排序依据是各义项下的作者引用，
 * 按应用语料里会读到的作者加权，详见 tools/build_lsj.py 的 CORPUS_WEIGHT。
 */
/** 一个义项：n=LSJ 的编号（I / A / 1…），t=释义，s=按应用语料的相关度分 */
export interface LsjSense { n: string; t: string; s: number }

type LsjMap = Record<string, LsjSense[]>

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

/** 同步取已加载的义项；未加载或没有则返回 undefined */
export function lsjOf(id: number): LsjSense[] | undefined {
  return cache?.[String(id)]
}

