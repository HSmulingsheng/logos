/** 古希腊语文本工具 */

/** 去掉变音符号（重音、气号、下加字母等） */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** 归一化：去变音符号 + 统一 sigma + 小写 */
export function foldGreek(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/ς/g, 'σ')
}

/** 仅保留希腊字母与空格，用于拼写核对 */
export function lettersOnly(s: string): string {
  return s.replace(/[^\p{Script=Greek}]/gu, '')
}

/** 更宽松的归一化：处理常见拼写变体（ου/ω、η/ι 等不合并，只处理尾声与重复） */
export function looseKey(s: string): string {
  return lettersOnly(foldGreek(s)).replace(/[·.,;:!?()«»"']/g, '')
}

export interface SpellCheck {
  ok: boolean
  /** 完全一致（含变音符号） */
  exact: boolean
  /** 忽略变音符号后一致 */
  accentOnly: boolean
}

/**
 * 核对拼写答案。
 * 用户很难打出正确的变音符号，因此「忽略变音符号正确」也算对，
 * 但会告知差异，鼓励逐步掌握重音。
 */
export function checkSpelling(input: string, target: string): SpellCheck {
  const a = lettersOnly(input).normalize('NFC')
  const b = lettersOnly(target).normalize('NFC')
  const exact = a === b
  const accentOnly = !exact && foldGreek(a) === foldGreek(b)
  return { ok: exact || accentOnly, exact, accentOnly }
}

/** 给词形加上重音提示，供拼写题展示（显示首尾字母，中间隐藏） */
export function hintOf(word: string): string {
  const chars = [...word]
  if (chars.length <= 2) return chars.join(' ')
  return chars.map((c, i) => (i === 0 || i === chars.length - 1 || c === ' ' ? c : '·')).join('')
}

/** 希腊文按词切分（保留标点） */
export function tokenizeGreek(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

const CASE_ZH: Record<string, string> = { N: '主格', G: '属格', D: '与格', A: '宾格', V: '呼格' }

export { CASE_ZH }
