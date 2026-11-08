/**
 * 渠道存储。
 *
 * 数据落在 data/channels.json，写入用「临时文件 + rename」保证原子性，
 * 避免进程在写入途中被杀导致文件损坏。
 *
 * API Key 存在这里，不下发到浏览器。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Electron / 自定义数据目录优先；默认仍用 server/data */
const DATA_DIR = process.env.SHENBI_DATA_DIR
  ? process.env.SHENBI_DATA_DIR
  : join(HERE, 'data')
const DATA_FILE = join(DATA_DIR, 'channels.json')

/** 1×1 透明 PNG，模型探测时携带以通过上游的参数校验 */
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 渠道记录 */
function makeChannel({ name, endpoint, apiKey, enabled = true, note = '' }) {
  return {
    id: randomUUID(),
    name: String(name ?? '').trim(),
    endpoint: normalizeEndpoint(String(endpoint ?? '').trim()),
    apiKey: String(apiKey ?? '').trim(),
    enabled: enabled !== false,
    note: String(note ?? '').trim(),
    createdAt: new Date().toISOString(),
    /**
     * 该渠道是否透传 `quality` 参数。
     *
     * true  = 实测三档画质/体积有明显差异
     * false = 实测三档几乎无差异（上游不透传，选了也没用）
     * 缺省  = 未知，UI 保守放行并提示「未验证」
     *
     * 实测（2026-10-18，gpt-image-2 + 同一提示词）：
     *   woyao    → true   体积 1097 / 1733 / 1973 KB（极差 23%），output_tokens 425/1650/6500
     *   TokenLab → false  体积 1815 / 1824 / 1832 KB（极差 0.5%），usage 恒为 515 不可信
     *
     * 注意：usage 在部分中转站是固定值，不能作为判据；
     * **文件体积的离散度**才是可靠信号。
     */
    qualityPassthrough: null,
    /**
     * 尺寸/比例的控制方式。
     *
     * true  = 该渠道**只认提示词**，比例必须写进 prompt 才生效（size 参数无效）
     * false = 该渠道的 size 参数真实生效，按标准语义处理
     * 缺省  = 未知，按 false 处理但 UI 标注「未验证」
     *
     * 实测（2026-10-18，gpt-image-2.5-sunburst，13 档 size + 3 档提示词比例）：
     *   woyao    → false  size 正常生效
     *   TokenLab → true   13 个不同 size（含完全合规的 3840x2160）**全部返回
     *                    1536x1024**；aspect_ratio / ratio / width+height 也全被忽略。
     *                    但提示词写比例是 3/3 确定性命中：
     *                      16:9 → 1672x941（=1.7778）
     *                      9:16 → 941x1672
     *                      1:1  → 1254x1254
     *                    且提示词能**覆盖** size（size=1536x1024 + 提示词16:9
     *                    → 1672x941）。
     *
     * 注意：这与官方文档 docs.tokenlab.sh 的描述矛盾（文档称 gpt-image-2 的 size
     * 支持 WIDTHxHEIGHT，实测不成立）。**以实测为准**。
     */
    sizeViaPrompt: null,
    /**
     * 实测不可用的模型 → 原因。
     *
     * 为什么需要单独记：渠道的 `/v1/models` 是**能力声明**，
     * 不等于「你这个 Key 真能用」。实测 TokenLab 声明了 gpt-image-1，
     * 实际请求却返回 `Model "gpt-image-1" is not enabled for this channel`
     * —— 管理员还需为该模型配价格与映射。
     *
     * 所以模型下拉 = 声明列表 ∩ (声明列表 − 实测不可用)。
     * 由「测试」接口在真实请求失败时写入，用户也可手动标记。
     */
    unavailableModels: {},
    /**
     * 用户手动试用的模型（如上游新出的 gpt-image-2.6）。
     *
     * `/v1/models` 往往滞后；声明里没有时仍可通过「试用模型」加入下拉。
     * 真正能否出图，再靠「测试」或直接生成验证。
     */
    extraModels: [],
  }
}

/**
 * 归一化端点：只保留 origin（协议 + 域名 + 端口）。
 *
 * 为什么强制剥离路径：后端会自己拼 `/v1/images/edits`。
 * 用户常把文档里的完整路径（如 https://x.com/images/generations）粘进来，
 * 结果拼成 /images/generations/v1/images/edits → 404。
 * 这里主动纠正，比在错误信息里解释更省事。
 */
