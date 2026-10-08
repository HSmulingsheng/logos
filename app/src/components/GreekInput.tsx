import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DIGIT_LEGEND, SCHEME_HINT, SCHEME_LABEL, transliterate, type InputScheme,
} from '../lib/greekInput'

/**
 * 希腊语输入框：直接用拉丁键盘打，实时转成希腊语，不必装希腊语输入法。
 *
 * 为什么要自己保留一份「原始拉丁缓冲」，而不是每次对输入框的值做转写：
 * 转写是**逐词**生效的，`t` 会立刻变成 `τ`，等用户再打 `h` 时
 * 已经拼不回 `th`→θ 了（实测 `theos` 会变成 `τἑος`）。
 * 所以这里把用户真正敲的拉丁字符留在 raw 里，每次按键都对整串重新转写，
 * 输入框显示的是转写结果。
 *
 * 退格、粘贴、中间编辑都做了处理；实在对不上时退回「把新值当原始输入」。
 */
export function GreekInput({
  value, onChange, scheme, onEnter, className = '', ...rest
}: {
  value: string
  onChange: (greek: string) => void
  scheme: InputScheme
  onEnter?: () => void
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const rawRef = useRef('')
  const shownRef = useRef(value)
  const [, force] = useState(0)

  // 外部改了值（换题、清空）→ 丢掉缓冲，以外部值为准
  useEffect(() => {
    if (value !== shownRef.current) {
      rawRef.current = ''
      shownRef.current = value
      force((n) => n + 1)
    }
  }, [value])

  const handle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    const prev = shownRef.current
    let raw = rawRef.current
    if (next.startsWith(prev)) {
      raw += next.slice(prev.length)              // 尾部追加
    } else if (prev.startsWith(next)) {
      // 删除：**不能**按「少了几显示字符就少几个原始字符」来算。
      // 转写会改变长度（`th`→θ 是 2 变 1、`ps`→ψ 同理），
      // 那样退格会残留字符（实测清空后再输入会多出一个 τ）。
      // 这里逐个弹出原始字符并重新转写，取第一个刚好等于目标的。
      let found = false
      for (let n = raw.length - 1; n >= 0; n--) {
        const cand = raw.slice(0, n)
        if (transliterate(cand, scheme) === next) { raw = cand; found = true; break }
      }
      if (!found) raw = next
    } else {
      raw = next                                   // 中间编辑：当作新的原始输入
    }
    const greek = transliterate(raw, scheme)
    rawRef.current = raw
    shownRef.current = greek
    onChange(greek)
  }, [onChange, scheme])

  // 切换输入方案时，用新方案重新转写已有的拉丁缓冲
  useEffect(() => {
    if (!rawRef.current) return
    const greek = transliterate(rawRef.current, scheme)
    shownRef.current = greek
    onChange(greek)
  }, [scheme, onChange])

  return (
    <input
      {...rest}
      value={value}
      onChange={handle}
      onKeyDown={(e) => {
        // 只接管 Enter；其余键（含 IME 组合）交给浏览器
        if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() }
      }}
      className={className}
    />
  )
}

/** 输入方案与数字对照说明，放在作答框下方 */
export function GreekInputHint({ scheme, compact = false }: { scheme: InputScheme; compact?: boolean }) {
  return (
    <p className={`text-[11px] leading-relaxed text-ink-400 ${compact ? '' : 'mt-1.5'}`}>
      可直接用**拉丁键盘**输入：{SCHEME_HINT[scheme]}
      {!compact && <> · 数字打变音符号 {DIGIT_LEGEND.map(([d, t]) => `${d}=${t.split(' ')[0]}`).join(' ')}</>}
    </p>
  )
}

export { SCHEME_LABEL }
