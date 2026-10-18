/** 应用数据模型 */

/** 例句: [希腊语原文, 英文出处, 中文出处, 中文译文, 来源(0=卡片精选 1=SBLGNT 2=古典语料), 命中词下标, 命中词语法] */
export type Example = [
  string, string, string, string, 0 | 1 | 2, number[], string[],
]

/** 词形: [形式, 出现次数, 语法] */
export type Form = [string, number, string]

export interface Word {
  /** note id */
  i: number
  /** 词形（词典形） */
  w: string
  /** 带重音/长音标记的增强形式 */
  e?: string
  /** 国际音标（古典阿提卡重建 Probert 2010；不含方括号，音节用 . 分隔） */
  ipa?: string
  /** 英文义项 */
  s: string[]
  /** 中文义项 */
  z: string[]
  /** 词性（英文） */
  p?: string
  /** 词性（中文） */
  pz?: string
  /** 性别 */
  g?: string
  /** 新约出现次数 */
  fq?: number
  /** 新约词频排名（按出现次数换算） */
  fr?: number
  /** Strong 编号 */
  st?: string
  /** 音频文件名 */
  au?: string
  /** BibleHub 链接 */
  bh?: string
  /** Logeion 链接 */
  lg?: string
  /** 主要形式 / 词干 */
  cp?: string[]
  /** [前缀, 后缀] */
  af?: [string[], string[]]
  /** 其余标签（deponent / cognate / Hebrew ...） */
  tg?: string[]
  /** 同源英语词 */
  rl?: string[]
  /** 备注 */
  nt?: string
  /** 异体形式 */
  alt?: string[]
  /** 词形变化 */
  fm?: Form[]
  /** 例句 */
  ex?: Example[]
  /** 所属课次（加载时注入，不落盘） */
  ls?: number
}

export interface Lesson {
  order: number
  /** 连续显示序号（原牌组缺第 22 课，order 会跳号） */
  seq?: number
  level: string
  /** 原 Anki 牌组名（英文） */
  title: string
  /** 中文名（按课程实际内容命名） */
  titleZh?: string
  file: string
  count: number
  withExamples: number
  withAudio: number
  withZh: number
}

export interface BookRef {
  zh: string
  en: string
  file: string
  count: number
}

export interface Manifest {
  version: number
  source: string
  totalWords: number
  totalWithExamples: number
  totalWithAudio: number
  totalWithZh: number
  levels: string[]
  lessons: Lesson[]
  books: BookRef[]
}

export interface LessonData {
  order: number
  /** 连续显示序号（原牌组缺第 22 课，order 会跳号） */
  seq?: number
  level: string
  /** 原 Anki 牌组名（英文） */
  title: string
  /** 中文名（按课程实际内容命名） */
  titleZh?: string
  words: Word[]
}

/** 检索索引条目: [id, 词形, 归一键, 课号, 首义] */
/**
 * 轻量检索索引：[id, 词形, 折叠词形（去变音，供搜索）, 课程 order, 中文释义摘要, 国际音标]
 * 最后两项是后加的，字段顺序不能变——索引是数组而非对象，就是为了省体积。
 */
export type IndexEntry = [number, string, string, number, string, string]

export interface NtVerse {
  b: string
  be: string
  c: number
  v: number
  g: string
  z: string
}

export interface NtBook {
  book: string
  bookEn: string
  verses: NtVerse[]
}

/** 学习卡片（持久化到 IndexedDB） */
export interface CardRecord {
  id: number
  lesson: number
  /** FSRS 状态 */
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: number
  /** 业务字段 */
  introduced: number
  fav?: 0 | 1
  suspended?: 0 | 1
  /** 复习次数 / 拼写错误次数（用于难词判定） */
  wrong?: number
  /** 累计停留毫秒 */
  ms?: number
}

export interface ReviewLogRecord {
  /** 自增由 idb 处理 */
  id?: number
  cardId: number
  lesson: number
  rating: number
  state: number
  day: string
  ts: number
  mode: SessionStep['kind']
  ms: number
  scheduled_days: number
  stability: number
  difficulty: number
  /** 预测可回忆概率 */
  retrievability?: number
}

