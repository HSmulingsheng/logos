import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui'

const KEY = 'greek-welcomed'

/**
 * 首次访问的说明。
 * 这个应用没有账号体系——每个人都是「游客」，进度只存在自己这台设备的浏览器里。
 * 与其让人以为需要注册，不如第一次就把这件事说清楚。
 */
export function Welcome() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setOpen(true)
    } catch { /* 隐私模式下 localStorage 可能不可用，那就每次都不弹 */ }
  }, [])

  const dismiss = () => {
    try { localStorage.setItem(KEY, '1') } catch { /* 忽略 */ }
    setOpen(false)
  }

  if (!open) return null

  // 与 Sheet 同理：portal 到 body，避免受祖先 transform 影响
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-950/45 backdrop-blur-sm" />
      <div className="card-surface animate-fade-up relative z-10 w-full max-w-md rounded-b-none p-6 sm:rounded-2xl">
        <div className="mb-4 text-center">
          <div className="greek mb-2 text-4xl text-aegean-600 dark:text-aegean-300">Α</div>
          <h2 className="text-lg font-semibold">直接开始用，不用注册</h2>
          <p className="mt-1 text-sm text-ink-500">你是这里的游客，没有账号、也不需要账号。</p>
        </div>

        <div className="mb-5 space-y-3 text-sm">
          <Row icon={<Icon.Cards className="h-4 w-4" />} title="进度存在这台设备上">
            学习记录保存在浏览器本地，不会上传到任何服务器。
          </Row>
          <Row icon={<Icon.Spark className="h-4 w-4" />} title="换设备要自己带走">
            清除浏览器数据或换手机，进度不会自动跟过去。
            在「我的 → 数据」里导出备份，在新设备导入即可。
          </Row>
          <Row icon={<Icon.Volume className="h-4 w-4" />} title="全部内容离线可用">
            15,686 个词、发音、例句、语法都在本地。想彻底离线，
            到「我的 → 离线使用」缓存一次即可。
          </Row>
        </div>

        <button className="btn-primary w-full !py-3" onClick={dismiss}>开始使用</button>
        <p className="mt-3 text-center text-[11px] text-ink-400">
          数据来源与许可见「我的 → 关于」
        </p>
      </div>
    </div>,
    document.body,
  )
}

function Row({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-aegean-50 text-aegean-600 dark:bg-aegean-900/40 dark:text-aegean-300">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{children}</p>
      </div>
    </div>
  )
}
