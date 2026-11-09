/**
 * 模型与分辨率。
 *
 * ## 关键设计：模型列表由渠道决定，不由前端写死
 *
 * 早期版本把模型列表硬编码在前端，再按渠道「排除」不可用的。
 * 这在 TokenLab 上完全失效 —— 它不校验模型名，排除法一个都排除不掉，
 * 于是 woyao 专属的 `gpt-image-2-x` 也出现在 TokenLab 的下拉里。
 *
 * 现在改为：
 *  - **渠道的 `/v1/models` 是权威**（后端探测返回），下拉只列渠道声明的模型
 *  - 前端 `MODELS` 退化为**文案与能力补充表**：给已知的模型补上描述、
 *    「是否支持编辑」标记、计费；渠道返回了列表里没有的模型也能正常显示
 *    （只是没有额外描述）
 *  - 探测失败时降级用 `MODELS`，宁可多列也不误伤
 *
 * 实测要点（2026-10-17 / 10-18）：
 *  - woyao 严格校验模型名，且受 Key 所属分组限制
 *    （文档写可用但分组没开通照样 `model_not_found`）
 *  - TokenLab 不校验模型名，但其 `/v1/models` 明确列出 6 个 gpt-image 模型：
 *    `gpt-image-1` / `gpt-image-1.5` / `gpt-image-2` / `gpt-image-2.5` /
 *    `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`，**没有 `gpt-image-2-x`**
 *    （后者是 woyao 的 Azure 专属子渠道）
 *  - `size` 的有效性**因渠道而异**（实测 2026-10-18）：
 *    woyao 真实生效；TokenLab 完全无效，比例只能靠提示词。
 *    详见下方 `buildAspectPrompt()` 与渠道能力字段 `sizeViaPrompt`。
 */

/** 已知模型的补充信息。键为模型名，渠道列表之外的名字也能正常工作。 */
export const MODEL_NOTES: Record<string, { note: string; supportsEdit: boolean | null }> = {
  'gpt-image-1': { note: '上一代通用模型', supportsEdit: null },
  'gpt-image-1.5': { note: '增强细节与文字渲染', supportsEdit: null },
  'gpt-image-2': { note: '通用主力，生图与编辑均支持', supportsEdit: true },
  'gpt-image-2-x': { note: 'Azure 官方渠道，稳定生产', supportsEdit: null },
  'gpt-image-2.5': { note: '仅支持文生图', supportsEdit: false },
  'gpt-image-2.5-flare': { note: '兼顾速度与画质', supportsEdit: null },
  'gpt-image-2.5-sunburst': { note: '高精度专业版', supportsEdit: null },
  'gpt-image-2.6': { note: '新版候选，需渠道声明或手动试用后验证', supportsEdit: null },
  // 以下两个在 woyao 的 /v1/models 里发现（2026-10-18 实测），
  // 描述未经验证，按「渠道提供」中性表述，实际能力以「测试」为准
  'gemini-3-pro-image': { note: 'Gemini 图像模型（渠道提供）', supportsEdit: null },
  'gemini-3.1-flash-image': { note: 'Gemini 快速图像模型（渠道提供）', supportsEdit: null },
}

/** 全档位统一价（美元/张）：实测各渠道 1K/2K/4K 同价 */
export const MODEL_PRICE = { tier1: 0.1, tier2: 0.15, tier4: 0.2 }

export interface ModelInfo {
  id: string
  /** 渠道官方描述；未知模型回退为通用说明 */
  note: string
  /** 实测：是否可用于图生图。null 表示未知（未探测） */
  supportsEdit: boolean | null
  /** 官方计费（美元/张），仅供展示 */
  price?: { tier1: number; tier2: number; tier4: number }
}

/**
 * 探测失败时的兜底列表。
 * 正常路径不依赖它 —— 渠道探测有结果时以渠道为准。
 */
export const FALLBACK_MODELS: string[] = [
  'gpt-image-2',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
]

/** 为一个模型名补齐描述与能力信息 */
export function describeModel(id: string): ModelInfo {
  const known = MODEL_NOTES[id]
  return {
    id,
    note: known?.note ?? '渠道自定义模型',
    supportsEdit: known?.supportsEdit ?? null,
    price: MODEL_PRICE,
  }
}

