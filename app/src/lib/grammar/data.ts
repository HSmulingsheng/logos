import type { GrammarData, SmythData } from './types'

let promise: Promise<GrammarData | null> | null = null

/** 载入语法数据（全局只拉一次，供闯关与速查共用） */
export function loadGrammar(): Promise<GrammarData | null> {
  if (!promise) {
    const base = import.meta.env.BASE_URL || './'
    promise = fetch(`${base}data/grammar.json`)
      .then((r) => (r.ok ? (r.json() as Promise<GrammarData>) : null))
      .catch(() => null)
  }
  return promise
}

let smythPromise: Promise<SmythData | null> | null = null

/** 载入教材例句数据（Smyth 1920，公有领域） */
export function loadSmyth(): Promise<SmythData | null> {
  if (!smythPromise) {
    const base = import.meta.env.BASE_URL || './'
    smythPromise = fetch(`${base}data/smyth.json`)
      .then((r) => (r.ok ? (r.json() as Promise<SmythData>) : null))
      .catch(() => null)
  }
  return smythPromise
}

/** 取某个课程单元的范例词 */
export function paradigmsOfUnit(data: GrammarData, unit: string): import('./types').Paradigm[] {
  return data.paradigms.filter((p) => p.unit === unit)
}
