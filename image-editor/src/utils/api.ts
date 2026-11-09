/**
 * 后端接口客户端。
 *
 * Key 不经过前端 —— 渠道与 Key 都由后端保管，前端只传渠道 ID。
 */

import type { Channel } from '../types'

/**
 * API 根地址。
 * - 开发（vite :5178）：设 VITE_API_BASE=http://127.0.0.1:5179
 * - 生产 / Electron：页面由后端同源托管，默认空串走相对路径
 *   （Electron 端口是动态的，写死 5179 会连错导致「尚无可用渠道」）
 */
const BASE = import.meta.env.VITE_API_BASE ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  })

  const text = await response.text()
  let payload: unknown = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: { message: text } }
  }

  if (!response.ok) {
    const err = payload as { error?: { message?: string }; message?: string }
    throw new Error(err.error?.message ?? err.message ?? `HTTP ${response.status}`)
  }
  return payload as T
}

export const channelsApi = {
  list(): Promise<{ channels: Channel[] }> {
    return request('/api/channels')
  },

  create(input: {
    name: string
    endpoint: string
    apiKey: string
    note?: string
  }): Promise<{ channel: Channel }> {
    return request('/api/channels', { method: 'POST', body: JSON.stringify(input) })
  },

  update(
    id: string,
    input: {
      name?: string
      endpoint?: string
      apiKey?: string
      note?: string
      enabled?: boolean
      sizeViaPrompt?: boolean | null
      qualityPassthrough?: boolean | null
    },
  ): Promise<{ channel: Channel }> {
    return request(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(input) })
  },

  remove(id: string): Promise<{ ok: boolean }> {
    return request(`/api/channels/${id}`, { method: 'DELETE' })
  },

  /**
   * 探测渠道哪些模型未开通。
   *
   * 后端发带 1×1 图的请求：模型没开通时亚秒级返回 model_not_found（不出图不计费）；
   * 可用模型只是超时，标为 `available: null` 不下结论 —— 因为等它出图要花钱。
   * 想确认某个模型能真正出图，用 test()。
   */
  probeModels(
    id: string,
  ): Promise<{
    models: { model: string; available: boolean | null; reason: string }[]
    message?: string
    fetchError?: string
  }> {
    return request(`/api/channels/${id}/models`)
  },

  /**
   * 取消「实测不可用」标记，把模型放回下拉。
   *
   * 用于渠道管理员后来开通了该模型的情况 —— 黑名单只屏蔽不物理删除，
   * 保留恢复的可能。
   */
  unblockModel(channelId: string, model: string): Promise<{ channel: Channel }> {
    const qs = new URLSearchParams({ model }).toString()
    return request(`/api/channels/${channelId}/models/unblock?${qs}`, { method: 'POST' })
  },

  /**
   * 试用尚未出现在渠道声明里的模型（如 gpt-image-2.6）。
   * 明确 model_not_found 时默认拒绝；force=true 可强制加入下拉。
   */
  async tryModel(
    channelId: string,
    input: { model: string; force?: boolean },
  ): Promise<{
    ok: boolean
    model: string
    available: boolean | null
    message: string
    channel: Channel
    canForce?: boolean
  }> {
    const response = await fetch(`${BASE}/api/channels/${channelId}/models/try`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { error: { message: text } }
    }
    if (!response.ok) {
      const err = payload.error as { message?: string } | undefined
      const error = new Error(err?.message ?? (payload.message as string) ?? `HTTP ${response.status}`) as Error & {
        canForce?: boolean
      }
      error.canForce = payload.canForce === true
      throw error
    }
    return payload as {
      ok: boolean
      model: string
      available: boolean | null
      message: string
      channel: Channel
      canForce?: boolean
    }
  },

  removeExtraModel(channelId: string, model: string): Promise<{ channel: Channel }> {
    const qs = new URLSearchParams({ model }).toString()
    return request(`/api/channels/${channelId}/models/extra?${qs}`, { method: 'DELETE' })
  },

  /**
   * 连通性测试。返回耗时与上游错误摘要，不抛异常。
   * @param mode generate 测文生图能力，edit 测图生图能力。
   *              「仅支持文生图」的模型走 edit 会返回 model_not_found，属预期。
   * @returns modelBlocked 为 true 表示后端已把该模型记入渠道黑名单
   *          （渠道声明了但实际不可用），调用方应刷新模型列表。
   */
  test(
    id: string,
    opts: { model?: string; mode?: 'generate' | 'edit' } = {},
  ): Promise<{
    ok: boolean
    status: number
    elapsed: number
    message: string
    modelBlocked?: boolean
  }> {
    const params = new URLSearchParams()
    if (opts.model) params.set('model', opts.model)
    if (opts.mode) params.set('mode', opts.mode)
    const qs = params.toString()
    return request(`/api/channels/${id}/test${qs ? `?${qs}` : ''}`, { method: 'POST' })
  },

  health(): Promise<{ ok: boolean; authRequired: boolean; listening: string }> {
    return request('/api/health')
  },
}

/** 代理转发图生图请求：multipart 体直接交给浏览器发，后端流式转发 */
export function proxyEdit(
  channelId: string,
  form: FormData,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  return fetch(`${BASE}/api/images/edits`, {
    method: 'POST',
    headers: { 'X-Channel-Id': channelId },
    body: form,
    signal: init?.signal,
  })
}

/** 代理转发文生图请求：JSON 体 */
export function proxyGenerate(
  channelId: string,
  body: Record<string, unknown>,
  init?: { signal?: AbortSignal },
): Promise<Response> {
  return fetch(`${BASE}/api/images/generations`, {
    method: 'POST',
    headers: {
      'X-Channel-Id': channelId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  })
}

/** 是否为用户主动取消 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  return e.name === 'AbortError' || /aborted|The user aborted/i.test(e.message ?? '')
}

export const API_BASE = BASE
