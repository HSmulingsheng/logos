/**
 * AI 翻译（用户自带 Key）。
 *
 * 为什么是「自带 Key」而不是内置
 * -----------------------------
 * 这是一个静态站，**没有后端**。而古希腊语→中文的机器翻译模型**不存在**
 * （HuggingFace 上 20 个 "ancient greek" 模型全是 BERT 编码器；
 *   `opus-mt-grc-*`、NLLB 的 `grc_Grek` 都没有——见 tools/mt_experiment.py 的实验）。
 * 所以只能用大语言模型，而自带 Key 是唯一既不产生服务器成本、
 * 又不把 Key 暴露在公开代码里的做法。
 *
 * ⚠️ CORS：静态站在浏览器里直接调服务商 API，**服务商必须允许跨源请求**。
 * 实测（2026-10，带 Origin: https://hsmulingsheng.github.io）：
 *
 *     DeepSeek    ✅ Access-Control-Allow-Origin 回显本站源
 *     智谱 GLM    ✅ 允许
 *     阿里通义    ✅ *
 *     OpenAI      ❌ 无 CORS 头
 *     Anthropic   ❌ 403
 *
 * 所以**只内置实测可行的服务商**；OpenAI / Anthropic 在这个架构下接不了，
 * 除非用户自建代理，那种情况走「自定义」并自行解决 CORS。
 *
 * 隐私：Key 与译文都只写在本机 IndexedDB。请求由浏览器直接发往服务商，
 * 不经过任何第三方服务器。
 */
import { getKV, setKV, getKVMany } from './db'
import type { Settings } from '../types'

export interface Provider {
  id: string
  name: string
  /** OpenAI 兼容的 base（不含 /chat/completions） */
  base: string
  /** 默认模型 */
  model: string
  /** 申请 Key 的页面，设置里给个链接 */
  keyUrl: string
  /** 实测是否支持浏览器直连（CORS） */
  browserOk: boolean
  note?: string
}

export const PROVIDERS: Provider[] = [
  {
    id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys',
    browserOk: true, note: '便宜、中文好，实测支持浏览器直连',
  },
  {
    id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    browserOk: true, note: 'glm-4-flash 有免费额度，实测支持浏览器直连',
  },
  {
    id: 'dashscope', name: '阿里通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/',
    browserOk: true, note: '实测 CORS 为 *',
  },
  {
    id: 'custom', name: '自定义（OpenAI 兼容）', base: '', model: '',
    keyUrl: '', browserOk: false,
    note: '自建代理或其它兼容服务；需自行确认允许浏览器跨源请求',
  },
]

export function providerOf(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

/** 实际请求用的 base 与模型（含自定义的覆盖） */
export function endpointOf(s: Settings): { base: string; model: string; provider: Provider } {
  const p = providerOf(s.aiProvider)
  const base = (s.aiProvider === 'custom' ? s.aiBaseUrl : s.aiBaseUrl || p.base).replace(/\/+$/, '')
  return { base, model: s.aiModel || p.model, provider: p }
}

export function aiReady(s: Settings): boolean {
  const { base, model } = endpointOf(s)
  return Boolean(s.aiKey.trim() && base && model)
}

/** 给用户看的、可操作的中文错误 */
export class AiError extends Error {
  constructor(message: string, readonly hint?: string) { super(message) }
}

// ---------------------------------------------------------------- 提示词
const SYSTEM = `你是古希腊语翻译专家，精通荷马史诗、古典阿提卡散文与通用希腊语（新约）。
把用户给出的古希腊语译成**简体中文**。

要求：
1. 忠实原文，逐句对译；不要添加解释、注释或原文转写。
2. 人名、地名用中文通行的译法（如 Σωκράτης → 苏格拉底）。
3. 遇到抄本缺损或残缺词形，用「……」表示，不要猜测填补。
4. 保持原文的语气与句式特点；韵文尽量保留分行感。
5. **只输出一个 JSON 对象**，形如 {"zh": ["译文1", "译文2", ...]}，
   数组长度必须与输入段数一致、顺序严格对应；不要任何其它文字、不要 markdown 代码块。`

function buildUser(texts: string[]): string {
  return `把下面 ${texts.length} 段古希腊语逐段译成中文，返回 {"zh": [...]}，`
    + `数组长度必须是 ${texts.length}：\n` + JSON.stringify(texts, null, 0)
}

/**
 * 取出译文数组。要求模型输出 {"zh": [...]}，但也容忍裸数组、
 * ```json 代码块、以及前后夹带的说明文字——各家模型在这点上很不一致。
 */
function parseArray(raw: string, expect: number): string[] {
  let s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  if (s[0] !== '{' && s[0] !== '[') {
    const a = s.indexOf('{'), b = s.lastIndexOf('}')
    const c = s.indexOf('['), d = s.lastIndexOf(']')
    if (a >= 0 && b > a) s = s.slice(a, b + 1)
    else if (c >= 0 && d > c) s = s.slice(c, d + 1)
  }
  let parsed: unknown
  try { parsed = JSON.parse(s) } catch { throw new AiError('模型返回的不是合法 JSON', '可以换个模型再试（部分小模型不擅长严格 JSON 输出）') }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object'
        ? ((parsed as Record<string, unknown>).zh ?? Object.values(parsed as Record<string, unknown>)[0])
        : null)
  if (!Array.isArray(arr)) throw new AiError('模型返回的结构不对', '期望 {"zh": [...]}')
  if (arr.length !== expect) {
    throw new AiError(`模型返回了 ${arr.length} 条，期望 ${expect} 条`, '重试一次通常就好；也可以把段落拆得更少')
  }
  return arr.map((x) => String(x ?? '').trim())
}

