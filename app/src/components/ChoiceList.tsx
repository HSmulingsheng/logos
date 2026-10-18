/**
 * 四选一选项列表。
 *
 * ## 为什么单独抽出来
 *
 * 这段原来是 `Study.tsx` 里的一个局部组件，而 `Listening.tsx` 里
 * **逐字复制了同一份**（同样的四种边框配色、同样的序号方块、同样的对勾/叉）。
 * 唯一的差别是 `Listening` 把 `greek` 写死成 true。
 * 改一次配色要改两处，还容易漏。
 *
 * ## 为什么 LevelRunner 没有用它
 *
 * 语法关卡用的是**另一种交互**：点选之后先进入一个可重答的「错」状态
 * （`wrong`），点「检查」才判定，答错了还能再选。这里没有那个中间态——
 * 点了就立即出结果并锁定。硬把两者塞进一个组件，会得到一个靠布尔开关
 * 分叉的巨型条件渲染，比重复更糟。所以保持独立。
 */
import { Icon } from './ui'

export interface Choice {
  id: number
  text: string
  correct: boolean
}

export interface ChoiceListProps {
  options: Choice[]
  /** 已选中的选项 id；null 表示尚未作答 */
  picked: number | null
  onPick: (id: number, correct: boolean) => void
  /** 选项正文用希腊语排版（听音辨词题的选项是词形，不是释义） */
  greek?: boolean
}

export function ChoiceList({ options, picked, onPick, greek = false }: ChoiceListProps) {
  return (
    <div className="grid gap-2">
      {options.map((o, i) => {
        const isPicked = picked === o.id
        const show = picked !== null
        const cls = !show
          ? 'border-ink-200 bg-white/70 hover:border-aegean-300 hover:bg-aegean-50/60 dark:border-white/10 dark:bg-white/5'
          : o.correct
            ? 'border-laurel-400 bg-laurel-50 dark:border-laurel-700 dark:bg-laurel-950/40'
            : isPicked
              ? 'border-wine-400 bg-wine-50 dark:border-wine-800 dark:bg-wine-950/40'
              : 'border-ink-200 bg-white/50 opacity-50 dark:border-white/10 dark:bg-white/5'
        return (
          <button
            key={o.id}
            disabled={show}
            onClick={() => onPick(o.id, o.correct)}
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${cls}`}
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
              show && o.correct ? 'bg-laurel-500 text-white'
                : show && isPicked ? 'bg-wine-500 text-white'
                  : 'bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300'
            }`}>{i + 1}</span>
            <span className={greek ? 'greek text-xl' : 'text-[15px]'}>{o.text}</span>
            {show && o.correct && <Icon.Check className="ml-auto h-4 w-4 shrink-0 text-laurel-600" />}
            {show && isPicked && !o.correct && <Icon.Close className="ml-auto h-4 w-4 shrink-0 text-wine-500" />}
          </button>
        )
      })}
    </div>
  )
}
