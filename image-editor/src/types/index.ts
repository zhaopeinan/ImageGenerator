/** 画廊容量上限，与原站一致 */
export const GALLERY_LIMIT = 18

/**
 * 单次请求最多可传的参考图数量。
 * 官方限制为 16 张（dall-e-2 只支持 1 张）。
 */
export const MAX_INPUT_IMAGES = 16

export type Quality = 'low' | 'medium' | 'high'
export type OutputFormat = 'png' | 'jpeg' | 'webp'

/**
 * 实际输出分辨率。
 * 档位定义见 types/models.ts 的 RESOLUTIONS。
 * 这里用宽松字符串以便画廊记录历史上的任意尺寸。
 */
export type Size = 'auto' | '1024x1024' | '2048x2048' | '4096x4096' | (string & {})

/** 任务类型：文生图 / 图生图 */
export type JobKind = 'generate' | 'edit'

/** 画廊条目。src 在内存态是 dataURL，落库后 src 置空，图片存 IndexedDB */
export interface GalleryItem {
  id: string
  kind: JobKind
  /** data URL，仅内存态有值；持久化时清空 */
  src: string
  prompt: string
  model: string
  size: Size
  quality: Quality
  format: OutputFormat
  createdAt: string
  /** 回填表单用；老数据可能缺失 */
  aspect?: '1:1' | '3:2' | '16:9' | '9:16' | '2:3'
  resolution?: 'auto' | '1k' | '2k' | '4k'
  channelId?: string
}

/** 草稿状态：用户未提交的表单内容，跨刷新保留 */
export interface DraftState {
  clearEpoch: string
  updatedAt: string
  prompt: string
  /** 分辨率档位；老数据缺失时按 auto */
  resolution?: 'auto' | '1k' | '2k' | '4k'
  /** 画面比例 */
  aspect?: '1:1' | '3:2' | '16:9' | '9:16' | '2:3'
  /** 子渠道 / 模型 */
  model?: string
  quality: Quality
  count: number
  format: OutputFormat
  selectedChannelId: string
  /** 上次停留的模式；老数据缺失时按 generate 处理 */
  activeTab?: JobKind
  sourceFileStored: boolean
  sourcePreview?: string
  sourceFileName?: string
  sourceFileType?: string
  /**
   * 附加参考图（第一张之后的多图）。
   * 顺序有意义：模型按顺序接收，提示词里应说明「第1张」「第2张」指的是谁。
   */
  referenceFilesStored?: boolean
  referencePreviews?: string[]
  referenceFileNames?: string[]
  maskFileStored: boolean
  maskPreview?: string
  maskFileName?: string
  maskFileType?: string
}

/** 画廊索引（不含二进制） */
export interface GalleryIndex {
  items: Omit<GalleryItem, 'src'>[]
  updatedAt: string
  clearEpoch: string
  destructiveRevision?: string
}

/** IndexedDB 中保存的文件快照 */
export interface StoredFile {
  blob: Blob
  name: string
  type: string
  lastModified: number
}

/** 校验记录是否属于当前世代 */
export interface EpochTagged {
  clearEpoch?: string
}

/** 上游响应的两种可能形态 */
export interface ImagesResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  output?: Array<{ result?: string; b64_json?: string; image_url?: string }>
}

/** 端点配置（本地遗留，新版用 Channel） */
export interface EndpointConfig {
  name: string
  endpoint: string
  description?: string
}

/**
 * 渠道。
 * 由后端保管，apiKey 永不下发；这里只有脱敏预览与 hasKey 标志。
 */
export interface Channel {
  id: string
  name: string
  endpoint: string
  enabled: boolean
  note: string
  createdAt: string
  /** 后端是否存了 Key */
  hasKey: boolean
  /** 脱敏后的 Key 预览，如 sk-sup…3456 */
  keyPreview: string
  /**
   * 实测不可用的模型 → 原因与时间。
   *
   * 渠道的 `/v1/models` 是**能力声明**，不等于这个 Key 真能用：
   *  - 声明了但管理员未配价格/映射 → `is not enabled for this channel`
   *  - 该平台不提供 Images 接口（如 gemini 走 chat） → `Images API is not supported`
   *
   * 命中这些的模型会从模型下拉剔除。用户可在渠道管理里手动「恢复」，
   * 以便管理员后来开通后能放回。
   */
  unavailableModels?: Record<string, { reason: string; at: string }>
  /**
   * 用户手动试用的模型名（渠道 `/v1/models` 尚未声明时仍可出现在下拉）。
   * 例如上游新出 gpt-image-2.6，想先试能否走通。
   */
  extraModels?: string[]
  /**
   * 该渠道是否透传 `quality` 参数。
   *
   * 实测（gpt-image-2，同一提示词仅改 quality）：
   *   woyao    → true   体积 1097/1733/1973 KB（极差 23%），明显生效
   *   TokenLab → false  体积 1815/1824/1832 KB（极差 0.5%），**不透传**
   *
   * 为 false 时 UI 应禁用质量选择 —— 让用户以为能调，实际白花 token。
   * null 表示未验证，保守放行并提示。
   */
  qualityPassthrough?: boolean | null
  /**
   * 该渠道是否**只认提示词**控制尺寸/比例（`size` 参数无效）。
   *
   * 实测（gpt-image-2.5-sunburst，13 档 size + 3 档提示词比例）：
   *   woyao    → false  size 正常生效
   *   TokenLab → true   13 个不同 size（含完全合规的 3840x2160）**全部返回
   *                    1536x1024**；`aspect_ratio` / `ratio` / `width`+`height`
   *                    也全被忽略。但提示词写比例是 3/3 确定性命中：
   *                      16:9 → 1672x941（=1.7778）
   *                      9:16 → 941x1672
   *                      1:1  → 1254x1254
   *                    且提示词**覆盖** size。
   *
   * 为 true 时前端必须把比例写进 prompt，否则用户选了 16:9 却拿到方图；
   * 同时禁用分辨率档位（该渠道不接受 size），并提示实际尺寸由渠道决定。
   * null 表示未验证，按 false 处理但 UI 标注「未验证」。
   *
   * 注：这与官方文档 docs.tokenlab.sh 的描述矛盾（文档称 gpt-image-2 的 size
   * 支持 WIDTHxHEIGHT 且给了详细约束，实测不成立）。以实测为准。
   */
  sizeViaPrompt?: boolean | null
}
