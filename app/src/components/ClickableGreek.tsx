/**
 * 逐词可点的希腊语文本。
 *
 * 宗教（新约）与哲学/文学/历史共用这一个组件，字号与交互完全一致——
 * 之前两边各写一套，古典那边是静态 <p>，点不了。
 */
export function ClickableGreek({
  text, onWord, className = '',
}: {
  text: string
  onWord: (t: string) => void
  className?: string
}) {
  const toks = text.split(/\s+/).filter(Boolean)
  // 多数古典文本的段落很大，逐个包 <button> 会产生成百上千个节点；
  // 用 fragment + 空格文本节点即可，交互完全一样。
  return (
    <p className={`greek ${className}`}>
      {toks.map((t, i) => (
        <span key={i}>
          <button
            type="button"
            className="rounded px-0.5 transition hover:bg-aegean-100 hover:text-aegean-900 dark:hover:bg-aegean-900/50"
            onClick={() => onWord(t)}
          >
            {t}
          </button>
          {i < toks.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
}
