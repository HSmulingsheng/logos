/**
 * 学习会话逻辑自检：验证「不背单词」式的出题机制。
 *
 * 要验证的三条（就是需求本身）：
 *   1. 一个词必须**连续答对 4 次**才算学会
 *   2. 中间错一次，连对清零、重新累计
 *   3. **全部词辨识通过之后，才轮到拼写**
 *
 * 做法是纯逻辑模拟：按 buildQueue 铺好的队列跑一遍，
 * 每次作答后调用 planRequeue 决定是否重新排队，和 store 里的真实流程一致。
 */
import { buildQueue, planRequeue, RECOGNIZE_KINDS, RECOGNIZE_TARGET } from '../src/lib/session'
import type { CardRecord, SessionStep, Settings, Word } from '../src/types'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++ } else { fail++ }
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
}

const mkWord = (i: number): Word => ({
  i, w: `w${i}`, e: `w${i}`, z: [`释义${i}`], s: [], ls: 1,
} as unknown as Word)

const settings = (n: number, spell = true) => ({
  activeLessons: [1], dailyNew: n, dailyReviewLimit: 0, quizSpell: spell,
  orderMode: 'lesson', inputScheme: 'ios',
} as unknown as Settings)

const today = { day: 'x', newCount: 0, reviewCount: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, words: 0 }

/**
 * 模拟一次完整会话。
 * @param wrongAt 指定「第几次作答该答错」的集合，用来验证清零逻辑
 */
function simulate(wordCount: number, wrongAt: (n: number) => boolean = () => false) {
  const words = Array.from({ length: wordCount }, (_, k) => mkWord(k + 1))
  const q = buildQueue({
    cards: new Map<number, CardRecord>(),
    lessonWords: new Map([[1, words]]),
    settings: settings(wordCount),
    today,
  })
  const queue: SessionStep[] = [...q.steps]
  const streak: Record<number, number> = {}
  const correctRun: Record<number, number> = {}   // 每个词当前连续答对次数
  const best: Record<number, number> = {}         // 历史最高连对
  const quizzed: Record<number, number> = {}      // 每个词被考了几次
  let cursor = 0
  let n = 0
  const spellOrder: number[] = []
  const spellsBeforeAllDone: number[] = []

  while (cursor < queue.length && n < 5000) {
    const step = queue[cursor]
    n++
    if (step.kind === 'spell') {
      spellOrder.push(step.wordId)
      // 出现拼写时，必须所有词都已经达标
      const notDone = words.filter((w) => (correctRun[w.i] ?? 0) < RECOGNIZE_TARGET)
      if (notDone.length) spellsBeforeAllDone.push(step.wordId)
      cursor++
      continue
    }
    if (!RECOGNIZE_KINDS.includes(step.kind)) { cursor++; continue }

    quizzed[step.wordId] = (quizzed[step.wordId] ?? 0) + 1
    const wrong = wrongAt(n)
    const prev = streak[step.wordId] ?? 0
    const next = wrong ? 0 : prev + 1
    streak[step.wordId] = next
    correctRun[step.wordId] = next
    best[step.wordId] = Math.max(best[step.wordId] ?? 0, next)

    const plan = planRequeue(step, next, queue.slice(cursor + 1))
    if (plan) {
      const at = cursor + 1 + plan.offset
      if (at > queue.length) throw new Error(`插入位置越界: ${at} > ${queue.length}`)
      queue.splice(at, 0, plan.step)
    }
    cursor++
  }
  return { words, quizzed, correctRun, best, spellOrder, spellsBeforeAllDone, steps: n, spellCount: spellOrder.length }
}

console.log('=== 1) 全部答对：每个词恰好连对 4 次后进入拼写 ===')
{
  const r = simulate(4)
  const allFour = r.words.every((w) => (r.best[w.i] ?? 0) >= RECOGNIZE_TARGET)
  check('每个词都达到连对 4 次', allFour, `各词最高连对 ${r.words.map((w) => r.best[w.i] ?? 0).join(',')}`)
  check('拼写恰好覆盖全部词', r.spellCount === 4, `${r.spellCount} 个拼写步骤`)
  check('没有任何拼写出现在辨识完成之前', r.spellsBeforeAllDone.length === 0,
    r.spellsBeforeAllDone.length ? `违规 ${r.spellsBeforeAllDone.length} 次` : '不变式成立')
  const quizCounts = r.words.map((w) => r.quizzed[w.i])
  check('每个词被考的次数 = 连对目标', quizCounts.every((c) => c === RECOGNIZE_TARGET),
    `各词答题次数 ${quizCounts.join(',')}`)
}

console.log('\n=== 2) 中途答错：连对清零、重新累计 ===')
{
  // 第 3 次作答答错（此时某个词应该已经连对 2 次，会被清零）
  const r = simulate(3, (n) => n === 3 || n === 9)
  check('答错后仍需连对 4 次', r.words.every((w) => (r.best[w.i] ?? 0) >= RECOGNIZE_TARGET),
    `各词最高连对 ${r.words.map((w) => r.best[w.i] ?? 0).join(',')}`)
  check('答错使答题次数多于连对目标', r.words.some((w) => r.quizzed[w.i] > RECOGNIZE_TARGET),
    `各词答题次数 ${r.words.map((w) => r.quizzed[w.i]).join(',')}`)
  check('拼写仍然在全部辨识之后', r.spellsBeforeAllDone.length === 0)
}

console.log('\n=== 3) 拼写关闭时不出拼写题 ===')
{
  const words = [mkWord(1), mkWord(2)]
  const q = buildQueue({
    cards: new Map<number, CardRecord>(),
    lessonWords: new Map([[1, words]]),
    settings: settings(2, false),
    today,
  })
  check('quizSpell=false 时队列里没有拼写', q.steps.every((s) => s.kind !== 'spell'))
}

console.log('\n=== 4) 重排的间隔随连对次数递增 ===')
{
  // 用 20 个词：只有队列足够长，插入位才不会被拼写区「顶住」而恒定
  const words = Array.from({ length: 20 }, (_, k) => mkWord(k + 1))
  const q = buildQueue({
    cards: new Map<number, CardRecord>(),
    lessonWords: new Map([[1, words]]),
    settings: settings(20),
    today,
  })
  const rest = q.steps.slice(1)
  const gaps = [0, 1, 2, 3].map((k) => planRequeue(q.steps[0], k, rest)?.offset ?? -1)
  check('连对越多，下次出现越靠后', gaps[1] < gaps[2] && gaps[2] < gaps[3],
    `连对 0/1/2/3 的插入位 ${gaps.join(' → ')}`)
  check('重排插入位不越过拼写区',
    Math.max(...gaps) <= rest.findIndex((x) => x.kind === 'spell'),
    `最大插入位 ${Math.max(...gaps)}，拼写区在第 ${rest.findIndex((x) => x.kind === 'spell')} 位`)
}

console.log(`\n会话逻辑自检：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
