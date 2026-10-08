/** 语法闯关的数据类型（对应 tools/build_app_data.py 产出的 grammar.json） */

export interface Ending {
  end: string
  count: number
  share: number
  words: string[]
}

export interface EndingGroup {
  pos: string
  gram: string
  total: number
  endings: Ending[]
}

export interface Example {
  greek: string
  zh: string
  ref: string
  form: string
  gram: string
  idx: number
}

export interface Paradigm {
  word: string
  pos: string
  unit: string
  bucket: string
  senses: string[]
  freq?: number
  forms: [string, number, string][]
  examples: Example[]
}

export interface Letter {
  up: string
  low: string
  name: string
  sound: string
  audio: string
}

export interface GrammarData {
  endings: EndingGroup[]
  paradigms: Paradigm[]
  letters: Letter[]
}

// ---------------------------------------------------------------- 教材（Smyth）

export interface SmythTarget {
  form: string
  gram: string
  wid: string
  /** 同一词条的其它词形，用来出干扰项 */
  tf: [string, string][]
}

export interface SmythExample {
  /** 所属的 Smyth 小节号 */
  n: number
  greek: string
  /** Smyth 原书英文译文（少数条目原书译文混入 Beta Code，已清空） */
  en: string
  /** 中文译文（自译，以希腊语原文为准） */
  zh?: string
  src: string
  /** 归属的课程单元 */
  u: string
  /** 原始 XML 有讹误，不能进题库 */
  bad?: boolean
  t: SmythTarget
}

export interface SmythSection {
  n: number
  part: string
  chapter: string
  group: string
  title: string
  en: string
}

export interface SmythRange { a: number; b: number; zh: string }

export interface SmythData {
  units: Record<string, { zh: string; ranges: SmythRange[] }>
  sections: SmythSection[]
  examples: SmythExample[]
}

// ---------------------------------------------------------------- 题目模型

export interface ChoiceExercise {
  kind: string
  mode: 'choice'
  prompt: string
  sub?: string
  /** 语料填空题的原句（含 ___）*/
  sentence?: string
  source?: string
  options: { id: string; text: string }[]
  answerId: string
  explain: string
}

export interface TypeExercise {
  kind: string
  mode: 'type'
  prompt: string
  sub?: string
  answer: string
  explain: string
}

export interface MatchExercise {
  kind: string
  mode: 'match'
  prompt: string
  pairs: { left: string; right: string }[]
  explain: string
}

export interface OrderExercise {
  kind: string
  mode: 'order'
  prompt: string
  sub?: string
  items: string[]
  correct: string[]
  explain: string
}

export type Exercise = ChoiceExercise | TypeExercise | MatchExercise | OrderExercise

/** 题型标识 */
export type Kind =
  | 'chooseForm'    // 给语法标签，选词形
  | 'parseForm'     // 给词形，选语法标签
  | 'typeForm'      // 给标签，拼写词形
  | 'matchForms'    // 词形 ↔ 标签 配对
  | 'orderCases'    // 按格序排列
  | 'oddOneOut'     // 找出不同类
  | 'cloze'         // 真实语料填空
  | 'chooseEnding'  // 词尾速查
  | 'endingToGram'  // 词尾 → 语法标签
  | 'letterCase'    // 大小写配对
  | 'letterNeighbor'// 字母顺序
  | 'finalSigma'    // 词尾 ς / σ
  | 'textbookCloze' // 教材例句填空（Smyth）
  | 'textbookForm'  // 教材例句辨形
  | 'textbookMeaning' // 教材例句译义
