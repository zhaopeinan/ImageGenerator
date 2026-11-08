/**
 * 图像编辑器后端。
 *
 * 职责边界很窄，只做三件事：
 *   1. 存渠道与 API Key（Key 不下发到浏览器）
 *   2. 把 /api/images/edits 流式代理到上游渠道
 *   3. 托管前端静态文件
 *
 * 默认只监听 127.0.0.1，局域网内其他机器访问不到。
 * 传环境变量 HOST=0.0.0.0 可放开，此时应设置 ACCESS_TOKEN。
 */

import http from 'node:http'
import { createReadStream, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

import {
  createChannel,
  deleteChannel,
  getChannel,
  hasUsableKey,
  isValidEndpoint,
  listChannels,
  listModels,
  markModelUnavailable,
  removeExtraModel,
  reorderChannels,
  toPublic,
  tryExtraModel,
  updateChannel,
} from './channels.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'dist')

const PORT = Number(process.env.PORT ?? 5179)
const HOST = process.env.HOST ?? '127.0.0.1'
const ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? ''

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: { message } })
}

/** 读取并解析 JSON 请求体，带体积上限 */
function readJSONBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(new Error(`请求体不是合法 JSON：${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

/** 读取请求体为 Buffer，带体积上限 */
function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`请求体过大（超过 ${Math.round(limit / 1024 / 1024)}MB）`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * 可选访问令牌。
 * 监听 127.0.0.1 时不需要；一旦放开到 0.0.0.0 就强烈建议设置。
 */
function authorized(req) {
  if (!ACCESS_TOKEN) return true
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-access-token']
  return token === ACCESS_TOKEN
}

// ------------------------------------------------------------------ 路由

/**
 * 取消「实测不可用」标记。
 *
 * 渠道管理员后来开通了该模型时，用户可以在渠道管理里点「恢复」把它放回下拉 ——
 * 所以黑名单只做屏蔽不做物理删除，保留恢复的可能。
 *
 * 路径形如 /api/channels/:id/models/:model/unblock
 * （模型名含点号，用 URL 编码传）
 */
async function handleModelUnblock(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 5 || segments[3] !== 'models' || segments[4] !== 'unblock') {
    return false
  }

  const id = segments[2]
  const model = decodeURIComponent(url.searchParams.get('model') ?? '')
  if (!id || !model) {
    sendError(res, 400, '缺少渠道 id 或模型名')
    return true
  }

  const channel = await markModelUnavailable(id, model, null)
  if (!channel) {
    sendError(res, 404, '渠道不存在')
    return true
  }
  sendJSON(res, 200, { channel })
  return true
}

async function handleChannelsAPI(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean)
  // segments: ['api', 'channels', id?]

  if (req.method === 'GET' && segments.length === 2) {
    sendJSON(res, 200, { channels: await listChannels() })
    return true
  }

  // 渠道重排序。必须排在「PUT 单条更新」之前，
  // 否则 /api/channels/order 会被当成 id="order" 的更新请求。
  // 注意拆分：/api/channels/order → ['api','channels','order']，长度 3。
  if (req.method === 'PUT' && segments.length === 3 && segments[2] === 'order') {
    const body = await readJSONBody(req)
    const channels = await reorderChannels(body.ids)
    sendJSON(res, 200, { channels: channels.map(toPublic) })
    return true
  }

  if (req.method === 'POST' && segments.length === 2) {
    const body = await readJSONBody(req)
    if (!body.name || !body.endpoint) {
      sendError(res, 400, '名称与端点不能为空')
      return true
    }
    if (!isValidEndpoint(body.endpoint)) {
      sendError(res, 400, '端点格式不合法，应填域名，例如 https://api.example.com')
      return true
    }
    const channel = await createChannel(body)
    sendJSON(res, 201, { channel })
    return true
  }

  const id = segments[2]
  if (!id) return false

  // 可用模型探测。必须排在通用匹配之前，否则会被截胡。
  // 路径形如 /api/channels/:id/models → segments = ['api','channels',id,'models']
  if (req.method === 'GET' && segments.length === 4 && segments[3] === 'models') {
    const channel = await getChannel(id)
    if (!channel) {
      sendError(res, 404, '渠道不存在')
      return true
    }
    if (!hasUsableKey(channel)) {
      sendJSON(res, 200, { models: [], message: '该渠道尚未填入有效 API Key' })
      return true
    }
    try {
      const models = await listModels(channel)
      sendJSON(res, 200, { models, channel: id })
    } catch (err) {
      sendJSON(res, 200, { models: [], message: err.message })
    }
    return true
  }

  // 试用新模型：POST /api/channels/:id/models/try
  if (req.method === 'POST' && segments.length === 5 && segments[3] === 'models' && segments[4] === 'try') {
    const body = await readJSONBody(req)
    const result = await tryExtraModel(id, body.model, { force: Boolean(body.force) })
    if (!result.ok) {
      sendJSON(res, result.status ?? 400, {
        error: { message: result.message },
        canForce: result.canForce === true,
        model: result.model,
      })
      return true
    }
    sendJSON(res, 200, result)
    return true
  }

  // 移除手动试用模型：DELETE /api/channels/:id/models/extra?model=
  if (req.method === 'DELETE' && segments.length === 5 && segments[3] === 'models' && segments[4] === 'extra') {
    const model = decodeURIComponent(url.searchParams.get('model') ?? '')
    if (!model) {
      sendError(res, 400, '缺少模型名')
      return true
    }
    const channel = await removeExtraModel(id, model)
    if (!channel) {
      sendError(res, 404, '渠道不存在')
      return true
    }
    sendJSON(res, 200, { channel })
    return true
  }

  if (req.method === 'PUT' && segments.length === 3) {
    const body = await readJSONBody(req)
    if (body.endpoint !== undefined && !isValidEndpoint(body.endpoint)) {
      sendError(res, 400, '端点格式不合法，应填域名，例如 https://api.example.com')
      return true
    }
    const channel = await updateChannel(id, body)
    if (!channel) {
      sendError(res, 404, '渠道不存在')
      return true
    }
    sendJSON(res, 200, { channel })
    return true
  }

  if (req.method === 'DELETE' && segments.length === 3) {
    const ok = await deleteChannel(id)
    if (!ok) {
      sendError(res, 404, '渠道不存在')
      return true
    }
    sendJSON(res, 200, { ok: true })
    return true
  }

  return false
}

/** 连通性测试：只发一个极小的 images/edits 请求，确认端点与 Key 可用 */
/**
 * 「该模型在本渠道用不了」的判据。
 *
 * 覆盖两类实测到的情形（见 handleChannelTest 内的注释）：
 *   - 模型未在该渠道启用 / 未配置账号
 *   - 该平台不提供 Images 接口（如 gemini 系列走 chat/completions）
 *
 * 刻意**不**包含：账号额度耗尽、网络失败、参数错误 —— 那些是临时状态，
 * 记进黑名单会误伤正常可用的模型。
 */
const MODEL_UNUSABLE_RE =
  /is not enabled for this channel|not supported by any configured account|Images API is not supported for this platform/i

async function handleChannelTest(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[2]
  const channel = await getChannel(id)
  if (!channel) {
    sendError(res, 404, '渠道不存在')
    return
  }
  if (!hasUsableKey(channel)) {
    sendJSON(res, 200, {
      ok: false,
      status: 0,
      elapsed: 0,
      message: '尚未填入有效 API Key（当前还是占位符）',
    })
    return
  }

  // 1x1 透明 PNG
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )

  // boundary 值不含连字符；body 里的分隔符才加 `--`。
  // 两者必须一致，差一个连字符会导致上游解析失败。
  const boundary = 'imageeditortestboundary'
  const parts = []
  const field = (name, value) => {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  // 模型可从 query 传入：不同渠道开通的子模型不同，
  // 写死 gpt-image-2 会让「只开通了别的模型」的渠道误判为不可用。
  const testModel = url.searchParams.get('model') || 'gpt-image-2'
  field('model', testModel)
  field('prompt', 'test')
  field('n', '1')
  field('response_format', 'b64_json')
  field('quality', 'low')
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    PNG_1x1,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )

  const body = Buffer.concat(parts)
  const started = Date.now()

  // mode=generate 时用 JSON 走 generations，其余走 multipart 的 edits。
  // 「仅支持文生图」的模型走 edits 会返回 model_not_found，
  // 但走 generations 是正常的 —— 所以两种模式都要能测。
  const mode = url.searchParams.get('mode') === 'generate' ? 'generate' : 'edit'

  try {
    let upstream = null
    const tried = []

    if (mode === 'generate') {
      const jsonBody = Buffer.from(
        JSON.stringify({ model: testModel, prompt: 'test', n: 1, response_format: 'b64_json' }),
        'utf8',
      )
      for (const path of ['/v1/images/generations', '/images/generations']) {
        upstream = await forwardRequest(channel, {
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': String(jsonBody.length) },
          body: jsonBody,
        })
        if (upstream.status !== 404 || path.endsWith('/images/generations')) break
        tried.push(`${path} → 404`)
        upstream = null
      }
    } else {
      // 与真实代理走同一套路径候选，保证「测试通过 = 实际能用」
      const candidates = ['/v1/images/edits', '/images/edits']
      for (const path of candidates) {
        upstream = await forwardRequest(channel, {
          path,
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
          body,
        })
        if (upstream.status !== 404 || path === candidates[candidates.length - 1]) break
        tried.push(`${path} → 404`)
        upstream = null
      }
    }

    if (!upstream) {
      sendJSON(res, 200, {
        ok: false,
        status: 404,
        elapsed: Date.now() - started,
        message: `上游路径不存在（${tried.join('，')}）。该渠道可能不支持 ${mode === 'generate' ? 'images/generations' : 'images/edits'} 接口。`,
      })
      return
    }

    const elapsed = Date.now() - started
    const text = upstream.body.toString('utf8').slice(0, 800)

    if (upstream.status >= 200 && upstream.status < 300) {
      sendJSON(res, 200, {
        ok: true,
        status: upstream.status,
        elapsed,
        message: `连通正常（${elapsed}ms）`,
      })
      return
    }

    let detail = text
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.error?.message ?? parsed?.message ?? text
    } catch {
      /* 保留原始文本 */
    }

    /**
     * 失败时若明确是「这个模型在本渠道用不了」，自动记入黑名单。
     *
     * 实测踩到的两类（声明了但实际不可用）：
     *  1. TokenLab 声明 gpt-image-1，实际返回
     *     `Model "gpt-image-1" is not enabled for this channel`
     *     —— 管理员还需为模型配价格/映射。
     *  2. woyao 声明 gemini-3-pro-image，实际返回
     *     `Images API is not supported for this platform`
     *     —— 该模型走 chat/completions，不提供 images 接口。
     *
     * 所以「测试」是唯一可靠的判据，测到不可用就顺手记下，
     * 下次模型下拉自动剔除，不用用户每次重踩。
     *
     * 只记录「模型/平台层面不可用」；参数错误、网络失败、账号耗尽等不记录 ——
     * 那些是临时状态，记进黑名单会误伤。
     */
    if (MODEL_UNUSABLE_RE.test(detail)) {
      await markModelUnavailable(id, testModel, detail).catch(() => {})
    }

    sendJSON(res, 200, {
      ok: false,
      status: upstream.status,
      elapsed,
      message: `HTTP ${upstream.status}：${detail}`,
      /** 告知前端已记入黑名单，UI 可以刷新模型列表 */
      modelBlocked: MODEL_UNUSABLE_RE.test(detail),
    })
  } catch (err) {
    sendJSON(res, 200, {
      ok: false,
      status: 0,
      elapsed: Date.now() - started,
      message: `连接失败：${err.message}`,
    })
  }
}

/**
 * 向渠道发起请求。
 *
 * @param resourcePath 资源名，如 '/images/edits'。
 *                      本函数会自动尝试 /v1 前缀与非 /v1 两种路径：
 *                      不同上游对前缀要求不一致（OpenAI 官方用 /v1，
 *                      部分中转站用裸路径），404 时自动回退。
 * @returns 成功返回上游响应；全部路径 404 时返回 null。
 */
/**
 * 把上游错误翻译成用户能看懂的话。
 * 不回显任何密钥信息。
 */
function describeUpstreamError(err) {
  const raw = err?.message ?? String(err)
  if (raw.includes('timeout') || raw.includes('超时')) {
    return '上游响应超时。图像生成耗时随分辨率上升：1K 约 30–60 秒，4K 可能超过 3 分钟。请重试或切换线路。'
  }
  if (raw.includes('ECONNREFUSED')) return '上游拒绝连接，请检查端点地址是否正确。'
  if (raw.includes('ENOTFOUND') || raw.includes('EAI_AGAIN')) return '域名解析失败，请检查端点地址。'
  if (raw.includes('ECONNRESET')) return '上游连接被重置，网络可能不稳定，可尝试切换线路。'
  return `连接上游失败：${raw}`
}

/**
 * 向渠道发起请求，自动兼容 /v1 前缀。
 *
 * 为什么要回退：不同上游对路径前缀要求不一致
 * （OpenAI 官方用 /v1/images/edits，部分中转站用裸路径 /images/edits）。
 *
 * 注意：第二个候选只在第一个返回 404 时才发，
 * 避免在正常路径上多发一次请求（可能重复计费）。
 */
async function forwardWithPathFallback(channel, resourcePath, options) {
  const withV1 = `/v1${resourcePath}`

  const first = await forwardRequest(channel, { ...options, path: withV1 })
  // 404 说明路径不存在，再试裸路径；其他状态说明路径正确，直接返回
  if (first.status !== 404) return first

  const second = await forwardRequest(channel, { ...options, path: resourcePath })
  second.triedV1Path = true
  return second
}

/**
 * 超时阈值。
 *
 * 实测耗时随分辨率显著增长（woyao，quality=low）：
 *   1024² ≈ 35s，2048² ≈ 43s，4096² ≈ 37s（上游排队波动大）
 * 但 4K + 高精度模型（sunburst）在实测中超过 180 秒。
 * 所以这里给足 300 秒，宁可多等也不要误杀正常请求 ——
 * 前端已有「生成中…」状态与离开页面保护，用户不会以为卡死。
 */
const UPSTREAM_TIMEOUT_MS = 300_000

/**
 * 客户端断开时 abort 上游（取消按钮 / Esc / 关页）。
 *
 * 必须挂在 **res** 的 close 上，不能挂 req：
 * Node 在请求体读完后也会立刻发 req `close`（complete=true），
 * 若此时误 abort，文生图/图生图会在转发上游前就被标成「已取消」。
 * res.close + !writableEnded 才表示客户端提前断开。
 */
function bindClientAbort(req, res) {
  const ac = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) ac.abort()
  }
  res.on('close', onClose)
  // 兼容旧路径：部分环境仍会先发 req aborted
  const onAborted = () => {
    if (!res.writableEnded) ac.abort()
  }
  req.on('aborted', onAborted)
  return {
    signal: ac.signal,
    dispose() {
      res.off('close', onClose)
      req.off('aborted', onAborted)
    },
  }
}

function isAbortLike(err) {
  if (!err) return false
  if (err.name === 'AbortError') return true
  const msg = String(err.message || err)
  return /aborted|客户端已取消|The operation was aborted/i.test(msg)
}

function forwardRequest(channel, { path, method, headers, body, timeout = UPSTREAM_TIMEOUT_MS, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('客户端已取消'))
      return
    }

    let target
    try {
      target = new URL(`${channel.endpoint}${path}`)
    } catch (err) {
      reject(new Error(`端点地址不合法：${channel.endpoint}`))
      return
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error(`不支持的协议：${target.protocol}`))
      return
    }

    const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = doRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${channel.apiKey}`,
        },
        timeout,
      },
      (upstreamRes) => {
        const chunks = []
        upstreamRes.on('data', (c) => chunks.push(c))
        upstreamRes.on('end', () => {
          cleanup()
          resolve({
            status: upstreamRes.statusCode ?? 502,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          })
        })
        upstreamRes.on('error', (err) => {
          cleanup()
          reject(err)
        })
      },
    )

    const onAbort = () => {
      req.destroy(new Error('客户端已取消'))
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    req.on('timeout', () => {
      cleanup()
      req.destroy(new Error('上游响应超时'))
    })
    req.on('error', (err) => {
      cleanup()
      reject(err)
    })

    if (body) req.write(body)
    req.end()
  })
}

