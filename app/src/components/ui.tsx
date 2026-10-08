import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/* ------------------------------------------------------------------ 图标 */
type IconProps = { className?: string }
const S = (p: IconProps) => ({
  className: p.className ?? 'h-5 w-5',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const Icon = {
  /** 「学习」：学士帽（与"学习"直接相关，取代原来的房子图标） */
  Graduation: (p: IconProps) => (
    <svg {...S(p)}><path d="M2 8.5 12 4l10 4.5-10 4.5z" /><path d="M6 10.8V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5.2" /><path d="M20 9.5v5" /></svg>
  ),
  /** 「我的」：人像（与"我的"直接相关，取代原来的齿轮图标） */
  User: (p: IconProps) => (
    <svg {...S(p)}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c.6-3.6 3.7-5.6 7.5-5.6s6.9 2 7.5 5.6" /></svg>
  ),
  Home: (p: IconProps) => (
    <svg {...S(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></svg>
  ),
  Book: (p: IconProps) => (
    <svg {...S(p)}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5" /></svg>
  ),
  Chart: (p: IconProps) => (
    <svg {...S(p)}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>
  ),
  Gear: (p: IconProps) => (
    <svg {...S(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  Search: (p: IconProps) => (
    <svg {...S(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  ),
  Volume: (p: IconProps) => (
    <svg {...S(p)}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
  ),
  Star: (p: IconProps) => (
    <svg {...S(p)}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /></svg>
  ),
  StarFill: (p: IconProps) => (
    <svg {...S(p)} fill="currentColor"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /></svg>
  ),
  Back: (p: IconProps) => (<svg {...S(p)}><path d="m15 19-7-7 7-7" /></svg>),
  Next: (p: IconProps) => (<svg {...S(p)}><path d="m9 5 7 7-7 7" /></svg>),
  Check: (p: IconProps) => (<svg {...S(p)}><path d="m5 13 4.5 4.5L19 7" /></svg>),
  Close: (p: IconProps) => (<svg {...S(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>),
  Fire: (p: IconProps) => (
    <svg {...S(p)}><path d="M12 3c.5 3-1.5 4.5-2.7 6C8.1 10.5 7 12 7 14a5 5 0 0 0 10 0c0-1.3-.4-2.3-1-3.2-.4 1-1.2 1.7-2 1.7.8-2.3.3-5.5-2-9.5z" /></svg>
  ),
  Pen: (p: IconProps) => (
    <svg {...S(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
  ),
  Ear: (p: IconProps) => (
    <svg {...S(p)}><path d="M7 8a5 5 0 1 1 8.9 3.1c-1 1.2-2.4 1.6-3 2.9-.4.9-.4 2-.9 2.9a2.6 2.6 0 0 1-4.4.4" /><path d="M9 9a3 3 0 1 1 4 2.8" /></svg>
  ),
  Lock: (p: IconProps) => (
    <svg {...S(p)}><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
  ),
  Cards: (p: IconProps) => (
    <svg {...S(p)}><rect x="3" y="6" width="13" height="16" rx="2" /><path d="M8 3h11a2 2 0 0 1 2 2v13" /></svg>
  ),
  List: (p: IconProps) => (
    <svg {...S(p)}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
  ),
  Spark: (p: IconProps) => (
    <svg {...S(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>
  ),
}

/* ------------------------------------------------------------------ 进度环 */
export function Ring({
  value, size = 96, thickness = 8, children, trackClass = 'text-ink-200/70',
  barClass = 'text-aegean-500',
}: {
  value: number
  size?: number
  thickness?: number
  children?: ReactNode
  trackClass?: string
  barClass?: string
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={thickness}
          className={trackClass} stroke="currentColor" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={thickness}
          className={`${barClass} transition-[stroke-dashoffset] duration-500`}
          stroke="currentColor" fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

export function Bar({ value, className = '', barClass = 'bg-aegean-500' }: { value: number; className?: string; barClass?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-200/60 ${className}`}>
      <div className={`h-full rounded-full transition-[width] duration-500 ${barClass}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

export function LevelTag({ level }: { level: string }) {
  const map: Record<string, string> = {
    A2: 'bg-laurel-100 text-laurel-800 border-laurel-200',
    B1: 'bg-aegean-100 text-aegean-800 border-aegean-200',
    B2: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    C1: 'bg-amber-100 text-amber-800 border-amber-200',
    C2: 'bg-wine-100 text-wine-800 border-wine-200',
  }
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${map[level] ?? 'bg-ink-100 text-ink-700 border-ink-200'}`}>
      {level}
    </span>
  )
}

/* ------------------------------------------------------------------ 底部抽屉 */
export function Sheet({
  open, onClose, title, children, onReplay,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** 提供后按 R 会触发（用于重放发音） */
  onReplay?: () => void
}) {
  // Esc 关闭 / R 重放（放在 effect 里，保证不违反 Hooks 规则）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (!onReplay || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'r' && e.key !== 'R') return
      // 正在输入框里打字就不抢这个键
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      onReplay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onReplay])
  if (!open) return null
  // 必须 portal 到 body：页面外层用了 animate-fade-up，动画的 `both` 填充会让
  // transform 永久保留，从而成为 position:fixed 的包含块，把面板推到页面底部（看不见）。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={onClose} />
      <div className="card-surface animate-fade-up relative z-10 max-h-[86vh] w-full overflow-y-auto rounded-b-none p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h3>
          {onReplay && (
            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-ink-400 sm:flex">
              <kbd className="rounded border border-ink-200 bg-white/70 px-1 text-[10px] dark:border-white/15 dark:bg-white/10">R</kbd>
              重放
            </span>
          )}
          <button className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="关闭"><Icon.Close className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="text-4xl">🏛️</div>
      <p className="text-sm text-ink-500">{text}</p>
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  )
}

export function Section({ title, action, hint, children, className = '' }: {
  title: ReactNode; action?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`mb-5 ${className}`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-wide text-ink-700 dark:text-ink-200">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** 分段切换控件（词书/词典、统计/设置 等二选一场景） */
export function Segmented<T extends string>({
  value, onChange, options, className = '',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div className={`mb-4 inline-flex rounded-xl border border-ink-200/70 bg-white/70 p-0.5 dark:border-white/10 dark:bg-white/5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-[10px] px-4 py-1.5 text-sm transition ${
              active
                ? 'bg-aegean-500 font-medium text-white shadow-sm'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