export function normalizeEndpoint(endpoint) {
  const raw = String(endpoint ?? '').trim()
  if (!raw) return ''

  // 缺协议时补 https，new URL 才认
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    return new URL(withProtocol).origin
  } catch {
    // 不是合法 URL（比如只填了个路径），退化为剥掉已知接口路径
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/\/(v1\/)?images\/(edits|generations).*$/i, '')
      .replace(/\/+$/, '')
      .split('/')[0]
  }
}

/** 端点是否合法（能解析出 origin） */
export function isValidEndpoint(endpoint) {
  const raw = String(endpoint ?? '').trim()
  if (!raw) return false
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return Boolean(url.hostname)
  } catch {
    return false
  }
}

let cache = null
/** 串行化写操作，避免并发写互相覆盖 */
let writeChain = Promise.resolve()

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true })
}

async function exists() {
  try {
    await access(DATA_FILE)
    return true
  } catch {
    return false
  }
}

export async function load() {
  if (cache) return cache
  await ensureDir()
  if (!(await exists())) {
    cache = { channels: [] }
    await persist(cache)
    return cache
  }
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    cache = {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    }
  } catch (err) {
    // 文件损坏时不要静默丢失，先备份再重置
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`
    await rename(DATA_FILE, backup).catch(() => {})
    console.error(`[channels] 数据文件损坏，已备份到 ${backup}：${err.message}`)
    cache = { channels: [] }
    await persist(cache)
  }
  return cache
}

async function persist(data) {
  await ensureDir()
  const tmp = `${DATA_FILE}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, DATA_FILE)
}

/** 排队的原子写 */
function enqueuePersist() {
  writeChain = writeChain.then(() => persist(cache))
  return writeChain
}

/** 对外暴露的渠道视图：绝不包含 apiKey */
function toPublic(channel) {
  const { apiKey, ...rest } = channel
  return {
    ...rest,
    hasKey: Boolean(apiKey),
    keyPreview: apiKey ? maskKey(apiKey) : '',
  }
}

/**
 * 占位符不算有效 Key。
 * 预置渠道时用 REPLACE_ME 占位，避免用户误以为已配好而直接提交失败。
 */
const PLACEHOLDER_KEYS = new Set(['REPLACE_ME', 'YOUR_KEY_HERE', 'CHANGE_ME'])

function hasUsableKey(channel) {
  const key = (channel.apiKey ?? '').trim()
  return key.length > 0 && !PLACEHOLDER_KEYS.has(key.toUpperCase())
}

function maskKey(key) {
  if (key.length <= 12) return key
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

export async function listChannels() {
  const data = await load()
  return data.channels.map(toPublic)
}

export async function getChannel(id) {
  const data = await load()
  return data.channels.find((c) => c.id === id) ?? null
}
export async function createChannel(input) {
  const data = await load()
  const channel = makeChannel(input)
  data.channels.push(channel)
  await enqueuePersist()
  return toPublic(channel)
}

/**
 * 按给定顺序重排渠道。
 *
 * 需求场景：同一服务商的多条线路（如主线路 / 备用 / 香港）应排在一起，
 * 而不是谁后加谁在后面。增删接口只会追加到末尾，无法插到中间，
 * 所以提供显式的排序接口。
 *
 * @param ids 目标顺序的渠道 id 数组。未出现的渠道保持在相对顺序上追加到末尾。
 */
export async function reorderChannels(ids) {
  const data = await load()
  if (!Array.isArray(ids) || ids.length === 0) return data.channels

  const byId = new Map(data.channels.map((c) => [c.id, c]))
  const ordered = []
  for (const id of ids) {
    const channel = byId.get(id)
    if (!channel) continue
    ordered.push(channel)
    byId.delete(id)
  }
  // 保持未列出的渠道原有相对顺序，追加到末尾（不丢数据）
  for (const channel of data.channels) {
    if (byId.has(channel.id)) ordered.push(channel)
  }

  data.channels = ordered
  await persist(data)
  return ordered
}

/**
 * 标记 / 取消标记某渠道的「实测不可用」模型。
 *
 * @param model  模型名
 * @param reason 原因（取消标记时传 null）
 */
export async function markModelUnavailable(id, model, reason) {
  const data = await load()
  const channel = data.channels.find((c) => c.id === id)
  if (!channel) return null

  // 老数据没有这个字段
  if (!channel.unavailableModels || typeof channel.unavailableModels !== 'object') {
    channel.unavailableModels = {}
  }

  if (reason === null) {
    delete channel.unavailableModels[model]
  } else {
    channel.unavailableModels[model] = {
      reason: String(reason ?? '').slice(0, 300),
      at: new Date().toISOString(),
    }
    // 既已实测不可用，就不要再留在手动试用列表里
    if (Array.isArray(channel.extraModels)) {
      channel.extraModels = channel.extraModels.filter((m) => m !== model)
    }
  }

  await persist(data)
  return toPublic(channel)
}

function normalizeModelName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
}

