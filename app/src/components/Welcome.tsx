import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 首次访问时展示的「作者的留言」。
 *
 * 这个应用没有账号体系——每个人都是游客，进度只存在自己这台设备的浏览器里。
 * 与其让人以为需要注册，不如第一次就把来龙去脉和现状讲清楚：
 * 这是个公益项目，功能还很粗糙，欢迎懂行的人一起来做。
 *
 * KEY 带版本号：留言内容有实质改动时递增，让老用户也能看到新的话。
 */
const KEY = 'greek-welcomed-v2'

export function Welcome() {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)   // 正文下方是否还有内容
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true)
    } catch { /* 隐私模式下 localStorage 可能不可用，那就每次都不弹 */ }
  }, [])

  /** 还有没读完的内容时，底部才显示渐隐 + 提示 */
  const sync = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }, [])

  useEffect(() => {
    if (!open) return
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [open, sync])

  const dismiss = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* 忽略 */ }
    setOpen(false)
  }

  if (!open) return null

  // 与 Sheet 同理：portal 到 body，避免受祖先 transform 影响。
  // 留言偏长，正文区独立滚动，按钮始终留在底部可见。
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-950/45 backdrop-blur-sm" />
      <div className="card-surface animate-fade-up relative z-10 flex max-h-[92svh] w-full max-w-md flex-col rounded-b-none p-6 sm:rounded-2xl">
        <h2 className="mb-4 shrink-0 text-center text-lg font-semibold">作者的留言</h2>

        {/* 滚动区就是 flex-1 元素本身。多包一层 h-full 容器会让 flex 约束失效
            （实测矮屏上正文会溢出并压住按钮），所以这里不能套 wrapper。 */}
        <div
          ref={scroller}
          onScroll={sync}
          className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain text-sm leading-relaxed text-ink-600 dark:text-ink-300"
        >
          <p>
            这是一个受「Anki」和「不背单词」启发，运用 DeepSeek 写成的
            <strong className="font-medium text-ink-700 dark:text-ink-200">免费的古希腊语学习网站</strong>。
          </p>

          <p>
            目前，这个网站各方面功能只是初具雏形，也没有注册功能，只能以游客模式学习。
            所有的学习记录保存在浏览器本地，如果清除浏览器数据或更换设备，进度就会丢失。
          </p>

          <p>
            作者缺少计算机专业知识，也不是古典学、语言学的行家里手，
            只是一个对语言学习有兴趣的历史专业本科生，自然做出的成果在许多方面不如人意。
          </p>

          <p>
            我希望更多拥有专业知识的朋友和广大的语言学习者，能参与到开发的进程里，
            为这个网站的完善出一份力。
          </p>

          <p className="border-l-2 border-aegean-300 pl-3.5 text-aegean-800 dark:border-aegean-700 dark:text-aegean-200">
            愿我们的工作能帮助后来者的学习，愿中国的历史学和语言学研究能更加繁荣，
            愿四海五洲的人们能架起文化沟通的桥梁！
          </p>
        </div>

        {/* 滚动提示：盖在正文底部（负 margin 抵消自身占位），滚到底自动消失 */}
        {more && (
          <div className="pointer-events-none -mt-12 flex h-12 shrink-0 items-end justify-center bg-gradient-to-t from-white via-white/85 to-transparent dark:from-ink-950 dark:via-ink-950/85">
            <span className="pb-0.5 text-[11px] text-ink-400">下滑阅读全文 ⌄</span>
          </div>
        )}

        <button className="btn-primary mt-5 w-full shrink-0 !py-3" onClick={dismiss}>开始使用</button>
        <p className="mt-3 shrink-0 text-center text-[11px] text-ink-400">
          数据来源与许可见「我的 → 关于」
        </p>
      </div>
    </div>,
    document.body,
  )
}