/** 供 PhotoCraft 桥 / 外部工具发现当前监听地址（含 Electron 动态端口） */
function runtimeFilePath() {
  return join(homedir(), '.shenbi', 'runtime.json')
}

function writeRuntimeEndpoint(host, port) {
  try {
    const dir = join(homedir(), '.shenbi')
    mkdirSync(dir, { recursive: true })
    const bindHost = host === '0.0.0.0' ? '127.0.0.1' : host
    writeFileSync(
      runtimeFilePath(),
      JSON.stringify(
        {
          base: `http://${bindHost}:${port}`,
          host: bindHost,
          port,
          pid: process.pid,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )
  } catch (err) {
    console.warn('[server] 写入 runtime.json 失败：', err?.message ?? err)
  }
}

function clearRuntimeEndpoint() {
  try {
    unlinkSync(runtimeFilePath())
  } catch {
    // ignore
  }
}

/**
 * 校验请求头里的渠道 ID，返回可用渠道。
 * 校验失败时已写好错误响应，返回 null。
 */
async function resolveChannel(req, res) {
  const channelId = req.headers['x-channel-id']
  if (!channelId || typeof channelId !== 'string') {
    sendError(res, 400, '缺少 X-Channel-Id 头')
    return null
  }

  const channel = await getChannel(channelId)
  if (!channel) {
    sendError(res, 404, '渠道不存在')
    return null
  }
  if (!channel.enabled) {
    sendError(res, 400, '该渠道已被禁用')
    return null
  }
  if (!hasUsableKey(channel)) {
    sendError(res, 400, '该渠道尚未填入有效 API Key')
    return null
  }
  return channel
}

/**
 * 代理转发 images/generations（文生图）请求。
 * 请求体是 JSON，体积小，直接整体读取即可。
 */
async function handleGenerateProxy(req, res) {
  const channel = await resolveChannel(req, res)
  if (!channel) return

  const abort = bindClientAbort(req, res)
  let body
  try {
    body = await readBodyBuffer(req, 2 * 1024 * 1024)
  } catch (err) {
    abort.dispose()
    sendError(res, 413, err.message)
    return
  }

  let payload
  try {
    payload = await forwardWithPathFallback(channel, '/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
      signal: abort.signal,
    })
  } catch (err) {
    abort.dispose()
    if (isAbortLike(err) || abort.signal.aborted) {
      if (!res.headersSent) sendError(res, 499, '客户端已取消')
      return
    }
    // 连接失败/超时必须回传给前端，否则页面会一直转圈且没有任何提示
    sendError(res, 502, describeUpstreamError(err))
    return
  }

  abort.dispose()
  if (!payload) return
  res.writeHead(payload.status, {
    'Content-Type': payload.headers['content-type'] ?? 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload.body)
}

/**
 * 代理转发 edits 请求（图生图）。
 *
 * 请求体是 multipart，图动辄数 MB，这里缓冲而非流式 pipe：
 * 因为 /v1 路径 404 时要原样重试 /images/edits。
 * 上限 100MB，单图通常几 MB。
 */
async function handleEditsProxy(req, res) {
  const channel = await resolveChannel(req, res)
  if (!channel) return

  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    sendError(res, 400, '请求必须是 multipart/form-data')
    return
  }

  const abort = bindClientAbort(req, res)

  // 缓冲请求体而非流式转发。
  // 代价：图片在内存里多存一份（上限 100MB，单张图通常几 MB）。
  // 收益：/v1 路径 404 时可以原样重试 /images/edits，
  //        因为要兼容不同上游对路径前缀的不同要求。
  let bodyBuffer
  try {
    bodyBuffer = await readBodyBuffer(req, 100 * 1024 * 1024)
  } catch (err) {
    abort.dispose()
    sendError(res, 413, err.message)
    return
  }

  // 候选路径：先试标准的 /v1/images/edits，再试不带 /v1 的。
  // 不同上游对路径前缀的要求不一致（OpenAI 官方用 /v1，部分中转站用裸路径）。
  let payload
  try {
    payload = await forwardWithPathFallback(channel, '/images/edits', {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bodyBuffer.length),
      },
      body: bodyBuffer,
      signal: abort.signal,
    })
  } catch (err) {
    abort.dispose()
    if (isAbortLike(err) || abort.signal.aborted) {
      if (!res.headersSent) sendError(res, 499, '客户端已取消')
      return
    }
    // 连接失败/超时必须回传给前端，否则页面会一直转圈且没有任何提示
    sendError(res, 502, describeUpstreamError(err))
    return
  }

  abort.dispose()
  if (!payload) return
  res.writeHead(payload.status, {
    'Content-Type': payload.headers['content-type'] ?? 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload.body)
}

