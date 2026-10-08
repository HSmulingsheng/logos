/**
 * 语法闯关生成器自检：不经过 UI，直接把每一关的题都生成一遍并校验正确性。
 *
 * 校验点：
 *   1. 每一关都能凑齐 n 道题（数据不足会暴露出来）
 *   2. 选择题的正确答案在选项里唯一（不能出现两个正确答案）
 *   3. 配对题的左右两侧都没有重复
 *   4. 排序题的 items 与 correct 是同一组词形
 *   5. 语料填空题：挖空的词形确实能还原回原句
 *
 * 用 esbuild 打包后由 Node 运行：node scripts/grammar-selftest.mjs
 */
import { readFileSync } from 'node:fs'
import { buildLevel, isCorrect } from '../src/lib/grammar/exercises'
import type { GenContext } from '../src/lib/grammar/exercises'
import { COURSE } from '../src/lib/grammar/course'
import type { GrammarData, SmythData } from '../src/lib/grammar/types'

// 打包后 import.meta.url 指向临时目录，所以用 cwd 相对路径（在 app/ 下运行）
const dataPath = process.env.GRAMMAR_JSON || 'public/data/grammar.json'
const data: GrammarData = JSON.parse(readFileSync(dataPath, 'utf8'))
const smythPath = process.env.SMYTH_JSON || 'public/data/smyth.json'
const smyth: SmythData = JSON.parse(readFileSync(smythPath, 'utf8'))

