import { translate, type TranslationMessage } from '../../i18n/index.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageUsage,
  MessageStreamEvent,
} from './types.js'
import type { ApiConfig } from '../settings.js'

/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

const baseUrl = (config: ApiConfig) => config.apiBaseUrl.replace(/\/+$/, '')

const v1Url = (config: ApiConfig) => `${baseUrl(config).replace(/\/v1$/, '')}/v1`

const messagesUrl = (config: ApiConfig) => `${v1Url(config)}/messages`

const filesUrl = (config: ApiConfig) => `${v1Url(config)}/files`

const isDeepSeek = (config: ApiConfig) => config.provider === 'deepseek'
const isOpenAI = (config: ApiConfig) => config.provider === 'openai'

const openAiMessages = (body: CreateMessageRequest) => {
  const system =
    typeof body.system === 'string'
      ? body.system
      : body.system.map((block) => block.text).join('\n\n')
  const messages = body.messages.flatMap((message) => {
    if (message.role === 'latest_reminder') {
      return []
    }
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .flatMap((block) =>
              block.type === 'text'
                ? [block.text]
                : []
            )
            .join('')
    return content ? [{ role: message.role, content }] : []
  })
  return [{ role: 'system', content: system }, ...messages]
}

const readOpenAiUsage = (value: unknown): MessageUsage | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown }
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') {
    return undefined
  }
  return {
    input_tokens: usage.prompt_tokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: usage.completion_tokens,
  }
}

const openAiStopReason = (reason: unknown): 'end_turn' | 'max_tokens' =>
  reason === 'length' ? 'max_tokens' : 'end_turn'

/** Convert OpenAI Chat Completions chunks into the app's Anthropic-shaped stream events. */
async function* streamOpenAiMessage(
  config: ApiConfig,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${v1Url(config)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey ?? ''}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: body.model,
      messages: openAiMessages(body),
      stream: true,
      stream_options: { include_usage: true },
      ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
      ...(body.openai_compatible
        ? {
            enable_thinking: body.openai_compatible.enable_thinking,
            enable_search: body.openai_compatible.enable_search,
          }
        : {}),
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  yield {
    type: 'message_start',
    message: {
      id: '',
      model: body.model,
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    },
  }

  let nextBlockIndex = 0
  let thinkingIndex: number | undefined
  let textIndex: number | undefined
  let stopReason: ReturnType<typeof openAiStopReason> = 'end_turn'
  let usage: ReturnType<typeof readOpenAiUsage>
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      if (thinkingIndex !== undefined) {
        yield { type: 'content_block_stop', index: thinkingIndex }
      }
      if (textIndex !== undefined) {
        yield { type: 'content_block_stop', index: textIndex }
      }
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage,
      }
      yield { type: 'message_stop' }
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
      throw new ApiError('stream', data)
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (typeof payload !== 'object' || payload === null) {
      continue
    }
    const chunk = payload as {
      choices?: {
        delta?: { content?: unknown; reasoning_content?: unknown; refusal?: unknown }
        finish_reason?: unknown
      }[]
      usage?: unknown
    }
    usage = readOpenAiUsage(chunk.usage) ?? usage
    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      stopReason = openAiStopReason(choice.finish_reason)
    }
    const delta = choice.delta
    const reasoning =
      body.openai_compatible?.enable_thinking && typeof delta?.reasoning_content === 'string'
        ? delta.reasoning_content
        : ''
    if (reasoning) {
      if (thinkingIndex === undefined) {
        thinkingIndex = nextBlockIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    const content =
      typeof delta?.content === 'string'
        ? delta.content
        : typeof delta?.refusal === 'string'
          ? delta.refusal
          : ''
    if (!content) {
      continue
    }
    if (textIndex === undefined) {
      textIndex = nextBlockIndex++
      yield {
        type: 'content_block_start',
        index: textIndex,
        content_block: { type: 'text', text: '' },
      }
    }
    yield {
      type: 'content_block_delta',
      index: textIndex,
      delta: { type: 'text_delta', text: content },
    }
  }
  throw new ApiError('interrupted', '')
}

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (config: ApiConfig, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': config.apiKey ?? '',
  ...(!isDeepSeek(config) ? { 'anthropic-version': '2023-06-01' } : {}),
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** DeepSeek 用 GET /models 校验（不产生费用）；其余服务在首次聊天请求时校验。 */
export const verifyApiKey = async (config: ApiConfig, signal?: AbortSignal): Promise<void> => {
  if (!isDeepSeek(config)) {
    return
  }
  const apiRoot = baseUrl(config).replace(/\/anthropic(?:\/v1)?$/, '')
  await request(`${apiRoot}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey ?? ''}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  config: ApiConfig,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  if (!isDeepSeek(config)) {
    throw new ApiError('protocol', 'File uploads are only configured for DeepSeek.')
  }
  const response = await request(filesUrl(config), {
    method: 'POST',
    headers: anthropicHeaders(config, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (config: ApiConfig, fileId: string): Promise<void> => {
  await request(`${filesUrl(config)}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(config, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  config: ApiConfig,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (isOpenAI(config)) {
    yield* streamOpenAiMessage(config, body, signal)
    return
  }
  const response = await request(messagesUrl(config), {
    method: 'POST',
    headers: {
      ...anthropicHeaders(config, isDeepSeek(config) && hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