/** 旧代码引用，保持可用 */
export const MODELS: ModelInfo[] = Object.keys(MODEL_NOTES).map(describeModel)

/**
 * 质量档位的实测数据（gpt-image-2，同一提示词与尺寸，仅改 quality）。
 *
 * | quality | 耗时 | 文件体积 | output_tokens |
 * |---------|------|----------|---------------|
 * | low     | 30s  | 1.2MB    | 425           |
 * | medium  | 30s  | 1.9MB    | 1650          |
 * | high    | 29s  | 1.9MB    | 6500          |
 *
 * 结论：quality 真实生效，推理量相差 **15 倍**，而耗时几乎不变
 * （说明高端 GPU 吃得下）。成本影响远大于分辨率（1K→4K 仅 $0.10→$0.20）。
 *
 * 另实测：传非法值（如 `ultra-hd`）上游**不报错**，而是静默降级到 medium ——
 * 但耗时从 30s 涨到 95s（疑似内部重试）。所以客户端要做枚举校验，
 * 别把拼错的字符串发出去。
 */

/**
 * 画面比例。
 *
 * ## 重要：比例的控制方式**因渠道而异**，不是全局统一规则
 *
 * 这里曾长期写着「比例必须用 size 参数控制，提示词里写 16:9 无效」。
 * 该结论**只在 woyao 上成立**，实测（2026-10-18）各渠道行为如下：
 *
 * | 渠道 | size 参数 | 提示词比例 | 机制 |
 * |---|---|---|---|
 * | woyao | ✅ 真实生效 | ❌ 无效 | 标准 OpenAI 语义 |
 * | TokenLab | ❌ 完全无效 | ✅ 3/3 确定性命中 | 只认提示词 |
 *
 * TokenLab 的实测证据（gpt-image-2.5-sunburst）：
 *  - 13 个不同 size（含完全合规的 3840×2160）**全部返回 1536×1024**；
 *    `aspect_ratio` / `ratio` / `width`+`height` 也全被忽略。
 *  - 提示词写比例则稳定命中：16:9 → 1672×941（=1.7778）、9:16 → 941×1672、
 *    1:1 → 1254×1254，各 3/3 无抖动。
 *  - 二者冲突时**提示词胜出**（size=1536x1024 + 提示词 16:9 → 1672×941）。
 *  - 注意 941、1254 都不是 16 的倍数 —— 提示词走的是渠道内部尺寸空间，
 *    不受 size 的「16 的倍数」约束。
 *
 * 因此本文件的 `computeSize()` 只对 `sizeViaPrompt === false` 的渠道有意义；
 * 对 `sizeViaPrompt === true` 的渠道请改用 `buildAspectPrompt()`。
 */

/** TokenLab 等「只认提示词」的渠道，把比例写进 prompt 时使用的模板。 */
const ASPECT_PROMPT_TEMPLATES: Record<AspectRatio, string> = {
  '16:9': '画面必须是横向宽屏构图，宽高比 16:9，宽远大于高。',
  '9:16': '画面必须是纵向竖屏构图，宽高比 9:16，高远大于宽。',
  '1:1': '画面必须是正方形构图，宽高比 1:1。',
  '3:2': '画面必须是横向构图，宽高比 3:2，宽略大于高。',
  '2:3': '画面必须是纵向构图，宽高比 2:3，高略大于宽。',
}

/**
 * 为「只认提示词」的渠道构造带比例约束的 prompt。
 *
 * 追加而不是替换：用户可能已在提示词里写了比例，
 * 直接替换会丢掉他精心写的内容。两句都在时以追加的为准（实测提示词胜出）。
 *
 * 比例已是「自动」时原样返回 —— 不注入任何句子，让上游自己决定。
 */
export function buildAspectPrompt(
  prompt: string,
  aspect: AspectRatio,
): string {
  const clause = ASPECT_PROMPT_TEMPLATES[aspect]
  if (!clause) return prompt
  const text = prompt.trim()
  return text ? `${text}\n\n${clause}` : clause
}

export type AspectRatio = '1:1' | '3:2' | '16:9' | '9:16' | '2:3'

export interface AspectInfo {
  id: AspectRatio
  label: string
  /** 该比例下的长边 × 短边（1K 档），用于换算各分辨率档 */
  base: { w: number; h: number }
}