function ensureExtraModels(channel) {
  if (!Array.isArray(channel.extraModels)) channel.extraModels = []
  return channel.extraModels
}

/**
 * 试用一个尚未出现在渠道声明里的模型名。
 *
 * 流程：
 *  1. 廉价探测（1×1 图 edits，明确 model_not_found 时亚秒失败、不计费）
 *  2. 明确不支持且未 force → 拒绝加入
 *  3. 否则写入 extraModels，并从黑名单移除（若有）
 *
 * @param force 即使廉价探测报未开通也加入（例如模型仅支持文生图，edits 会误报）
 */
export async function tryExtraModel(id, modelName, { force = false, timeout = 8_000 } = {}) {
  const data = await load()
  const channel = data.channels.find((c) => c.id === id)
  if (!channel) return { ok: false, status: 404, message: '渠道不存在' }

  const model = normalizeModelName(modelName)
  if (!model) return { ok: false, status: 400, message: '模型名不能为空' }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,127}$/.test(model)) {
    return { ok: false, status: 400, message: '模型名格式不合法' }
  }
  if (!hasUsableKey(channel)) {
    return { ok: false, status: 400, message: '该渠道尚未填入有效 API Key' }
  }

  const extras = ensureExtraModels(channel)
  const declared = await fetchDeclaredModels(channel)
  if (declared?.includes(model) || extras.includes(model)) {
    // 已在列表里：顺手清黑名单，方便直接选用
    if (channel.unavailableModels?.[model]) {
      delete channel.unavailableModels[model]
      await persist(data)
    }
    return {
      ok: true,
      available: true,
      model,
      channel: toPublic(channel),
      message: declared?.includes(model)
        ? `「${model}」已在渠道声明列表中`
        : `「${model}」已在试用列表中`,
    }
  }

  const probeResult = await probeSingleModel(channel, model, timeout)
  if (probeResult.available === false && !force) {
    return {
      ok: false,
      available: false,
      model,
      status: 422,
      message: `上游明确不支持「${model}」：${probeResult.reason || 'model_not_found'}。若它可能仅支持文生图，可强制加入后再测。`,
      canForce: true,
    }
  }

  extras.push(model)
  if (!channel.unavailableModels || typeof channel.unavailableModels !== 'object') {
    channel.unavailableModels = {}
  }
  delete channel.unavailableModels[model]
  await persist(data)

  const note =
    probeResult.available === false
      ? `已强制加入「${model}」（廉价探测报未开通，请用测试/生成验证）`
      : probeResult.available === true
        ? `已加入「${model}」，可在模型下拉中选择`
        : `已加入「${model}」（上游未明确拒绝；真正出图请点测试或直接生成）`

  return {
    ok: true,
    available: probeResult.available === false ? null : probeResult.available ?? null,
    model,
    channel: toPublic(channel),
    message: note,
  }
}

/** 从手动试用列表移除（不影响渠道声明） */
export async function removeExtraModel(id, modelName) {
  const data = await load()
  const channel = data.channels.find((c) => c.id === id)
  if (!channel) return null
  const model = normalizeModelName(modelName)
  const extras = ensureExtraModels(channel)
  channel.extraModels = extras.filter((m) => m !== model)
  await persist(data)
  return toPublic(channel)
}

/** 对单个模型做廉价 edits 探测 */
async function probeSingleModel(channel, model, timeout) {
  const boundary = 'ieprobe'
  const part = (name, value) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const imagePart =
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  const body = Buffer.concat([
    Buffer.from(`${part('model', model)}${part('prompt', 'probe')}`, 'utf8'),
    Buffer.from(imagePart, 'utf8'),
    PROBE_PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ])
  try {
    const res = await probe(channel, body, boundary, timeout)
    const unsupported = /model_not_found|is not supported by any configured account|is not enabled for this channel/i.test(
      res.text,
    )
    if (unsupported) {
      return { available: false, reason: shortReason(res.text) }
    }
    return { available: null, reason: '' }
  } catch (err) {
    // 超时 ≈ 已通过路由、可能在推理 → 不下否定结论
    return { available: null, reason: err.message }
  }
}