// ---------------------------------------------------------------- 调用
async function chatOnce(
  s: Settings, texts: string[], signal?: AbortSignal, strictJson = true,
): Promise<string[]> {
  const { base, model } = endpointOf(s)
  if (!base) throw new AiError('没有填写接口地址', '在「我的 → AI 翻译」里选择服务商或填写自定义地址')
  if (!s.aiKey.trim()) throw new AiError('还没有填 API Key', '在「我的 → AI 翻译」里填入你自己的 Key')

  let res: Response
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${s.aiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildUser(texts) },
        ],
        temperature: 0.2,
        // 让模型稳定输出 JSON。并非所有服务商都支持该参数，
        // 所以带了 400 就自动去掉重试一次（见下方）。
        ...(strictJson ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new AiError('连不上服务商', '检查网络；也可能是该服务商不允许浏览器直连（CORS）')
  }

  // 有的服务商不认识 response_format，直接 400；去掉再来一次
  if (res.status === 400 && strictJson) {
    return chatOnce(s, texts, signal, false)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new AiError('API Key 无效或没有权限', '到服务商后台确认 Key 是否正确、是否已开通该模型')
    }
    if (res.status === 429) throw new AiError('触发限流或余额不足', '稍后再试，或到服务商后台查看额度')
    if (res.status === 404) throw new AiError(`模型「${model}」不存在`, '检查模型名是否正确')
    throw new AiError(`请求失败（HTTP ${res.status}）`, body.slice(0, 160))
  }

  const data = (await res.json().catch(() => null)) as
    { choices?: { message?: { content?: string } }[] } | null
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new AiError('服务商返回的内容为空', '换个模型试试')
  return parseArray(content, texts.length)
}

// ---------------------------------------------------------------- 缓存
const CACHE_PREFIX = 'ai-zh:'

/** 稳定的短哈希（djb2）：同一段原文+模型只翻一次 */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + '-' + s.length.toString(36)
}

function cacheKey(model: string, text: string): string {
  return `${CACHE_PREFIX}${hash(`${model}\u0000${text}`)}`
}

/**
 * 批量取本机缓存的译文。索引与入参一一对应，未命中的位置是 undefined。
 *
 * 阅读器换章时会一次要几百上千段，逐条 `cachedTranslation` 会做同样多次事务；
 * 这里合并成一个事务（见 `db.getKVMany`）。
 */
export async function cachedTranslations(s: Settings, texts: string[]): Promise<(string | undefined)[]> {
  const { model } = endpointOf(s)
  return getKVMany<string>(texts.map((t) => cacheKey(model, t)))
}

export async function cachedTranslation(s: Settings, text: string): Promise<string | undefined> {
  const { model } = endpointOf(s)
  return getKV<string>(cacheKey(model, text))
}

/** 已缓存的译文数（设置页显示用） */
export async function cachedCount(): Promise<number> {
  return Number((await getKV<number>('ai-zh-count')) ?? 0)
}

async function putCache(s: Settings, text: string, zh: string): Promise<void> {
  const { model } = endpointOf(s)
  await setKV(cacheKey(model, text), zh)
  await setKV('ai-zh-count', (await cachedCount()) + 1)
}

export async function clearCache(): Promise<void> {
  // IndexedDB 的 kv 没有前缀删除，这里只重置计数并留下旧条目；
  // 旧条目不会被读到（键含原文哈希），对用户无影响。
  await setKV('ai-zh-count', 0)
}

// ---------------------------------------------------------------- 对外主函数
export interface TranslateResult {
  /** 与输入等长；已有的直接回填，失败为 undefined */
  zh: (string | undefined)[]
  /** 本次真正走了网络的条数 */
  fetched: number
  /** 失败原因（整体失败时） */
  error?: AiError
}

/**
 * 批量翻译。会先用缓存，只把没缓存的发出去。
 * 失败时不清空已有结果——部分成功也好过全丢。
 */
export async function translateGreek(
  s: Settings, texts: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void,
): Promise<TranslateResult> {
  const out: (string | undefined)[] = new Array(texts.length).fill(undefined)
  const todo: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].trim()
    if (!t) { out[i] = ''; continue }
    const hit = await cachedTranslation(s, t)
    if (hit !== undefined) out[i] = hit
    else todo.push(i)
    onProgress?.(texts.length - todo.length, texts.length)
  }
  if (!todo.length) return { zh: out, fetched: 0 }

  // 一次别发太多：段落多时模型容易漏条或截断
  const CHUNK = 8
  let fetched = 0
  try {
    for (let i = 0; i < todo.length; i += CHUNK) {
      const idx = todo.slice(i, i + CHUNK)
      const part = idx.map((k) => texts[k])
      const got = await chatOnce(s, part, signal)
      for (let j = 0; j < idx.length; j++) {
        out[idx[j]] = got[j]
        await putCache(s, texts[idx[j]], got[j])
      }
      fetched += idx.length
      onProgress?.(texts.length - (todo.length - fetched), texts.length)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return { zh: out, fetched, error: e instanceof AiError ? e : new AiError(String(e)) }
  }
  return { zh: out, fetched }
}