// ------------------------------------------------------------- 静态文件

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'

  // 防目录穿越
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(DIST, safePath)

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    // SPA 回退
    filePath = join(DIST, 'index.html')
  }

  try {
    await stat(filePath)
  } catch {
    sendError(res, 404, '前端未构建，请先执行 npm run build')
    return
  }

  const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime })
  createReadStream(filePath).pipe(res)
}

// ------------------------------------------------------------------ 服务

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // 允许本机前端跨端口访问（vite dev 用 5178，后端用 5179）
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Channel-Id, Authorization, X-Access-Token')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    // 访问令牌校验（未设置 ACCESS_TOKEN 时放行）
    if (ACCESS_TOKEN && url.pathname.startsWith('/api/') && !authorized(req)) {
      sendError(res, 401, '访问令牌无效')
      return
    }

    if (url.pathname === '/api/health') {
      sendJSON(res, 200, {
        ok: true,
        authRequired: Boolean(ACCESS_TOKEN),
        listening: `${HOST}:${PORT}`,
      })
      return
    }

    if (url.pathname === '/api/images/generations' && req.method === 'POST') {
      await handleGenerateProxy(req, res)
      return
    }

    if (url.pathname === '/api/images/edits' && req.method === 'POST') {
      await handleEditsProxy(req, res)
      return
    }

    if (url.pathname.startsWith('/api/channels/') && url.pathname.endsWith('/test') && req.method === 'POST') {
      await handleChannelTest(req, res, url)
      return
    }

    // 取消模型屏蔽。必须排在通用 channels 匹配之前。
    if (await handleModelUnblock(req, res, url)) return

    if (url.pathname.startsWith('/api/channels')) {
      const matched = await handleChannelsAPI(req, res, url)
      if (matched) return
    }

    if (url.pathname.startsWith('/api/')) {
      sendError(res, 404, '接口不存在')
      return
    }

    await serveStatic(req, res, url)
  } catch (err) {
    console.error('[server]', err)
    if (!res.headersSent) sendError(res, 500, err.message ?? '服务器内部错误')
  }
})

