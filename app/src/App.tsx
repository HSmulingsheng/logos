import { useEffect, useState, type ReactElement } from 'react'
import { useStore } from './store/useStore'
import { Icon, Ring } from './components/ui'
import { Welcome } from './components/Welcome'
import { setProsody, setSpeechRate, setSpeechVoice, setSpeechEngine, warmupNeural } from './lib/tts'
import { setNeuralRate } from './lib/neuralTts'
import { Learn, type LearnView } from './pages/Learn'
import { Mine, type MineView } from './pages/Mine'
import { Reader } from './pages/Reader'
import { Study } from './pages/Study'

type Tab = 'learn' | 'mine'
type Overlay = null | 'study' | 'reader'

const TABS: { id: Tab; label: string; icon: (p: { className?: string }) => ReactElement }[] = [
  { id: 'learn', label: '学习', icon: Icon.Graduation },
  { id: 'mine', label: '我的', icon: Icon.User },
]

export default function App() {
  const { ready, error, init, settings, queue, cursor } = useStore()
  // 语速是模块级状态（合成时读取），设置变化时同步过去
  useEffect(() => { setSpeechRate(settings.speechRate) }, [settings.speechRate])
  useEffect(() => { setSpeechVoice(settings.speechVoice) }, [settings.speechVoice])
  useEffect(() => { setSpeechEngine(settings.speechEngine) }, [settings.speechEngine])
  useEffect(() => { setNeuralRate(settings.neuralRate) }, [settings.neuralRate])
  useEffect(() => {
    setProsody(settings.prosodyAccent, settings.prosodyAmp)
  }, [settings.prosodyAccent, settings.prosodyAmp])

  // 选高清引擎时提前把模型加载好：会话创建要 ~1 秒，
  // 放在用户点击之前做完，点击时就能直接推理
  useEffect(() => {
    if (!ready || settings.speechEngine !== 'neural') return
    // 尽早预热：会话创建 + 首次推理合计约 1.8 秒，越早做完越好。
    // 用 requestIdleCallback 避免和首屏渲染抢主线程。
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const schedule = () => warmupNeural()
    const t = ric
      ? (ric(schedule, { timeout: 800 }), 0)
      : window.setTimeout(schedule, 200)
    return () => { if (t) clearTimeout(t) }
    return () => clearTimeout(t)
  }, [ready, settings.speechEngine])

  const [tab, setTab] = useState<Tab>('learn')
  // 点底部菜单时把当前板块重置到顶层（例如从「词典」子页回到单词首页）。
  // 这也是通行做法：点已选中的标签就回到该板块的首页。
  const [resetAt, setResetAt] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [learnView, setLearnView] = useState<LearnView>('vocab')
  const [readerAt, setReaderAt] = useState<{ bookIdx?: number; chapter?: number }>({})
  // 子视图状态提到这里，切换底部导航后回来仍停在原来的分栏
  const [mineView, setMineView] = useState<MineView>('stats')

  useEffect(() => { void init() }, [init])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
  }, [settings.theme])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card-surface max-w-md p-6 text-center">
          <div className="mb-2 text-3xl">⚠️</div>
          <h1 className="mb-1 text-lg font-semibold">加载失败</h1>
          <p className="text-sm text-ink-500">{error}</p>
          <p className="mt-3 text-xs text-ink-400">
            请确认 <code>public/data/</code> 已生成（运行 <code>python3 tools/build_app_data.py</code>）
          </p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Ring value={0.72} size={72} thickness={6}>
          <span className="greek text-2xl">Α</span>
        </Ring>
        <p className="text-sm text-ink-500">正在装载词典与学习进度…</p>
      </div>
    )
  }

  const studying = overlay === 'study'
  const inSession = queue.length > 0 && cursor < queue.length

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
      <main className={`flex-1 px-4 pb-28 pt-5 sm:px-6 ${studying ? 'pb-4' : ''}`}>
        {tab === 'learn' && (
          <Learn
            view={learnView}
            setView={setLearnView}
            onStudy={() => setOverlay('study')}
            onReader={(bookIdx, chapter) => { setReaderAt({ bookIdx, chapter }); setOverlay('reader') }}
            resetAt={resetAt}
          />
        )}
        {tab === 'mine' && <Mine view={mineView} setView={setMineView} />}
      </main>

      {/* 底部导航 */}
      {!studying && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/60 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-ink-950/80">
          <div className="mx-auto flex w-full max-w-3xl items-stretch">
            {TABS.map((t) => {
              const active = tab === t.id
              const I = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => { setTab(t.id); setResetAt((x) => x + 1) }}
                  className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] transition ${
                    active ? 'text-aegean-600 dark:text-aegean-300' : 'text-ink-400 hover:text-ink-600'
                  }`}
                >
                  <I className="h-5 w-5" />
                  <span className={active ? 'font-semibold' : ''}>{t.label}</span>
                  {active && t.id === 'learn' && inSession && (
                    <span className="absolute mt-[-38px] ml-6 h-1.5 w-1.5 rounded-full bg-wine-500" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>
      )}

      {!studying && overlay === null && <Welcome />}

      {studying && <Study onExit={() => setOverlay(null)} />}
      {overlay === 'reader' && (
        <Reader onExit={() => setOverlay(null)} initialBookIdx={readerAt.bookIdx} initialChapter={readerAt.chapter} />
      )}
    </div>
  )
}
