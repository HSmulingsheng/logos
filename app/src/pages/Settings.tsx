import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { VOICE_OPTIONS, neuralStatus, neuralProgress, onNeuralStatus } from '../lib/tts'
import { DIGIT_LEGEND, SCHEME_HINT, SCHEME_LABEL, type InputScheme } from '../lib/greekInput'
import { ensureNeural } from '../lib/neuralTts'
import {
  AiError, PROVIDERS, aiReady, cachedCount, clearCache, endpointOf, providerOf, translateGreek,
} from '../lib/aiTranslate'
import { Bar, Icon, Section } from '../components/ui'
import { clearProgress, exportAll, importAll } from '../lib/db'
import {
  cacheAll, clearOfflineCache, fmtBytes, storageEstimate, type OfflineProgress,
} from '../lib/offline'
import type { Settings } from '../types'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-ink-400">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-aegean-500' : 'bg-ink-200 dark:bg-white/15'}`}
      role="switch"
      aria-checked={on}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

function Slider({ value, min, max, step = 1, onChange, suffix }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-ink-200 accent-aegean-500 dark:bg-white/15" />
      <span className="w-12 text-right text-sm font-medium tabular-nums">{value}{suffix}</span>
    </div>
  )
}

export function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { settings, saveSettings, cards, days } = useStore()
  /** AI 翻译的 JSON 输出对模型要求较高，这里挑一句荷马做连通性测试 */
  const [testing, setTesting] = useState(false)
  const [zhCount, setZhCount] = useState<number | null>(null)
  const [showKey, setShowKey] = useState(false)
  useEffect(() => { void cachedCount().then(setZhCount) }, [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [progress, setProgress] = useState<OfflineProgress>({
    total: 0, done: 0, bytes: 0, failed: 0, running: false, phase: '',
  })
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => { void storageEstimate().then(setStorage) }, [])

  const startCache = async () => {
    await cacheAll((p) => {
      setProgress(p)
      if (!p.running) void storageEstimate().then(setStorage)
    })
  }

  const set = (patch: Partial<Settings>) => void saveSettings(patch)

  const learned = [...cards.values()].filter((c) => c.state !== 0).length

  return (
    <div className="animate-fade-up">
      {!embedded && <h1 className="mb-4 text-2xl font-semibold">我的</h1>}

      <Section title="学习计划">
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="每日新词" hint="超过阈值时新词不会进入队列">
            <Slider value={settings.dailyNew} min={5} max={120} step={5} onChange={(v) => set({ dailyNew: v })} suffix=" 个" />
          </Row>
          <Row label="每日复习上限" hint="避免积压时一次复习过多">
            <Slider value={settings.dailyReviewLimit} min={20} max={600} step={20} onChange={(v) => set({ dailyReviewLimit: v })} suffix=" 个" />
          </Row>
          <Row label="目标记忆保持率" hint="FSRS 会据此调整间隔；越高越频繁">
            <Slider value={Math.round(settings.requestRetention * 100)} min={70} max={97}
              onChange={(v) => set({ requestRetention: v / 100 })} suffix="%" />
          </Row>
          <Row label="学习顺序" hint="按课次循序渐进，或按新约词频从高频到低频">
            <div className="flex gap-1 rounded-lg bg-ink-100 p-0.5 dark:bg-white/10">
              {([['lesson', '按课次'], ['frequency', '按词频']] as const).map(([k, label]) => (
                <button key={k}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${settings.orderMode === k ? 'bg-white font-medium shadow-sm dark:bg-white/15' : 'text-ink-500'}`}
                  onClick={() => set({ orderMode: k })}>
                  {label}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </Section>

      <Section title="练习模式" hint="新词一律先做选义题；下面控制是否再加拼写与听音">
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="拼写题" hint="给出释义与发音，拼出希腊语单词（忽略变音符号也算对）">
            <Toggle on={settings.quizSpell} onChange={(v) => set({ quizSpell: v })} />
          </Row>
          <Row label="听音辨词" hint="播放发音，选出对应词形（无录音的词会跳过）">
            <Toggle on={settings.quizAudio} onChange={(v) => set({ quizAudio: v })} />
          </Row>
          <div className="card-surface mb-3 p-3.5 text-[11px] leading-relaxed text-ink-500">
            <div className="mb-1 font-medium text-ink-600 dark:text-ink-300">出题方式（参照「不背单词」）</div>
            <p>每个词要**连续答对 4 次**才算学会；错一次就清零重新累计，
              每次重新出现的间隔逐次拉长。全部词都通过后，才统一进入拼写。</p>
          </div>
          <Row label="希腊语输入方案" hint="作答时可直接用拉丁键盘输入，实时转写成希腊语，无需安装希腊语输入法">
            <select
              value={settings.inputScheme}
              onChange={(e) => set({ inputScheme: e.target.value })}
              className="rounded-lg border border-ink-200 bg-white/80 px-2 py-1.5 text-xs outline-none dark:border-white/10 dark:bg-white/5"
              aria-label="希腊语输入方案"
            >
              {(['ios', 'translit', 'betacode', 'modern'] as InputScheme[]).map((v) => (
                <option key={v} value={v}>{SCHEME_LABEL[v]}</option>
              ))}
            </select>
          </Row>
          <div className="card-surface mb-3 p-3.5 text-[11px] leading-relaxed text-ink-500">
            <div className="mb-1 font-medium text-ink-600 dark:text-ink-300">转写规则（{SCHEME_LABEL[settings.inputScheme as InputScheme]}）</div>
            <p>{SCHEME_HINT[settings.inputScheme as InputScheme]}</p>
            <p className="mt-1.5">
              <b className="text-ink-600 dark:text-ink-300">数字打变音符号</b>：打在元音后面，可叠加 ·
              {' '}{DIGIT_LEGEND.map(([d, t]) => `${d} ${t}`).join(' · ')}
            </p>
            <p className="mt-1.5 text-ink-400">
              例：<span className="greek">logos1</span> → <span className="greek">λογός</span> ·
              {' '}<span className="greek">hēme1ra</span> → <span className="greek">ἡμέρα</span> ·
              {' '}<span className="greek">tōi</span> → <span className="greek">τῳ</span>
            </p>
          </div>
          <Row label="例句朗读引擎" hint="轻量用内置 eSpeak（瞬时、音色机械）；高清用神经语音（需一次性下载约 128MB，音质接近真人）">
            <EnginePicker />
          </Row>
          {settings.speechEngine === 'neural' && (
            <Row label="高清语音语速" hint="模型原速偏快（约 190 词/分）。这里用保音高变速调整，调慢不会变低音。">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={55} max={125} step={1}
                  value={Math.round(settings.neuralRate * 100)}
                  onChange={(e) => set({ neuralRate: Number(e.target.value) / 100 })}
                  className="w-28 accent-aegean-500"
                  aria-label="高清语音语速"
                />
                <span className="w-16 text-right text-xs tabular-nums text-ink-400">
                  {(settings.neuralRate * 100).toFixed(0)}%
                  {settings.neuralRate < 0.72 ? ' 慢' : settings.neuralRate < 0.95 ? ' 适中' : ' 原速'}
                </span>
              </div>
            </Row>
          )}
          <Row label="例句朗读音色" hint="仅「轻量」引擎有效，挑一个听着顺耳的">
            <select
              value={settings.speechVoice}
              onChange={(e) => set({ speechVoice: e.target.value })}
              className="rounded-lg border border-ink-200 bg-white/80 px-2 py-1.5 text-xs outline-none dark:border-white/10 dark:bg-white/5"
              aria-label="例句朗读音色"
            >
              {VOICE_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </Row>
          <Row
            label="还原古音"
            hint="把 φ θ χ 读成送气塞音 [pʰ tʰ kʰ]、ζ 读成 [zd]。eSpeak 的希腊语音素表继承自现代希腊语，默认读成擦音 [f θ x] 与 [z]，与界面标注的阿提卡 IPA 不符——送气一项就涉及 28.2% 的词"
          >
            <Toggle on={settings.restoreAncient} onChange={(v) => set({ restoreAncient: v })} />
          </Row>
          <Row
            label="音高重音"
            hint="eSpeak 只标重音位置、不产生调型（acute 与 circumflex 的输出逐字符相同）。开启后用 TD-PSOLA 在波形上补出阿提卡调型——界面标了重音符号，发音才真的体现出来"
          >
            <Toggle on={settings.prosodyAccent} onChange={(v) => set({ prosodyAccent: v })} />
          </Row>
          {settings.prosodyAccent && (
            <Row label="重音幅度" hint="调型起伏的大小。觉得机械感重就调小，听不出重音就调大——用耳朵定">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={200} step={10}
                  value={Math.round(settings.prosodyAmp * 100)}
                  onChange={(e) => set({ prosodyAmp: Number(e.target.value) / 100 })}
                  className="w-28 accent-aegean-500"
                  aria-label="音高重音幅度"
                />
                <span className="w-14 text-right text-xs tabular-nums text-ink-400">
                  {settings.prosodyAmp === 0 ? '关闭' : `${Math.round(settings.prosodyAmp * 100)}%`}
                </span>
              </div>
            </Row>
          )}
          <Row label="例句朗读语速" hint="例句发音在浏览器里实时合成，觉得快慢不合适可以在这里调">
            <div className="flex items-center gap-2">
              <input
                type="range" min={100} max={240} step={4}
                value={settings.speechRate}
                onChange={(e) => set({ speechRate: Number(e.target.value) })}
                className="w-28 accent-aegean-500"
                aria-label="例句朗读语速"
              />
              <span className="w-14 text-right text-xs tabular-nums text-ink-400">
                {settings.speechRate <= 132 ? '偏慢' : settings.speechRate <= 190 ? '正常' : '偏快'}
              </span>
            </div>
          </Row>
        </div>
      </Section>

      <Section title="卡片显示">
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="自动播放发音" hint="翻卡与进入测试时自动朗读">
            <Toggle on={settings.autoPlay} onChange={(v) => set({ autoPlay: v })} />
          </Row>
          <Row label="显示词形变化" hint="展示该词在新约中实际出现的各种屈折形式">
            <Toggle on={settings.showForms} onChange={(v) => set({ showForms: v })} />
          </Row>
          <Row label="深色模式">
            <Toggle on={settings.theme === 'dark'} onChange={(v) => set({ theme: v ? 'dark' : 'light' })} />
          </Row>
        </div>
      </Section>

      <Section
        title="离线使用"
        hint="装成 App 后即使没有网络也能学习。缓存一次约 80 MB。"
      >
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="存储占用" hint="浏览器为本站分配的缓存空间">
            <span className="text-xs tabular-nums text-ink-500">
              {storage ? `${fmtBytes(storage.usage)} / ${fmtBytes(storage.quota)}` : '读取中…'}
            </span>
          </Row>
          <div className="py-3">
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm">缓存全部词表与发音</div>
                <div className="mt-0.5 text-[11px] leading-snug text-ink-400">
                  {progress.running
                    ? `${progress.phase} ${progress.done} / ${progress.total} · 已下载 ${fmtBytes(progress.bytes)}`
                    : progress.total > 0
                      ? `${progress.phase}：${progress.done - progress.failed} / ${progress.total} 成功，已下载 ${fmtBytes(progress.bytes)}${progress.failed ? `，${progress.failed} 个失败` : ''}`
                      : '把 30 课词表、新约全文与全部发音保存到本机，之后断网也能用'}
                </div>
              </div>
              <button
                className={progress.running ? 'btn-ghost' : 'btn-primary'}
                disabled={progress.running}
                onClick={() => void startCache()}
              >
                {progress.running ? '下载中…' : progress.total > 0 ? '继续' : '开始'}
              </button>
            </div>
            {progress.total > 0 && (
              <Bar value={progress.total ? progress.done / progress.total : 0}
                barClass={progress.running ? 'bg-aegean-500' : 'bg-laurel-500'} />
            )}
          </div>
          <Row label="清除离线缓存" hint="下次打开需要联网重新下载，学习进度不受影响">
            <button className="btn-ghost" onClick={async () => {
              await clearOfflineCache()
              setProgress({ total: 0, done: 0, bytes: 0, failed: 0, running: false, phase: '' })
              setStorage(await storageEstimate())
              setMsg('已清除离线缓存，刷新页面后生效')
            }}>清除</button>
          </Row>
        </div>
      </Section>

      <Section title="AI 翻译" hint="古典文本还没有中文译文时，用你自己的 API Key 现场翻译">
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="服务商" hint="只列出实测允许浏览器直连（CORS）的服务商">
            <select
              className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-ink-800"
              value={settings.aiProvider}
              onChange={(e) => set({ aiProvider: e.target.value, aiModel: '', aiBaseUrl: '' })}
            >
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Row>
          <Row label="接口地址"
            hint={settings.aiProvider === 'custom'
              ? '自建代理或其它 OpenAI 兼容服务；需自行确认允许浏览器跨源请求'
              : '留空即用官方地址'}>
            <input
              className="w-56 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-ink-800"
              placeholder={providerOf(settings.aiProvider).base || 'https://…/v1'}
              value={settings.aiBaseUrl}
              onChange={(e) => set({ aiBaseUrl: e.target.value })}
            />
          </Row>
          <Row label="模型" hint={`留空用默认（当前默认：${providerOf(settings.aiProvider).model || '—'}）`}>
            <input
              className="w-56 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-ink-800"
              placeholder={providerOf(settings.aiProvider).model}
              value={settings.aiModel}
              onChange={(e) => set({ aiModel: e.target.value })}
            />
          </Row>
          <Row label="API Key" hint="只保存在本机，从不上传；请求由浏览器直接发往服务商">
            <div className="flex items-center gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                className="w-44 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-ink-800"
                placeholder="sk-…"
                value={settings.aiKey}
                onChange={(e) => set({ aiKey: e.target.value })}
              />
              <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setShowKey((v) => !v)}>
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
          </Row>
          {providerOf(settings.aiProvider).keyUrl && (
            <Row label="还没有 Key？">
              <a className="text-xs text-aegean-600 hover:underline dark:text-aegean-300"
                href={providerOf(settings.aiProvider).keyUrl} target="_blank" rel="noreferrer">
                到 {providerOf(settings.aiProvider).name} 申请 →
              </a>
            </Row>
          )}
          <Row label="连通性测试" hint="发一句话（荷马《伊利亚特》首行）实际翻一次，验证 Key 是否可用">
            <button className="btn-ghost" disabled={testing || !aiReady(settings)}
              onClick={async () => {
                setTesting(true); setMsg(null)
                try {
                  const r = await translateGreek(settings, ['μῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος'])
                  if (r.error) throw r.error
                  setMsg(`✅ 可用 · 译文：${r.zh[0]}`)
                } catch (e) {
                  const err = e as AiError
                  setMsg(`❌ ${err.message}${err.hint ? '（' + err.hint + '）' : ''}`)
                } finally { setTesting(false) }
              }}>
              {testing ? '测试中…' : aiReady(settings) ? '测试' : '请先填 Key'}
            </button>
          </Row>
          <Row label="已缓存译文" hint="翻译过的段落会缓存在本机，重复阅读不再消耗额度">
            <span className="flex items-center gap-2 text-xs text-ink-500">
              {zhCount === null ? '…' : `${zhCount} 段`}
              {!!zhCount && (
                <button className="btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={async () => { await clearCache(); setZhCount(0); setMsg('已重置缓存计数') }}>
                  重置
                </button>
              )}
            </span>
          </Row>
        </div>
        {!aiReady(settings) && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            不填 Key 也能正常使用其它功能；只是古典文本在缺少内置译文时无法现场翻译。
          </p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
          OpenAI 与 Anthropic 的接口不允许浏览器跨源请求（实测无 CORS 头），
          这个纯静态站没有后端，所以接不了它们，除非你自建代理再用「自定义」。
        </p>
      </Section>

      <Section title="数据">
        <div className="card-surface divide-y divide-ink-100 px-4 dark:divide-white/10">
          <Row label="账号" hint="无需注册；任何人都是游客身份，没有登录、没有云端账号">
            <span className="chip !border-laurel-200 !bg-laurel-50 !text-laurel-700">游客模式</span>
          </Row>
          <Row label="当前进度" hint="本机 IndexedDB 存储，不上传任何服务器">
            <span className="text-sm text-ink-500">已学 {learned} 词 · {days.length} 天记录</span>
          </Row>
          <Row label="导出备份" hint="下载 JSON，可用于换设备或备份">
            <button className="btn-ghost" onClick={async () => {
              const json = await exportAll()
              const blob = new Blob([json], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `greek-vocab-backup-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(a.href)
              setMsg('已导出备份')
            }}>导出</button>
          </Row>
          <Row label="导入备份" hint="合并到当前进度（同词取较新的记录）">
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>导入</button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  await importAll(await f.text(), 'merge')
                  location.reload()
                } catch (err) {
                  setMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`)
                }
              }} />
          </Row>
          <Row label="清空学习进度" hint="不可撤销，词典本身不受影响">
            <button className="btn-ghost !text-wine-600" onClick={async () => {
              if (!confirm('确定清空全部学习进度？此操作不可撤销。')) return
              await clearProgress()
              location.reload()
            }}>清空</button>
          </Row>
        </div>
      </Section>

      <Section title="关于">
        <div className="card-surface space-y-2 p-4 text-xs leading-relaxed text-ink-500">
          <p><b className="text-ink-700 dark:text-ink-200">词表</b>：你自己的 Anki 牌组「Ancient Greek Vocab」，15,686 个 Koine / 古典希腊语词条。</p>
          <p><b className="text-ink-700 dark:text-ink-200">例句</b>：SBLGNT（MorphGNT 词法标注，CC BY-SA 3.0）；中文为和合本（公有领域）；古典语料来自 GLAUx v2.1。</p>
          <p><b className="text-ink-700 dark:text-ink-200">词典释义</b>：Liddell-Scott-Jones《A Greek-English Lexicon》（9th ed.），数字版来自 Perseus Digital Library（<b>CC BY-SA 4.0</b>，署名 + 相同方式共享）。覆盖 15,288 个词条中的 14,781 个，其余回退到牌组原释义。</p>
          <p><b className="text-ink-700 dark:text-ink-200">语法与教材例句</b>：Smyth, <i>A Greek Grammar for Colleges</i>（1920，<b>公有领域</b>）；希腊字母与读音按重构音系。</p>
          <p><b className="text-ink-700 dark:text-ink-200">发音</b>：词条音频由 eSpeak-NG 生成。例句发音有两种引擎——「轻量」用 eSpeak（内置 24MB），「高清」用 Meta MMS-TTS 神经语音（首次需下载 128MB，音质接近真人），都在浏览器里实时合成，不预存音频。</p>
          <p><b className="text-ink-700 dark:text-ink-200">授权提示</b>：高清语音模型为 <b>CC-BY-NC 4.0（非商用）</b>，本项目整体为 GPL-3.0；商用请把引擎切回「轻量」。</p>
          <p><b className="text-ink-700 dark:text-ink-200">调度</b>：FSRS-6，由 ts-fsrs 提供（MIT）。</p>
          <p><b className="text-ink-700 dark:text-ink-200">字体</b>：Gentium（SIL Open Font License 1.1）。</p>
          <p><b className="text-ink-700 dark:text-ink-200">许可证</b>：本应用内置 eSpeak-NG（GPL-3.0），因此<b>整体以 GPL-3.0 发布</b>；再分发时需一并提供源码。</p>
          <p><b className="text-ink-700 dark:text-ink-200">隐私</b>：全部数据保存在本机浏览器，无网络请求（外链词典除外）。</p>
        </div>
      </Section>

      {msg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-xs text-white shadow-lg">
          {msg}
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-ink-300">
        <Icon.Spark className="mr-1 inline h-3 w-3" />
        逻各斯
      </p>
    </div>
  )
}

/**
 * 例句朗读引擎选择。
 * 神经语音的模型 114MB + 运行时 14MB，首次需要下载，所以给出进度与明确提示。
 */
function EnginePicker() {
  const { settings, saveSettings } = useStore()
  const [status, setStatus] = useState(neuralStatus())
  const [pct, setPct] = useState(neuralProgress())
  const [msg, setMsg] = useState('')

  useEffect(() => onNeuralStatus((st, p) => { setStatus(st); setPct(p) }), [])

  const pick = async (v: string) => {
    await saveSettings({ speechEngine: v })
    if (v === 'neural' && status !== 'ready') {
      setMsg('正在下载语音模型…')
      const ok = await ensureNeural()
      setMsg(ok ? '高清语音已就绪' : '下载失败，已回退到轻量引擎')
      setTimeout(() => setMsg(''), 4000)
    }
  }

  const label = status === 'ready' ? '已就绪'
    : status === 'downloading' ? `下载中 ${Math.round(pct)}%`
      : status === 'loading' ? '加载中…'
        : status === 'failed' ? '加载失败' : ''

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex rounded-lg border border-ink-200/70 bg-white/70 p-0.5 dark:border-white/10 dark:bg-white/5">
        {([['espeak', '轻量'], ['neural', '高清']] as const).map(([v, t]) => (
          <button key={v} onClick={() => void pick(v)}
            className={`rounded-[6px] px-2.5 py-1 text-xs transition ${
              settings.speechEngine === v ? 'bg-aegean-500 font-medium text-white' : 'text-ink-500'}`}>
            {t}
          </button>
        ))}
      </div>
      {label && (
        <span className={`text-[10px] ${status === 'failed' ? 'text-wine-500' : 'text-ink-400'}`}>
          {label}{msg ? ` · ${msg}` : ''}
        </span>
      )}
      {status === 'downloading' && (
        <span className="h-1 w-24 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
          <span className="block h-full rounded-full bg-aegean-400 transition-[width]" style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  )
}