export interface DayStat {
  day: string
  newCount: number
  reviewCount: number
  again: number
  hard: number
  good: number
  easy: number
  ms: number
  words: number
}

export interface Settings {
  dailyNew: number
  dailyReviewLimit: number
  requestRetention: number
  /** 学习步骤（分钟） */
  learningSteps: string[]
  autoPlay: boolean
  showForms: boolean
  quizSpell: boolean
  /** 例句朗读语速（eSpeak rate）：120 偏慢，168 接近自然 */
  speechRate: number
  /** 例句朗读音色（eSpeak voice 变体） */
  speechVoice: string
  /** 例句朗读引擎：'espeak' 轻量 / 'neural' 高清（需一次性下载模型） */
  speechEngine: string
  /** 高清引擎的语速（0.5–1.4，1.0 为模型原速）。原速偏快，默认 0.82 */
  neuralRate: number
  /** 希腊语输入方案：'ios'（iOS 键盘键位）| 'translit'（按读音音译）| 'betacode' | 'modern' */
  inputScheme: string
  quizAudio: boolean
  /** 学习顺序：按课次 / 按词频 */
  orderMode: 'lesson' | 'frequency'
  theme: 'light' | 'dark'
  /** 已激活的多本词书（课号） */
  activeLessons: number[]

  /**
   * 例句朗读时给 eSpeak 补上音高重音（阿提卡重建的调型）。
   * eSpeak 完全没实现音高重音——acute 与 circumflex 的输出逐字符相同，
   * 而界面是标重音符号的。开启后「标了却念不出来」的问题才解决。
   */
  prosodyAccent: boolean
  /** 音高重音的幅度倍率（1.0 为默认）。用耳朵定，介意机械感就调小 */
  prosodyAmp: number
  /**
   * 还原古音：把 φ θ χ 读成送气塞音 [pʰ tʰ kʰ]、ζ 读成 [zd]。
   * eSpeak 的希腊语音素表继承自现代希腊语，默认把这些读成擦音 [f θ x] 与 [z]，
   * 与界面标注的阿提卡 IPA 不符（送气一项就涉及 28.2% 的词）。
   */
  restoreAncient: boolean
  /** 文本朗读模式：'sentence' 逐句（默认）| 'continuous' 连播 | 'paragraph' 整段 */
  readMode: 'sentence' | 'continuous' | 'paragraph'

  // ---- AI 翻译（自带 Key）----
  // 只存在本机 IndexedDB，**从不上传**；浏览器直连服务商，
  // 所以必须选支持 CORS 的服务商（见 lib/aiTranslate.ts 的说明）。
  /** 服务商 id，见 aiTranslate.ts 的 PROVIDERS */
  aiProvider: string
  /** 自定义服务商的 OpenAI 兼容地址（provider='custom' 时使用） */
  aiBaseUrl: string
  /** 模型名 */
  aiModel: string
  /** 用户自己的 API Key */
  aiKey: string
}

export type SessionStepKind =
  | 'learn'      // 新词：翻卡自评认识与否
  | 'review'     // 复习：翻卡四档自评
  | 'choice'     // 选义
  | 'spell'      // 拼写
  | 'audio'      // 听音辨义
  | 'recall'     // 看义回想词形（自评）

export interface SessionStep {
  kind: SessionStepKind
  wordId: number
  lesson: number
  /** 该步骤属于「新词」还是「复习」阶段 */
  phase: 'new' | 'review'
  /** 名词性：同一词的多步（学习 + 测试） */
  groupId: number
  /**
   * 是不是这张卡的**首次**曝光。
   *
   * 用来区分「本来就在队列里的一题」与「答错后重新排进来的那一题」。
   * 每日复习额度只应该被首次曝光消耗 —— 否则一张卡在一轮里被重排 3 次，
   * `day.reviewCount` 就涨 3，把当天的复习预算提前吃光。
   */
  first: boolean
}