export async function updateChannel(id, input) {
  const data = await load()
  const channel = data.channels.find((c) => c.id === id)
  if (!channel) return null

  // apiKey 传空字符串表示「不修改」，避免前端回显时把脱敏值写回去
  if (input.name !== undefined) channel.name = String(input.name).trim()
  if (input.endpoint !== undefined) channel.endpoint = normalizeEndpoint(String(input.endpoint).trim())
  if (input.enabled !== undefined) channel.enabled = Boolean(input.enabled)
  if (input.note !== undefined) channel.note = String(input.note).trim()
  // 能力标记：实测该渠道是否透传 quality。null = 未验证
  if (input.qualityPassthrough !== undefined) {
    channel.qualityPassthrough =
      input.qualityPassthrough === null ? null : Boolean(input.qualityPassthrough)
  }
  // 能力标记：实测该渠道是否只认提示词（size 无效）。null = 未验证
  if (input.sizeViaPrompt !== undefined) {
    channel.sizeViaPrompt =
      input.sizeViaPrompt === null ? null : Boolean(input.sizeViaPrompt)
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim().length > 0) {
    channel.apiKey = input.apiKey.trim()
  }

  await enqueuePersist()
  return toPublic(channel)
}

export async function deleteChannel(id) {
  const data = await load()
  const index = data.channels.findIndex((c) => c.id === id)
  if (index === -1) return false
  data.channels.splice(index, 1)
  await enqueuePersist()
  return true
}

export { toPublic, hasUsableKey }

/**
 * 渠道可用模型探测。
 *
 * ## 两步策略
 *
 * **第一步（主）：读渠道的 `/v1/models`。**
 * 这是渠道自己声明的支持列表，**权威、免费、毫秒级**。
 * 实测差异很大：
 *   - TokenLab：列出 28 个模型，含 gpt-image-1 / 1.5 / 2 / 2.5 / 2.5-flare /
 *     2.5-sunburst，**但没有 gpt-image-2-x**（那是 woyao 的 Azure 专属子渠道）
 *   - woyao：`/v1/models` 不一定完整，且**受 Key 所属分组限制**
 *     （文档写可用但分组没开通照样 404），所以还要第二步
 *
 * 早期版本用一份**硬编码的全局模型列表**去探测，结果 TokenLab 因为不校验模型名，
 * 全部被判为「可用」，于是把 woyao 的专属子渠道 `gpt-image-2-x` 也显示了出来 ——
 * 这就是「换了渠道却还是那些模型」的根因。
 *
 * **第二步（补）：对第一步没有结论的模型做排除法探测。**
 * 只发**必定快速失败**的请求，不产生费用：
 *   - 不带 image：上游先做参数校验就返回，走不到模型路由 → 无效判据
 *   - 带 1×1 PNG：能走到模型路由，`model_not_found` 亚秒级返回且不计费；
 *     但**可用模型会真的开始推理出图**，所以只把它当「排除」用，不当「确认」用
 *
 * 因此三态语义严格区分：
 *   - `available: true`  ← `/v1/models` 明确列出了
 *   - `available: false` ← 渠道明确说不支持（不在列表里，或 model_not_found）
 *   - `available: null`  ← 不确定（如 TokenLab 那种不校验模型名的），不下结论
 *
 * 想确认某个模型能否真正出图，走「渠道管理 → 测试」由用户手动触发。
 */