/** 固定种子的随机数，保证自检结果可复现 */
function mulberry(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const problems: string[] = []
const kindStats: Record<string, number> = {}
let totalExercises = 0

function ctxFor(unitId: string, dataUnits: string[], endingsPos?: string[]): GenContext {
  const paradigms = dataUnits.length
    ? data.paradigms.filter((p) => dataUnits.includes(p.unit))
    : data.paradigms
  const endings = data.endings.filter((g) => !endingsPos || endingsPos.includes(g.pos))
  return {
    paradigms: paradigms.length ? paradigms : data.paradigms,
    endings: endings.length ? endings : data.endings,
    letters: data.letters,
    smyth: smyth.examples.filter((e) => e.u === unitId),
  }
}

for (const unit of COURSE) {
  const ctx = ctxFor(unit.id, unit.dataUnits, unit.endingsPos)
  for (const level of unit.levels) {
    // 跑 5 个不同种子，确保不是碰巧能出题
    for (let seed = 0; seed < 5; seed++) {
      const rng = mulberry(seed * 7919 + 13)
      const exs = buildLevel(level.kinds, level.n, ctx, rng)
      const tag = `${level.id} seed=${seed}`

      if (exs.length < level.n) {
        problems.push(`${tag}: 只生成 ${exs.length}/${level.n} 道（数据不足或生成器返回 null）`)
        continue
      }
      if (exs.length > level.n) problems.push(`${tag}: 生成了 ${exs.length} 道，超过 ${level.n}`)
      totalExercises += exs.length

      for (const ex of exs) {
        kindStats[ex.kind] = (kindStats[ex.kind] ?? 0) + 1

        if (ex.mode === 'choice') {
          const texts = ex.options.map((o) => o.text)
          if (new Set(texts).size !== texts.length) {
            problems.push(`${tag} [${ex.kind}] 选项有重复：${texts.join(' / ')}`)
          }
          const answerText = ex.options.find((o) => o.id === ex.answerId)?.text
          if (!answerText) {
            problems.push(`${tag} [${ex.kind}] answerId 不在选项里`)
          } else if (texts.filter((t) => t === answerText).length !== 1) {
            problems.push(`${tag} [${ex.kind}] 正确答案出现 ${texts.filter((t) => t === answerText).length} 次`)
          }
          // 用 answerId 作答必须判对
          if (!isCorrect(ex, ex.answerId)) problems.push(`${tag} [${ex.kind}] 正确答案判为错`)
          // 用别的选项作答必须判错
          for (const o of ex.options) {
            if (o.id !== ex.answerId && isCorrect(ex, o.id)) {
              problems.push(`${tag} [${ex.kind}] 干扰项 ${o.text} 也被判对`)
            }
          }
          // 语料填空：原句里必须正好有一个空
          if (ex.kind === 'cloze') {
            const blanks = (ex.sentence ?? '').split('_____').length - 1
            if (blanks !== 1) problems.push(`${tag} [cloze] 句子里有 ${blanks} 个空`)
          }
        }

        if (ex.mode === 'match') {
          const l = ex.pairs.map((p) => p.left)
          const r = ex.pairs.map((p) => p.right)
          if (new Set(l).size !== l.length) problems.push(`${tag} [${ex.kind}] 配对左侧重复`)
          if (new Set(r).size !== r.length) problems.push(`${tag} [${ex.kind}] 配对右侧重复`)
          const good = Object.fromEntries(ex.pairs.map((p) => [p.left, p.right]))
          if (!isCorrect(ex, good)) problems.push(`${tag} [${ex.kind}] 正确配对判为错`)
          const bad = { ...good }
          const first = ex.pairs[0]
          bad[first.left] = ex.pairs.find((p) => p.right !== first.right)!.right
          if (isCorrect(ex, bad)) problems.push(`${tag} [${ex.kind}] 错误配对也被判对`)
        }

        if (ex.mode === 'order') {
          if ([...ex.items].sort().join('|') !== [...ex.correct].sort().join('|')) {
            problems.push(`${tag} [${ex.kind}] items 与 correct 不是同一组词形`)
          }
          if (ex.correct.length !== new Set(ex.correct).size) {
            problems.push(`${tag} [${ex.kind}] correct 里有重复词形`)
          }
          if (!isCorrect(ex, ex.correct)) problems.push(`${tag} [${ex.kind}] 正确顺序判为错`)
          const swapped = [...ex.correct]
          if (swapped.length > 1) {
            ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
            if (isCorrect(ex, swapped)) problems.push(`${tag} [${ex.kind}] 错误顺序也被判对`)
          }
        }

        if (ex.kind === 'textbookCloze') {
          const blanks = (ex.sentence ?? '').split('_____').length - 1
          if (blanks !== 1) problems.push(`${tag} [textbookCloze] 句子里有 ${blanks} 个空`)
          // 正确答案必须真的出现在该单元的教材例句里
          const inPool = ctx.smyth.some((e) => e.greek.includes(ex.options.find((o) => o.id === ex.answerId)!.text))
          if (!inPool) problems.push(`${tag} [textbookCloze] 答案不在教材例句中`)
        }
        if (ex.kind === 'textbookMeaning' && !ex.sentence) {
          problems.push(`${tag} [textbookMeaning] 缺少原句`)
        }

        if (ex.mode === 'type') {
          if (!ex.answer.trim()) problems.push(`${tag} [${ex.kind}] 答案为空`)
          if (!isCorrect(ex, ex.answer)) problems.push(`${tag} [${ex.kind}] 标准答案判为错`)
          // 忽略重音也应判对
          if (!isCorrect(ex, ex.answer.normalize('NFD').replace(/\p{M}/gu, ''))) {
            problems.push(`${tag} [${ex.kind}] 省略重音后判为错（${ex.answer}）`)
          }
        }
      }
    }
  }
}

console.log('=== 题型分布 ===')
for (const [k, v] of Object.entries(kindStats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`)
}
console.log(`\n共生成 ${totalExercises} 道题，涉及 ${Object.keys(kindStats).length} 种题型`)
console.log('=== 结果 ===')
if (problems.length === 0) {
  console.log('✅ 全部校验通过')
} else {
  console.log(`❌ ${problems.length} 个问题：`)
  for (const p of problems.slice(0, 25)) console.log('  · ' + p)
  if (problems.length > 25) console.log(`  …还有 ${problems.length - 25} 个`)
}
process.exit(problems.length === 0 ? 0 : 1)
