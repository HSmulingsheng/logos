import type { Kind } from './types'

export interface LevelSpec {
  id: string
  title: string
  kinds: Kind[]
  n: number
}

export interface UnitSpec {
  id: string
  title: string
  subtitle: string
  /** 单元主色（Tailwind 类） */
  tint: string
  /** 从 grammar.json 的哪些单元取范例词 */
  dataUnits: string[]
  /** 词尾单元：按词性筛选词尾组 */
  endingsPos?: string[]
  levels: LevelSpec[]
}

/**
 * 语法闯关的课程地图。
 * 顺序即教学顺序：字母 → 冠词 → 三个变格 → 形容词 → 代词 → 动词 → 异相动词 → 词尾总复习。
 * 每关题型都不同，且全部是读写判断，不含读音练习。
 */
export const COURSE: UnitSpec[] = [
  {
    id: 'letters',
    title: '第一章 · 字母与书写',
    subtitle: '认识 24 个字母，学会词尾的 ς',
    tint: 'from-sky-400 to-cyan-500',
    dataUnits: [],
    levels: [
      { id: 'letters-1', title: '大小写配对', kinds: ['letterCase'], n: 5 },
      { id: 'letters-2', title: '字母表顺序', kinds: ['letterNeighbor'], n: 6 },
      { id: 'letters-3', title: '词尾的 ς', kinds: ['finalSigma'], n: 6 },
    ],
  },
  {
    id: 'article',
    title: '第二章 · 定冠词 ὁ ἡ τό',
    subtitle: '新约里出现最多的词，也是所有变格的模板',
    tint: 'from-aegean-400 to-aegean-600',
    dataUnits: ['article'],
    levels: [
      { id: 'article-1', title: '认识冠词形式', kinds: ['chooseForm'], n: 6 },
      { id: 'article-2', title: '判断冠词形式', kinds: ['parseForm', 'chooseForm'], n: 6 },
      { id: 'article-3', title: '配对与拼写', kinds: ['matchForms', 'typeForm'], n: 6 },
      { id: 'article-4', title: '经句里的冠词', kinds: ['cloze', 'orderCases'], n: 6 },
      { id: 'article-5', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'noun2',
    title: '第三章 · 第二变格（-ος / -ον）',
    subtitle: 'λόγος 型与 τέκνον 型',
    tint: 'from-laurel-400 to-laurel-600',
    dataUnits: ['noun2'],
    levels: [
      { id: 'noun2-1', title: '认识主格与属格', kinds: ['chooseForm'], n: 6 },
      { id: 'noun2-2', title: '判断词形', kinds: ['parseForm'], n: 6 },
      { id: 'noun2-3', title: '按格排序', kinds: ['orderCases', 'oddOneOut'], n: 6 },
      { id: 'noun2-4', title: '拼写词形', kinds: ['typeForm', 'matchForms'], n: 6 },
      { id: 'noun2-5', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'noun2-6', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'noun1',
    title: '第四章 · 第一变格（-η / -α）',
    subtitle: 'ἡμέρα 型与 μαθητής 型',
    tint: 'from-amber-400 to-orange-500',
    dataUnits: ['noun1'],
    levels: [
      { id: 'noun1-1', title: '认识词形', kinds: ['chooseForm'], n: 6 },
      { id: 'noun1-2', title: '判断词形', kinds: ['parseForm', 'oddOneOut'], n: 6 },
      { id: 'noun1-3', title: '拼写与配对', kinds: ['typeForm', 'matchForms'], n: 6 },
      { id: 'noun1-4', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'noun1-5', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'noun3',
    title: '第五章 · 第三变格',
    subtitle: 'πατήρ、πνεῦμα、σάρξ… 词干会变的一类',
    tint: 'from-violet-400 to-purple-600',
    dataUnits: ['noun3'],
    levels: [
      { id: 'noun3-1', title: '认识词形', kinds: ['chooseForm'], n: 6 },
      { id: 'noun3-2', title: '判断词形', kinds: ['parseForm'], n: 6 },
      { id: 'noun3-3', title: '找出不同类', kinds: ['oddOneOut', 'chooseForm'], n: 6 },
      { id: 'noun3-4', title: '拼写与配对', kinds: ['typeForm', 'matchForms'], n: 6 },
      { id: 'noun3-5', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'noun3-6', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'adj',
    title: '第六章 · 形容词',
    subtitle: 'πᾶς、πολύς、ἀγαθός 的三性变化',
    tint: 'from-rose-400 to-pink-600',
    dataUnits: ['adj'],
    levels: [
      { id: 'adj-1', title: '认识词形', kinds: ['chooseForm'], n: 6 },
      { id: 'adj-2', title: '判断性数格', kinds: ['parseForm'], n: 6 },
      { id: 'adj-3', title: '排序与配对', kinds: ['orderCases', 'matchForms'], n: 6 },
      { id: 'adj-4', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'adj-5', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'pron',
    title: '第七章 · 代词',
    subtitle: 'αὐτός、ἐγώ、ὅς、οὗτος、τίς',
    tint: 'from-teal-400 to-emerald-600',
    dataUnits: ['pron'],
    levels: [
      { id: 'pron-1', title: '认识词形', kinds: ['chooseForm'], n: 6 },
      { id: 'pron-2', title: '判断词形', kinds: ['parseForm'], n: 6 },
      { id: 'pron-3', title: '拼写与配对', kinds: ['typeForm', 'matchForms'], n: 6 },
      { id: 'pron-4', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'pron-5', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'verb',
    title: '第八章 · 动词',
    subtitle: '人称、时态、语态、语气',
    tint: 'from-indigo-400 to-blue-600',
    dataUnits: ['verb'],
    levels: [
      { id: 'verb-1', title: '认识现在时', kinds: ['chooseForm'], n: 6 },
      { id: 'verb-2', title: '判断人称与时态', kinds: ['parseForm'], n: 6 },
      { id: 'verb-3', title: '不定过去时', kinds: ['chooseForm', 'parseForm'], n: 6 },
      { id: 'verb-4', title: '拼写词形', kinds: ['typeForm'], n: 6 },
      { id: 'verb-5', title: '配对与分类', kinds: ['matchForms', 'oddOneOut'], n: 6 },
      { id: 'verb-6', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'verb-7', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'dep',
    title: '第九章 · 异相动词',
    subtitle: 'γίνομαι、ἔρχομαι… 形式被动、意义主动',
    tint: 'from-fuchsia-400 to-purple-500',
    dataUnits: ['dep'],
    levels: [
      { id: 'dep-1', title: '认识词形', kinds: ['chooseForm'], n: 6 },
      { id: 'dep-2', title: '判断词形', kinds: ['parseForm'], n: 6 },
      { id: 'dep-3', title: '拼写与配对', kinds: ['typeForm', 'matchForms'], n: 6 },
      { id: 'dep-4', title: '经句填空', kinds: ['cloze'], n: 6 },
      { id: 'dep-5', title: '教材例句', kinds: ['textbookCloze', 'textbookForm', 'textbookMeaning'], n: 6 },
    ],
  },
  {
    id: 'endings',
    title: '第十章 · 词尾总复习',
    subtitle: '从真实语料统计出来的词尾分布',
    tint: 'from-slate-400 to-slate-600',
    dataUnits: [],
    endingsPos: ['名词', '形容词', '动词', '异相动词', '代词', '定冠词'],
    levels: [
      { id: 'endings-1', title: '名词与形容词词尾', kinds: ['chooseEnding'], n: 6 },
      { id: 'endings-2', title: '动词词尾', kinds: ['chooseEnding', 'endingToGram'], n: 6 },
      { id: 'endings-3', title: '词尾反向猜', kinds: ['endingToGram'], n: 6 },
    ],
  },
]

/** 全部关卡的平铺顺序，用于解锁判断 */
export const ALL_LEVELS: { unitId: string; level: LevelSpec }[] =
  COURSE.flatMap((u) => u.levels.map((l) => ({ unitId: u.id, level: l })))

export const TOTAL_LEVELS = ALL_LEVELS.length

export function levelIndex(levelId: string): number {
  return ALL_LEVELS.findIndex((x) => x.level.id === levelId)
}
