/**
 * 键位提示。
 *
 * ⚠️ `Study.tsx` 里原来有**两个**这样的组件：`Kbd`（第 44 行）与 `Key`（第 543 行），
 * 渲染出来的 `<kbd>` 类名一字不差。两处都用，不同名字，改样式要改两遍。
 * 现在合并到这里。
 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-200 bg-white/70 px-1 text-[10px] text-ink-500 dark:border-white/15 dark:bg-white/10">
      {children}
    </kbd>
  )
}