/**
 * 启动 HTTP 服务。Electron 主进程会调用；命令行直接跑本文件时也会自动调用。
 * @returns {Promise<{ host: string, port: number, server: import('node:http').Server }>}
 */
export function startServer(options = {}) {
  const host = options.host ?? HOST
  const port = Number(options.port ?? PORT)
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      writeRuntimeEndpoint(host, port)
      console.log(`[server] http://${host}:${port}`)
      console.log(`[server] 渠道数据：${process.env.SHENBI_DATA_DIR ?? 'server/data/channels.json'}`)
      console.log(`[server] 运行时发现文件：${runtimeFilePath()}`)
      if (!ACCESS_TOKEN) {
        console.log(`[server] 未设置 ACCESS_TOKEN（仅本机可访问时这是安全的）`)
      } else {
        console.log(`[server] 已启用访问令牌校验`)
      }
      if (host === '0.0.0.0') {
        console.warn(
          `[server] 警告：监听 0.0.0.0，未设置 ACCESS_TOKEN 时局域网内任何人都能读取你的 API Key`,
        )
      }
      resolve({ host, port, server })
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

process.once('exit', clearRuntimeEndpoint)
process.once('SIGINT', () => {
  clearRuntimeEndpoint()
  process.exit(0)
})
process.once('SIGTERM', () => {
  clearRuntimeEndpoint()
  process.exit(0)
})

export { server, PORT, HOST }

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('[server] 启动失败', err)
    process.exit(1)
  })
}
