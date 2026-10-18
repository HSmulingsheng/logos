/** 判题结果横幅（✓ / ✗ + 文案）。语法关卡与单词学习共用同一种视觉表达。 */
export function ResultBanner({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 text-sm font-medium ${
      ok
        ? 'bg-laurel-50 text-laurel-700 dark:bg-laurel-950/40 dark:text-laurel-300'
        : 'bg-wine-50 text-wine-700 dark:bg-wine-950/40 dark:text-wine-300'
    }`}>
      {ok ? '✓ ' : '✗ '}{text}
    </div>
  )
}