/** 分辨率档位：决定长边像素数。实测三档均真实生效。 */
export type ResolutionTier = 'auto' | '1k' | '2k' | '4k'

export const ASPECTS: AspectInfo[] = [
  { id: '1:1', label: '方形', base: { w: 1024, h: 1024 } },
  { id: '3:2', label: '横版 3:2', base: { w: 1536, h: 1024 } },
  { id: '16:9', label: '宽屏 16:9', base: { w: 1792, h: 1024 } },
  { id: '9:16', label: '竖屏 9:16', base: { w: 1024, h: 1792 } },
  { id: '2:3', label: '竖版 2:3', base: { w: 1024, h: 1536 } },
]

/** 档位对应的长边像素 */
const TIER_LONG_EDGE: Record<Exclude<ResolutionTier, 'auto'>, number> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
}

export interface ResolutionInfo {
  id: ResolutionTier
  label: string
  /** 该档位单价（美元/张）；auto 沿用 1K 价 */
  price: number
}

export const RESOLUTIONS: ResolutionInfo[] = [
  { id: 'auto', label: '自动', price: 0.1 },
  { id: '1k', label: '1K', price: 0.1 },
  { id: '2k', label: '2K', price: 0.15 },
  { id: '4k', label: '4K', price: 0.2 },
]

/**
 * 组合比例与档位，算出实际传给上游的 size。
 *
 * 规则：档位决定**长边**像素，短边按比例缩放并对齐到 64 的倍数
 * （上游只接受特定组合，对齐能避免落到不支持的尺寸）。
 * 返回 null 表示 auto（不传 size，由上游决定）。
 */
export function computeSize(
  tier: ResolutionTier,
  aspect: AspectRatio,
): string | null {
  if (tier === 'auto') return null

  const info = ASPECTS.find((a) => a.id === aspect)
  if (!info) return null

  const longEdge = TIER_LONG_EDGE[tier]
  const { w: baseW, h: baseH } = info.base
  const isLandscape = baseW >= baseH

  let w: number
  let h: number
  if (isLandscape) {
    w = longEdge
    h = Math.round((baseH / baseW) * longEdge / 64) * 64
  } else {
    h = longEdge
    w = Math.round((baseW / baseH) * longEdge / 64) * 64
  }
  return `${w}x${h}`
}

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}

export function findResolution(id: string): ResolutionInfo | undefined {
  return RESOLUTIONS.find((r) => r.id === id)}

/**
 * 某模型在当前模式下是否可用（只看编辑能力标记）。
 * 编辑模式下仅支持文生图的模型要排除，避免用户选了才发现报 model_not_found。
 */
export function isModelUsable(id: string, mode: 'generate' | 'edit'): boolean {
  const info = describeModel(id)
  // 未探测的模型不拦截，让用户自己试（可能该渠道确实开通了）
  if (info.supportsEdit === null) return true
  if (mode === 'edit') return info.supportsEdit
  return true
}

/**
 * 取某渠道在给定模式下可选的模型列表。
 *
 * @param mode        当前模式
 * @param channelIds  该渠道**实际支持**的模型名。
 *                    `null` = 尚未探测，降级用内置兜底（宁可多列不误伤）；
 *                    `[]`   = 已探测但没有可用项 / 探测失败且无缓存，显示空列表，
 *                             **不要**再悄悄换成兜底三项，否则用户会以为渠道只剩三个模型。
 *
 * 这是「换渠道后模型下拉跟着变」的关键：列表来源是渠道，不是前端常量。
 */
export function usableModels(
  mode: 'generate' | 'edit',
  channelIds: string[] | null = null,
): ModelInfo[] {
  const ids = channelIds === null ? FALLBACK_MODELS : channelIds
  return ids.filter((id) => isModelUsable(id, mode)).map(describeModel)
}

/**
 * 状态标签：用于在 UI 上提示风险。
 * - verified: 已实测可用
 * - unverified: 未探测，选了可能报 model_not_found
 */
export function modelBadge(info: ModelInfo, mode: 'generate' | 'edit'): {
  text: string
  tone: 'ok' | 'warn' | 'info'
} {
  if (info.supportsEdit === null) {
    return { text: '未验证', tone: 'info' }
  }
  if (mode === 'edit' && !info.supportsEdit) {
    return { text: '仅生图', tone: 'warn' }
  }
  return { text: '已实测', tone: 'ok' }
}