export async function listModels(channel, { timeout = 8_000 } = {}) {
  // 第一步：渠道自己声明的列表
  const allDeclared = await fetchDeclaredModels(channel)

  /**
   * 剔除「实测不可用」的模型。
   *
   * 声明 ≠ 可用：实测 TokenLab 声明 gpt-image-1，实际请求返回
   * `Model "gpt-image-1" is not enabled for this channel`（管理员未配价格/映射）。
   * 所以这里以实测记录为准 —— 用户也可以在渠道管理里手动标记。
   */
  const blocked = channel?.unavailableModels ?? {}
  const declared = allDeclared?.filter((m) => !(m in blocked)) ?? null
  const extras = (Array.isArray(channel?.extraModels) ? channel.extraModels : [])
    .map((m) => String(m).trim())
    .filter((m) => m && !(m in blocked))

  // 第二步：内置兜底候选（渠道没给列表时，至少能探这些）
  const FALLBACK = [
    'gpt-image-1',
    'gpt-image-1.5',
    'gpt-image-2',
    'gpt-image-2-x',
    'gpt-image-2.5',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.6',
  ]

  // 被实测屏蔽的模型一律不进候选，避免兜底路径把它"复活"
  const FALLBACK_OK = FALLBACK.filter((m) => !(m in blocked))
  const candidates = declared
    ? [...new Set([...declared, ...extras, ...FALLBACK_OK])]
    : [...new Set([...extras, ...FALLBACK_OK])]

  const boundary = 'ieprobe'
  // boundary 值不含连字符；body 里的分隔符才加 `--`。两者必须一致。
  const part = (name, value) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const imagePart =
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="p.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`

  const results = await Promise.all(
    candidates.map(async (model) => {
      // 渠道已声明 / 用户手动试用 → 直接采信，不再花时间探测
      if (declared?.includes(model)) {
        return { model, available: true, reason: '渠道已声明' }
      }
      if (extras.includes(model)) {
        return { model, available: true, reason: '手动试用' }
      }
      const body = Buffer.concat([
        Buffer.from(`${part('model', model)}${part('prompt', 'probe')}`, 'utf8'),
        Buffer.from(imagePart, 'utf8'),
        PROBE_PNG,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
      ])
      try {
        const res = await probe(channel, body, boundary, timeout)
        // 唯一可信的否定信号：模型不被支持。亚秒级返回，不产生费用。
        const unsupported = /model_not_found|is not supported by any configured account/i.test(
          res.text,
        )
        if (unsupported) {
          return { model, available: false, reason: shortReason(res.text) }
        }
        // 其余情况不下结论：可能是可用模型正在推理（会真出图计费），也可能是别的错。
        return {
          model,
          available: declared ? false : null,
          reason: declared ? '渠道未列出' : '',
        }
      } catch (err) {
        // 超时 = 大概率可用（已通过路由、在推理中），同样不下结论
        return {
          model,
          available: declared ? false : null,
          reason: declared ? '渠道未列出' : err.message,
        }
      }
    }),
  )

  // 手动试用的模型：即便渠道声明里没有，也要进下拉
  const extraResults = extras.map((model) => ({
    model,
    available: true,
    reason: '手动试用',
  }))

  // 渠道声明过列表时，默认只保留声明过的 —— 避免把别的渠道的子渠道混进来；
  // 但 extras 始终附加（用户明确要试的新模型）。
  if (!declared) {
    const byName = new Map(results.map((r) => [r.model, r]))
    for (const item of extraResults) byName.set(item.model, item)
    return [...byName.values()]
  }

  const declaredResults = results
    .filter((r) => r.available === true)
    .sort((a, b) => declared.indexOf(a.model) - declared.indexOf(b.model))
  const seen = new Set(declaredResults.map((r) => r.model))
  for (const item of extraResults) {
    if (seen.has(item.model)) continue
    declaredResults.push(item)
    seen.add(item.model)
  }
  return declaredResults
}

function shortReason(text) {
  const m = /Model "([^"]+)" is not supported[^\n]*/i.exec(text)
  if (m) return m[0].slice(0, 120)
  if (/model_not_found/i.test(text)) return 'model_not_found'
  return text.slice(0, 120)
}

/**
 * 读取渠道自己声明的模型列表（`GET /v1/models`）。
 *
 * 这是最权威也最省事的判据 —— 渠道自己说的，不存在误判。
 * 返回过滤后的图像模型名数组；拿不到时返回 null（调用方降级到排除法）。
 */
async function fetchDeclaredModels(channel, timeout = 10_000) {
  let target
  try {
    target = new URL(`${channel.endpoint}/v1/models`)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = doRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${channel.apiKey}` },
        timeout,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          // 非 2xx 一律视为「拿不到」，走排除法
          if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
            resolve(null)
            return
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const list = Array.isArray(parsed?.data) ? parsed.data : []
            const models = list
              .map((m) => (typeof m === 'string' ? m : m?.id))
              .filter((id) => typeof id === 'string')
              .filter((id) => /image|dall-e/i.test(id))
            resolve(models.length > 0 ? models : null)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

function probe(channel, body, boundary, timeout) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(`${channel.endpoint}/v1/images/edits`)
    } catch (err) {
      reject(new Error('端点不合法'))
      return
    }

    const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = doRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
          Authorization: `Bearer ${channel.apiKey}`,
        },
        timeout,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('探测超时')))
    req.on('error', reject)
    req.end(body)
  })
}
