/**
 * 编辑器状态层。
 *
 * 移植自 sub2api 的 imageGenerator store（线上产物 imageGenerator-CX1zM4zJ.js），
 * 保留其并发调度、写入串行化、世代复核、防竞态设计。
 * 剔除了 generate 分支与 v1 数据迁移。
 *
 * 渠道与 API Key 由后端保管（见 server/），前端只持有渠道 ID。
 */

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type {
  Channel,
  DraftState,
  GalleryIndex,
  GalleryItem,
  JobKind,
  OutputFormat,
  Quality,
  StoredFile,
} from '../types'
import { GALLERY_LIMIT } from '../types'
import {
  countClamp,
  fileSnapshot,
  fileToDataUrl,
  itemKey,
  snapshotToFile,
  storage,
  lsGet,
  lsSet,
  lsRemove,
} from '../utils/storage'
import { channelsApi, isAbortError, proxyEdit, proxyGenerate } from '../utils/api'
import {
  ASPECTS,
  RESOLUTIONS,
  buildAspectPrompt,
  computeSize,
  type AspectRatio,
  type ResolutionTier,
} from '../types/models'

/**
 * 校验 quality 档位。
 *
 * 实测：传非法值（如 `ultra-hd`）上游**不报错**，而是静默降级到 medium ——
 * 用户以为在用高档，实际拿到中档，而且耗时从 30s 涨到 95s（疑似内部重试）。
 * 与其把拼错的字符串发出去等它降级，不如就地拦住并说明。
 */
const QUALITY_VALUES = ['low', 'medium', 'high'] as const

function assertValidQuality(value: string): 'low' | 'medium' | 'high' {
  if (!(QUALITY_VALUES as readonly string[]).includes(value)) {
    throw new Error(`质量档位无效：${value}（应为 low / medium / high）`)
  }
  return value as 'low' | 'medium' | 'high'
}

const SELECTED_CHANNEL_STORE = 'image-editor:selected-channel'

export const useEditorStore = defineStore('editor', () => {
  // ------------------------------------------------------------ 表单状态
  const prompt = ref('')
  /** 分辨率档位：auto / 1k / 2k / 4k，决定长边像素数 */
  const resolution = ref<ResolutionTier>('auto')
  /** 画面比例。比例必须靠 size 参数控制，提示词里写「16:9」无效。 */
  const aspect = ref<AspectRatio>('1:1')
  const quality = ref<Quality>('medium')
  const count = ref(1)
  const format = ref<OutputFormat>('png')
  const maxCount = ref(4)

  // ------------------------------------------------------------ 模型选择
  /** 子渠道 / 模型，如 gpt-image-2、gpt-image-2.5-sunburst */
  const model = ref<string>('gpt-image-2')

  // ------------------------------------------------------------ 任务模式
  // generate = 文生图（不需上传图）；edit = 图生图（需上传源图，可选蒙版）
  const activeTab = ref<JobKind>('generate')

  // ------------------------------------------------------------ 画廊状态
  const galleryItems = ref<GalleryItem[]>([])
  const galleryFilter = ref<'all' | JobKind>('all')

  // ------------------------------------------------------------ 上传文件
  const sourceFile = ref<File | null>(null)
  /** 附加参考图（第 2 张起）。官方支持最多 16 张输入图。 */
  const referenceFiles = ref<File[]>([])
  const maskFile = ref<File | null>(null)
  const sourcePreview = ref('')
  const referencePreviews = ref<string[]>([])
  const maskPreview = ref('')
  const sourceStored = ref(false)
  const referenceStored = ref(false)
  const maskStored = ref(false)

  /** 实际会发给上游的全部输入图：第一张 + 附加参考图 */
  const inputFiles = computed<File[]>(() => {    const list: File[] = []
    if (sourceFile.value) list.push(sourceFile.value)
    list.push(...referenceFiles.value)
    return list
  })

  // ------------------------------------------------------------ 渠道
  // 渠道与 Key 都在后端，前端只拿列表与选中的 ID
  const channels = ref<Channel[]>([])
  const channelsLoading = ref(false)
  const channelsError = ref('')
  const selectedChannelId = ref<string>(lsGet(SELECTED_CHANNEL_STORE) ?? '')

  /**
   * 各渠道的**已确认不可用**的模型。
   * key 为 channelId，值为模型名集合。
   *
   * 只收录「确定不可用」的模型（后端探测到 model_not_found）。
   * 可用/未知的都不收录 —— 后端若全量探测，5 个模型 × $0.10 = 每次切渠道烧 $0.5，
   * 产品上不可接受。想确认某个模型，走「渠道管理 → 测试」手动触发。
   */
  const channelModels = ref<Record<string, { model: string; available: boolean | null; reason: string }[]>>({})
  const modelsProbing = ref(false)

  /**
   * 当前渠道**实际支持**的模型名列表（正列表，不是排除集）。
   *
   * 为什么从「排除集」改成「正列表」：
   * 排除法只在渠道会拒绝无效模型名时有效。TokenLab 不校验模型名，
   * 一个都排除不掉，结果 woyao 专属的 gpt-image-2-x 也被列了出来。
   * 正列表直接采用渠道 `/v1/models` 的声明，不会串。
   *
   * 空数组 = 尚未探测或探测失败，此时前端降级用内置列表（宁可多列不误伤）。
   */
  const channelModelIds = computed<string[]>(() => {
    const list = channelModels.value[selectedChannelId.value]
    if (!list) return []
    return list.filter((m) => m.available === true).map((m) => m.model)
  })

  /** 兼容旧调用点：只用于「提示哪些被排除」 */
  const unavailableModelSet = computed<Set<string>>(() => {
    const list = channelModels.value[selectedChannelId.value]
    if (!list) return new Set()
    return new Set(list.filter((m) => m.available === false).map((m) => m.model))
  })

  // ------------------------------------------------------------ 任务状态
  const submitting = ref(false)
  const submittingKind = ref<JobKind | null>(null)
  const submittingPrompt = ref('')
  const submittingStartedAt = ref<string | null>(null)
  /** 批量进度：已完成张数 / 计划张数 */
  const batchDone = ref(0)
  const batchTotal = ref(0)
  /** 批量默认并发；可在设置里改（1–4） */
  const BATCH_CONCURRENCY_STORE = 'image-editor:batch-concurrency'
  const batchConcurrency = ref(
    Math.min(4, Math.max(1, Number(lsGet(BATCH_CONCURRENCY_STORE) || 2) || 2)),
  )
  watch(batchConcurrency, (n) => {
    const v = Math.min(4, Math.max(1, Number(n) || 2))
    if (v !== n) batchConcurrency.value = v
    else lsSet(BATCH_CONCURRENCY_STORE, String(v))
  })
  const jobAbortController = ref<AbortController | null>(null)

  const hasActiveJob = computed(() => submitting.value || submittingKind.value !== null)

  function clearJobFlags() {
    submitting.value = false
    submittingKind.value = null
    submittingPrompt.value = ''
    submittingStartedAt.value = null
    batchDone.value = 0
    batchTotal.value = 0
    jobAbortController.value = null
  }

  /** 取消当前生成/编辑（在途请求 abort；已落库的结果保留） */
  function cancelJob() {
    jobAbortController.value?.abort()
  }

  /** 已启用的渠道才可用于请求 */
  const usableChannels = computed(() => channels.value.filter((c) => c.enabled && c.hasKey))

  const selectedChannel = computed(
    () => channels.value.find((c) => c.id === selectedChannelId.value) ?? null,
  )

  /**
   * 当前渠道是否「只认提示词」控制比例（TokenLab 实测为 true）。
   *
   * 为 true 时：
   *  - 请求里不传 `size`（实测传了也没用，只会把日志和排查带偏）
   *  - 比例改为追加进提示词
   *  - UI 禁用分辨率档位并说明原因
   *
   * null（未验证）按 false 处理，即走标准 `size` 语义。
   */
  const sizeViaPrompt = computed(() => selectedChannel.value?.sizeViaPrompt === true)

  /** 实际请求地址：前端 → 后端代理 */
  const requestTarget = computed(() => '本机后端 /api/images/edits')

  const filteredGallery = computed(() => {
    if (galleryFilter.value === 'all') return galleryItems.value
    return galleryItems.value.filter((item) => item.kind === galleryFilter.value)
  })

  // ------------------------------------------------------------ 世代与版本
  // revision 在每次「清空/切世代」时自增，用于 await 之后复核上下文是否仍然有效。
  let hydrated = false
  let revision = 0
  let epoch = storage.readEpoch()
  let galleryUpdatedAt = ''
  let jobQueue: Promise<unknown> = Promise.resolve()
  let sourceQueue: Promise<unknown> = Promise.resolve()
  let referenceQueue: Promise<unknown> = Promise.resolve()
  let maskQueue: Promise<unknown> = Promise.resolve()

  /** 校验上下文是否仍然有效（世代 + 版本都没变） */
  function contextValid(currentEpoch: string, currentRevision: number): boolean {
    if (hydrated !== true) return true
    if (revision !== currentRevision) return false
    if (epoch !== currentEpoch) return false
    if (storage.idbAvailable()) return true
    return storage.readEpoch() === currentEpoch
  }

  /** 跨标签页：另一个标签清空画廊时，本标签同步 */
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storage.LS_CLEAR_EPOCH || !event.newValue) return
      const incoming = storage.parseEpoch(event.newValue)
      if (!incoming || epoch === incoming) return
      epoch = incoming
      hydrated = false
      revision += 1
      void hydrate()
    })
  }

  /**
   * 渠道列表变化时自动选中一个可用渠道。
   * 没有这一步，刷新后 selectedChannelId 为空会导致提交按钮永远禁用。
   */
  watch(
    usableChannels,
    (list) => {
      if (list.length === 0) return
      if (selectedChannelId.value && list.some((c) => c.id === selectedChannelId.value)) return
      selectChannel(list[0].id)
    },
    { immediate: true },
  )

  // ---------------------------------------------------------- 草稿持久化

  async function persistDraft(
    currentEpoch = epoch,
    currentRevision = revision,
  ): Promise<boolean> {
    if (!contextValid(currentEpoch, currentRevision)) return false

    const now = new Date().toISOString()
    const draft: DraftState = {
      clearEpoch: currentEpoch,
      updatedAt: now,
      prompt: prompt.value,
      resolution: resolution.value,
      aspect: aspect.value,
      model: model.value,
      quality: quality.value,
      count: countClamp(count.value, maxCount.value),
      format: format.value,
      selectedChannelId: selectedChannelId.value,
      activeTab: activeTab.value,
      sourceFileStored: sourceStored.value,
      sourcePreview: sourcePreview.value || undefined,
      sourceFileName: sourceFile.value?.name,
      sourceFileType: sourceFile.value?.type,
      referenceFilesStored: referenceStored.value,
      referencePreviews: referencePreviews.value.length > 0 ? [...referencePreviews.value] : undefined,
      referenceFileNames: referenceFiles.value.map((f) => f.name),
      maskFileStored: maskStored.value,
      maskPreview: maskPreview.value || undefined,
      maskFileName: maskFile.value?.name,
      maskFileType: maskFile.value?.type,
    }

    const written = lsSet(storage.LS_DRAFT, JSON.stringify(draft))
    if (!storage.idbAvailable()) {
      if (written && contextValid(currentEpoch, currentRevision)) {
        return true
      }
      return false
    }

    const ok = await storage.idbPut(storage.LS_DRAFT_METADATA, draft, currentEpoch)
    if (!ok) return false
    if (!contextValid(currentEpoch, currentRevision)) return false
    return true
  }

  function applyDraft(draft: DraftState) {
    prompt.value = draft.prompt ?? ''
    resolution.value = draft.resolution ?? 'auto'
    aspect.value = draft.aspect ?? '1:1'
    model.value = draft.model ?? 'gpt-image-2'
    quality.value = draft.quality ?? 'medium'
    count.value = countClamp(draft.count ?? 1, maxCount.value)
    format.value = draft.format ?? 'png'
    selectedChannelId.value = draft.selectedChannelId ?? ''
    activeTab.value = draft.activeTab === 'edit' ? 'edit' : 'generate'

    sourceStored.value = draft.sourceFileStored === true
    sourceFile.value = null
    sourcePreview.value = draft.sourcePreview ?? ''

    referenceStored.value = draft.referenceFilesStored === true
    referenceFiles.value = []
    referencePreviews.value = [...(draft.referencePreviews ?? [])]

    maskStored.value = draft.maskFileStored === true
    maskFile.value = null
    maskPreview.value = draft.maskPreview ?? ''
  }

  async function loadDraft(): Promise<void> {
    if (!storage.idbAvailable()) {
      const draft = storage.readEpochTagged<DraftState>(storage.LS_DRAFT, epoch)
      if (draft) applyDraft(draft)
      return
    }
    const status = await storage.idbRead<DraftState>(storage.LS_DRAFT_METADATA)
    if (status.status !== 'found' || !storage.matchesEpoch(status.value, epoch)) return
    applyDraft(status.value)
  }

  // -------------------------------------------------------- 上传文件持久化

  /** 上传槽位 */
  type UploadSlot = 'source' | 'reference' | 'mask'

  function slotKey(slot: UploadSlot): string {
    if (slot === 'source') return storage.LS_SOURCE_FILE
    if (slot === 'mask') return storage.LS_MASK_FILE
    return storage.LS_REFERENCE_FILES
  }

  async function loadStoredFile(
    slot: UploadSlot,
    currentEpoch: string,
    currentRevision: number,
  ): Promise<void> {
    if (!storage.idbAvailable()) return

    // 参考图按数组整体存取
    if (slot === 'reference') {
      const status = await storage.idbRead<StoredFile[]>(slotKey(slot))
      if (!contextValid(currentEpoch, currentRevision)) return
      if (status.status !== 'found' || !Array.isArray(status.value)) {
        referenceFiles.value = []
        referencePreviews.value = []
        referenceStored.value = false
        return
      }
      const files = status.value.map(snapshotToFile)
      const previews = await Promise.all(files.map((f) => fileToDataUrl(f)))
      if (!contextValid(currentEpoch, currentRevision)) return
      referenceFiles.value = files
      referencePreviews.value = previews
      referenceStored.value = true
      return
    }

    const status = await storage.idbRead<StoredFile>(slotKey(slot))
    if (!contextValid(currentEpoch, currentRevision)) return
    if (status.status !== 'found') {
      if (slot === 'source') {
        sourceFile.value = null
        sourcePreview.value = ''
        sourceStored.value = false
      } else {
        maskFile.value = null
        maskPreview.value = ''
        maskStored.value = false
      }
      return
    }
    const file = snapshotToFile(status.value)
    const dataUrl = await fileToDataUrl(file)
    if (!contextValid(currentEpoch, currentRevision)) return
    if (slot === 'source') {
      sourceFile.value = file
      sourcePreview.value = dataUrl
      sourceStored.value = true
    } else {
      maskFile.value = file
      maskPreview.value = dataUrl
      maskStored.value = true
    }
  }

  /** 上传队列串行化，避免连续拖拽时并发写互相覆盖 */
  function enqueueFileWrite<T>(slot: UploadSlot, task: () => Promise<T>): Promise<T> {
    const queue = slot === 'mask' ? maskQueue : slot === 'reference' ? referenceQueue : sourceQueue
    const pending = queue.catch(() => undefined).then(task)
    const settled = pending.then(
      () => undefined,
      () => undefined,
    )
    if (slot === 'mask') maskQueue = settled
    else if (slot === 'reference') referenceQueue = settled
    else sourceQueue = settled
    return pending
  }

  async function setUploadFile(
    slot: UploadSlot,
    file: File,
    dataUrl: string,
  ): Promise<boolean> {
    const currentEpoch = epoch
    const currentRevision = revision

    if (slot === 'source') {
      sourceFile.value = file
      sourcePreview.value = dataUrl
      sourceStored.value = false
    } else if (slot === 'reference') {
      referenceFiles.value = [...referenceFiles.value, file]
      referencePreviews.value = [...referencePreviews.value, dataUrl]
      referenceStored.value = false
    } else {
      maskFile.value = file
      maskPreview.value = dataUrl
      maskStored.value = false
    }

    void persistDraft(currentEpoch, currentRevision)

    return enqueueFileWrite(slot, async () => {
      if (!contextValid(currentEpoch, currentRevision)) return false

      // 参考图每次都整体重写（数组内部可能变化），单图则逐个写
      let ok: boolean
      if (slot === 'reference') {
        ok = await storage.idbPut(
          slotKey(slot),
          referenceFiles.value.map(fileSnapshot),
          currentEpoch,
        )
      } else {
        ok = await storage.idbPut(slotKey(slot), fileSnapshot(file), currentEpoch)
      }

      if (!ok || !contextValid(currentEpoch, currentRevision)) return false
      if (slot === 'source') sourceStored.value = true
      else if (slot === 'reference') referenceStored.value = true
      else maskStored.value = true
      return persistDraft(currentEpoch, currentRevision)
    })
  }

  /** 移除某张参考图（按索引） */
  async function removeReference(index: number): Promise<boolean> {
    const currentEpoch = epoch
    const currentRevision = revision

    referenceFiles.value = referenceFiles.value.filter((_, i) => i !== index)
    referencePreviews.value = referencePreviews.value.filter((_, i) => i !== index)
    referenceStored.value = false

    const saved = await persistDraft(currentEpoch, currentRevision)

    return enqueueFileWrite('reference', async () => {
      if (!contextValid(currentEpoch, currentRevision)) return false
      const ok = await storage.idbPut(
        slotKey('reference'),
        referenceFiles.value.map(fileSnapshot),
        currentEpoch,
      )
      if (!ok || !contextValid(currentEpoch, currentRevision)) return false
      referenceStored.value = true
      return saved && persistDraft(currentEpoch, currentRevision)
    })
  }

  async function clearUploadFile(slot: UploadSlot): Promise<boolean> {
    const currentEpoch = epoch
    const currentRevision = revision

    if (slot === 'source') {
      sourceFile.value = null
      sourcePreview.value = ''
      sourceStored.value = false
    } else if (slot === 'reference') {
      referenceFiles.value = []
      referencePreviews.value = []
      referenceStored.value = false
    } else {
      maskFile.value = null
      maskPreview.value = ''
      maskStored.value = false
    }

    const saved = await persistDraft(currentEpoch, currentRevision)

    return enqueueFileWrite(slot, async () => {
      if (!contextValid(currentEpoch, currentRevision)) return false
      if (slot === 'reference') {
        // 空数组也要落盘，否则刷新后旧图会回来
        const written = await storage.idbPut(slotKey(slot), [], currentEpoch)
        return written && saved && contextValid(currentEpoch, currentRevision)
      }
      const removed = await storage.idbDelete(slotKey(slot), currentEpoch)
      return removed && saved && contextValid(currentEpoch, currentRevision)
    })
  }

  // ------------------------------------------------------------ 画廊持久化

  /**
   * 写入画廊。所有变更走同一个事务：更新索引 → 写 blob → 删孤儿 blob。
   * revision 字段用于 delete/clear 操作后的对账，防止并发写入把已删数据复活。
   */
  async function persistGallery(
    items: GalleryItem[],
    keepItems: GalleryItem[],
    removeIDs: string[],
    currentEpoch: string,
    currentRevision: number,
  ): Promise<boolean> {
    if (!contextValid(currentEpoch, currentRevision)) return false
    if (!storage.idbAvailable()) {
      const index = {
        items: items.slice(0, GALLERY_LIMIT).map(storage.toIndexMeta),
        updatedAt: new Date().toISOString(),
        clearEpoch: currentEpoch,
      }
      return lsSet(storage.LS_GALLERY_INDEX, JSON.stringify(index))
    }

    const now = new Date().toISOString()
    const capped = items.slice(0, GALLERY_LIMIT)
    const keepByID = new Set(keepItems.map((i) => i.id))
    const metas = capped.map(storage.toIndexMeta)
    const keptIDs = new Set(metas.map((m) => m.id))

    // 孤儿 blob：本次要删的 + 索引里已消失的
    const pendingRaw = lsGet(storage.LS_GALLERY_PENDING_DELETE)
    let pending: string[] = []
    try {
      const parsed = pendingRaw ? JSON.parse(pendingRaw) : []
      pending = Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
    } catch {
      pending = []
    }
    const orphans = Array.from(
      new Set([...pending, ...removeIDs, ...metas.map((m) => m.id).filter((id) => !keptIDs.has(id))]),
    ).filter((id) => !keptIDs.has(id))

    const index: GalleryIndex = {
      items: metas,
      updatedAt: now,
      clearEpoch: currentEpoch,
    }

    let succeeded = false
    try {
      succeeded = await writeGalleryTransaction(capped, keepByID, orphans, index, currentEpoch)
    } catch {
      succeeded = false
    }

    if (!succeeded) return false
    lsSet(storage.LS_GALLERY_PENDING_DELETE, '[]')
    return true
  }

  /**
   * 写入画廊数据：blob 落库 → 更新索引 → 清理孤儿 blob。
   * 每步都受世代校验保护，任一步世代失配即放弃，避免把已清空的数据写回来。
   */
  async function writeGalleryTransaction(
    items: GalleryItem[],
    keepByID: Set<string>,
    orphans: string[],
    index: GalleryIndex,
    currentEpoch: string,
  ): Promise<boolean> {
    for (const item of items) {
      const key = itemKey(item.id)
      if (keepByID.has(item.id)) {
        // 本次新产出的图，直接落库（splitItem 是异步的：data URL 解码要走浏览器原生）
        const ok = await storage.idbPut(key, await storage.splitItem(item), currentEpoch)
        if (!ok) return false
        continue
      }
      // 索引中已存在的条目：blob 缺失才补写，避免无谓的重复写入
      const existing = await storage.idbRead(key)
      if (existing.status === 'missing') {
        const ok = await storage.idbPut(key, await storage.splitItem(item), currentEpoch)
        if (!ok) return false
      }
    }

    const indexOK = await storage.idbPut(storage.LS_GALLERY_INDEX, index, currentEpoch)
    if (!indexOK) return false

    for (const id of orphans) {
      await storage.idbDelete(itemKey(id), currentEpoch)
    }
    return true
  }

  /** 统一入口：变更画廊并落库 */
  async function commitGallery(
    items: GalleryItem[],
    keepItems: GalleryItem[] = [],
    removeIDs: string[] = [],
  ): Promise<{ persisted: boolean }> {
    const currentEpoch = epoch
    const currentRevision = revision
    if (!contextValid(currentEpoch, currentRevision)) return { persisted: false }

    galleryUpdatedAt = new Date().toISOString()
    const ok = await persistGallery(items, keepItems, removeIDs, currentEpoch, currentRevision)
    if (!ok) return { persisted: false }
    if (!contextValid(currentEpoch, currentRevision)) return { persisted: false }

    galleryItems.value = items.slice(0, GALLERY_LIMIT)
    return { persisted: true }
  }

  // ------------------------------------------------------------ 任务串行化

  /** 所有画廊变更排队执行，避免并发写互相覆盖 */
  function enqueueGallery<T>(task: () => Promise<T>): Promise<T> {
    const pending = jobQueue.catch(() => undefined).then(task)
    const settled = pending.then(
      () => undefined,
      () => undefined,
    )
    jobQueue = settled
    return pending
  }

  // ---------------------------------------------------------------- actions

  async function hydrate(): Promise<void> {
    if (hydrated) return

    const currentEpoch = epoch
    const currentRevision = revision
    if (!contextValid(currentEpoch, currentRevision)) return

    storage.purgeStaleMetadata(currentEpoch)

    // localStorage 兜底（无 IndexedDB 时）
    const fallbackIndex = storage.idbAvailable()
      ? null
      : storage.readEpochTagged<GalleryIndex>(storage.LS_GALLERY_INDEX, currentEpoch)
    if (fallbackIndex) {
      const restored: GalleryItem[] = []
      for (const meta of fallbackIndex.items) {
        const item = await storage.hydrateItem(null, meta as GalleryItem)
        if (item) restored.push(item)
      }
      galleryItems.value = restored
      galleryUpdatedAt = fallbackIndex.updatedAt
    }

    await loadGalleryFromDB(currentEpoch)
    await loadDraft()
    await Promise.all([
      loadStoredFile('source', currentEpoch, currentRevision),
      loadStoredFile('reference', currentEpoch, currentRevision),
      loadStoredFile('mask', currentEpoch, currentRevision),
    ])

    if (!contextValid(currentEpoch, currentRevision)) return
    hydrated = true
  }

  /**
   * 渠道与草稿都可能写 selectedChannelId，恢复完两边后统一校正一次。
   * 避免出现「渠道列表非空但没有选中项」导致提交按钮永远禁用。
   */
  function ensureChannelSelected() {
    const usable = usableChannels.value
    if (usable.length === 0) {
      if (selectedChannelId.value !== '') selectChannel('')
      return
    }
    if (!usable.some((c) => c.id === selectedChannelId.value)) {
      selectChannel(usable[0].id)
    }
  }

  async function loadGalleryFromDB(currentEpoch: string): Promise<void> {
    if (!storage.idbAvailable()) return
    const status = await storage.idbRead<GalleryIndex>(storage.LS_GALLERY_INDEX)
    if (status.status !== 'found') return
    if (!storage.matchesEpoch(status.value, currentEpoch)) return
    if (!storage.isNewerThan(status.value, galleryUpdatedAt)) return

    const items: GalleryItem[] = []
    for (const meta of status.value.items) {
      const stored = await storage.idbRead(itemKey(meta.id))
      const item = await storage.hydrateItem(
        stored.status === 'found' ? stored.value : null,
        meta as GalleryItem,
      )
      if (item) items.push(item)
    }

    // 清理历史重复项：旧版 parseImages 会把同一条记录的 b64_json 和 url
    // 各存一份，导致画廊里每张图都成对出现。同一张图只保留最早那条。
    const deduped = dedupeGalleryItems(items)
    if (deduped.removed.length > 0) {
      const result = await commitGallery(
        deduped.items,
        deduped.items,
        deduped.removed,
      )
      if (!result.persisted) {
        // 落库失败就只在内存里去重，至少这轮显示是干净的
        galleryItems.value = deduped.items
        galleryUpdatedAt = status.value.updatedAt
        return
      }
    }

    galleryItems.value = deduped.items
    galleryUpdatedAt = status.value.updatedAt
  }

  /**
   * 按图片内容去重。
   *
   * 判据是「同一 prompt + 同一张图」——也就是历史 bug 造出的成对重复。
   * 保留先出现的那条（画廊按时间倒序，索引里更靠前的是更早生成的）。
   */
  function dedupeGalleryItems(items: GalleryItem[]): {
    items: GalleryItem[]
    removed: string[]
  } {
    const seen = new Set<string>()
    const kept: GalleryItem[] = []
    const removed: string[] = []

    for (const item of items) {
      const key = `${item.kind}|${item.prompt}|${item.createdAt}|${imageFingerprint(item.src)}`
      if (seen.has(key)) {
        removed.push(item.id)
        continue
      }
      seen.add(key)
      kept.push(item)
    }

    return { items: kept, removed }
  }

  /** 新增图片到画廊（编辑任务产出后调用） */
  function addGalleryItems(
    urls: string[],
    jobPrompt: string,
    kind: JobKind,
  ): Promise<{ persisted: boolean }> {
    const currentEpoch = epoch
    const currentRevision = revision

    return enqueueGallery(async () => {
      if (!contextValid(currentEpoch, currentRevision)) return { persisted: false }

      // HTTP(S) URL 先拉成本地 data URL，否则 IndexedDB 只认 data:，刷新后丢图
      const localUrls = await Promise.all(urls.map((src) => ensureLocalImageSrc(src)))

      const now = new Date().toISOString()
      // TokenLab 下 size 不生效，标成「按提示词」而不是编造一个请求尺寸，
      // 否则画廊里会出现一个从未真正传给上游的数字。
      const sizeLabel = sizeViaPrompt.value
        ? '按提示词'
        : computeSize(resolution.value, aspect.value) ?? 'auto'
      const fresh: GalleryItem[] = localUrls.map((src, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        src,
        prompt: jobPrompt.trim(),
        model: model.value,
        size: sizeLabel,
        quality: quality.value,
        format: format.value,
        createdAt: now,
        aspect: aspect.value,
        resolution: resolution.value,
        channelId: selectedChannelId.value || undefined,
      }))

      const merged = [...fresh, ...galleryItems.value].slice(0, GALLERY_LIMIT)
      const freshIDs = new Set(fresh.map((i) => i.id))
      const removed = galleryItems.value.filter((i) => !freshIDs.has(i.id)).map((i) => i.id)

      return commitGallery(merged, fresh, removed)
    })
  }

  /**
   * 从画廊条目回填表单（提示词、模型、质量、格式、比例、分辨率、模式）。
   * 不切换渠道（除非条目带 channelId 且该渠道仍可用）；不恢复源图/蒙版。
   */
  function applyFromGallery(item: GalleryItem): void {
    prompt.value = item.prompt ?? ''
    if (item.model) model.value = item.model
    if (item.quality === 'low' || item.quality === 'medium' || item.quality === 'high') {
      quality.value = item.quality
    }
    if (item.format === 'png' || item.format === 'jpeg' || item.format === 'webp') {
      format.value = item.format
    }
    if (item.kind === 'generate' || item.kind === 'edit') {
      activeTab.value = item.kind
    }
    const aspectIds = ASPECTS.map((a) => a.id)
    if (item.aspect && aspectIds.includes(item.aspect)) {
      aspect.value = item.aspect
    }
    const resIds = RESOLUTIONS.map((r) => r.id)
    if (item.resolution && resIds.includes(item.resolution)) {
      resolution.value = item.resolution
    }
    if (item.channelId && usableChannels.value.some((c) => c.id === item.channelId)) {
      selectChannel(item.channelId)
    }
    void persistDraft()
  }

  /**
   * 把画廊结果设为图生图主图：切到 edit、清空旧蒙版/参考图、写入源图。
   * 便于「生成 → 再编辑 / 局部精修」无需复制粘贴。
   */
  async function useAsEditSource(item: GalleryItem): Promise<boolean> {
    if (!item.src) return false
    if (hasActiveJob.value) return false

    activeTab.value = 'edit'
    await clearUploadFile('mask')
    await clearUploadFile('reference')

    const file = await dataUrlOrUrlToFile(item.src, `gallery-${item.id}.${extFromSrc(item.src, item.format)}`)
    const dataUrl = item.src.startsWith('data:') ? item.src : await fileToDataUrl(file)
    const ok = await setUploadFile('source', file, dataUrl)
    if (!ok) return false

    // 带上原提示词方便继续改；不强制改模型/渠道，避免打断当前线路选择
    if (item.prompt?.trim()) prompt.value = item.prompt.trim()
    void persistDraft()
    return true
  }

  function deleteImage(id: string): Promise<{ persisted: boolean }> {
    const currentEpoch = epoch
    const currentRevision = revision
    return enqueueGallery(async () => {
      if (!contextValid(currentEpoch, currentRevision)) return { persisted: false }
      const remaining = galleryItems.value.filter((i) => i.id !== id)
      return commitGallery(remaining, [], [id])
    })
  }

  /**
   * 清空画廊。
   * 走世代号机制：写入新世代号让所有旧记录立即失效，而不是逐条删 blob。
   * 因此即使有上千张图也是 O(1)，且在途写入不会把旧数据写回来。
   */
  async function clearGallery(): Promise<{ persisted: boolean }> {
    await hydrate()
    if (hasActiveJob.value) return { persisted: false }

    // 等在途写入结束，避免它们在世代切换后落回旧世代
    await Promise.all([
      jobQueue.catch(() => undefined),
      sourceQueue.catch(() => undefined),
      maskQueue.catch(() => undefined),
    ])

    const nextEpoch = `clear-${Date.now()}-${Math.random().toString(36).slice(2)}`
    revision += 1
    hydrated = false

    // 先重置 IndexedDB（清空整个 store 并写入新世代号）
    let ok = true
    if (storage.idbAvailable()) {
      ok = await storage.idbReset(nextEpoch)
    }
    if (!ok) {
      revision += 1
      return { persisted: false }
    }

    // 再写 localStorage 侧的世代号与元数据
    for (const key of [
      storage.LS_GALLERY_INDEX,
      storage.LS_GALLERY_META,
      storage.LS_GALLERY_PENDING_DELETE,
    ]) {
      lsRemove(key)
    }
    lsRemove(storage.LS_CHECKPOINT)
    storage.writeEpoch(nextEpoch)
    // 新世代的画廊索引为空
    lsSet(
      storage.LS_GALLERY_INDEX,
      JSON.stringify({ items: [], updatedAt: new Date().toISOString(), clearEpoch: nextEpoch }),
    )

    epoch = nextEpoch
    galleryItems.value = []
    galleryUpdatedAt = ''
    hydrated = true
    return { persisted: true }
  }

  /**
   * 清空所有本地数据（画廊、草稿、上传文件、端点与 Key 之外的业务数据）。
   * 同样走世代号，O(1)。
   */
  async function clearLocalData(): Promise<boolean> {
    await hydrate()
    if (hasActiveJob.value) return false

    const nextEpoch = `clear-${Date.now()}-${Math.random().toString(36).slice(2)}`
    revision += 1
    hydrated = false

    // 等所有在途写入结束
    await Promise.all([
      jobQueue.catch(() => undefined),
      sourceQueue.catch(() => undefined),
      maskQueue.catch(() => undefined),
    ])

    let ok = true
    if (storage.idbAvailable()) {
      ok = await storage.idbReset(nextEpoch)
    }
    if (!ok) return false

    // 彻底清掉 localStorage 元数据
    for (const key of [
      storage.LS_GALLERY_INDEX,
      storage.LS_GALLERY_META,
      storage.LS_DRAFT,
      storage.LS_CHECKPOINT,
      storage.LS_GALLERY_PENDING_DELETE,
    ]) {
      lsRemove(key)
    }
    lsRemove(storage.LS_SOURCE_FILE)
    lsRemove(storage.LS_MASK_FILE)

    epoch = nextEpoch
    storage.writeEpoch(nextEpoch)

    resetState()
    hydrated = true
    return true
  }

  function resetState() {
    prompt.value = ''
    resolution.value = 'auto'
    quality.value = 'medium'
    count.value = 1
    format.value = 'png'
    galleryItems.value = []
    galleryUpdatedAt = ''
    sourceFile.value = null
    maskFile.value = null
    referenceFiles.value = []
    sourcePreview.value = ''
    maskPreview.value = ''
    referencePreviews.value = []
    sourceStored.value = false
    maskStored.value = false
    referenceStored.value = false
  }

  // -------------------------------------------------------------- 渠道管理

  function selectChannel(id: string) {
    selectedChannelId.value = id
    lsSet(SELECTED_CHANNEL_STORE, id)
  }

  /** 从后端拉取渠道列表 */
  async function loadChannels(): Promise<Channel[]> {
    channelsLoading.value = true
    channelsError.value = ''
    try {
      const { channels: list } = await channelsApi.list()
      channels.value = list

      // 显式兜底选中项。
      // 不能只依赖 watch(usableChannels)：当选中项失效被清空时，
      // usableChannels 的值可能没有变化，watch 不会重新触发，
      // 结果就是渠道有值但 selectedChannelId 为空，提交按钮永远禁用。
      const usable = list.filter((c) => c.enabled && c.hasKey)
      const currentValid = usable.some((c) => c.id === selectedChannelId.value)
      if (!currentValid) {
        selectChannel(usable[0]?.id ?? '')
      }

      return list
    } catch (err) {
      channelsError.value = err instanceof Error ? err.message : '无法连接后端'
      return []
    } finally {
      channelsLoading.value = false
    }
  }

  async function createChannel(input: {
    name: string
    endpoint: string
    apiKey: string
    note?: string
  }): Promise<Channel> {
    const { channel } = await channelsApi.create(input)
    await loadChannels()
    return channel
  }

  async function updateChannel(
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
  ): Promise<Channel> {
    const { channel } = await channelsApi.update(id, input)
    await loadChannels()
    return channel
  }

  async function deleteChannel(id: string): Promise<void> {
    await channelsApi.remove(id)
    if (selectedChannelId.value === id) selectChannel('')
    await loadChannels()
  }

  /** 连通性测试，返回耗时与上游错误摘要 */
  /**
   * 探测某渠道**确认不可用**的模型并缓存。
   *
   * 只排除确定不可用的：后端发带 1×1 图的请求，模型没开通时会亚秒级返回
   * model_not_found（不出图不计费）；可用模型则只是超时，不下结论。
   * 这样每次切渠道最多几秒，且不烧钱。
   */
  /**
 * 取消某渠道里某个模型的「实测不可用」标记。
 *
 * 场景：渠道管理员后来开通了该模型，用户在渠道管理里点「恢复」，
 * 把模型放回下拉。黑名单只屏蔽不物理删除，就是为保留这个可能。
 */
async function unblockChannelModel(channelId: string, modelName: string): Promise<void> {
  if (!channelId || !modelName) return

  await channelsApi.unblockModel(channelId, modelName)

  // 本地渠道列表也要同步，否则对话框里还显示着屏蔽状态
  channels.value = channels.value.map((c) => {
    if (c.id !== channelId || !c.unavailableModels) return c
    const { [modelName]: _removed, ...rest } = c.unavailableModels
    return { ...c, unavailableModels: rest }
  })

  // 强制重新探测，让模型重新出现在下拉里
  channelModels.value = { ...channelModels.value, [channelId]: [] }
  await probeChannelModels(channelId, true)
}

async function probeChannelModels(channelId: string, force = false): Promise<void> {
    if (!channelId) return
    if (!force && channelModels.value[channelId]) return

    modelsProbing.value = true
    try {
      const { models } = await channelsApi.probeModels(channelId)
      channelModels.value = { ...channelModels.value, [channelId]: models }
      // 当前模型若被确认不可用，回退到第一个可用的
      const unavailable = models.filter((m) => m.available === false).map((m) => m.model)
      if (unavailable.includes(model.value)) {
        const fallback = models.find((m) => m.available !== false)
        if (fallback) {
          model.value = fallback.model
          void persistDraft()
        }
      }
    } catch {
      // 探测失败不做任何过滤
    } finally {
      modelsProbing.value = false
    }
  }

  /** 切换渠道时自动探测（只排除确定不可用的模型） */
  /**
   * 切换渠道时自动探测模型列表，拿到结果后若当前模型不在该渠道的支持列表里
   * 就回退到第一个可用模型 —— 否则用户会拿着上一条渠道的模型直接提交，然后报错。
   */
  watch(selectedChannelId, (id) => {
    if (!id) return
    void probeChannelModels(id).then(() => {
      const list = channelModels.value[id]
      // 探测未完成/失败时不过滤，保持当前选择
      if (!list || list.length === 0) return
      const supported = list.filter((m) => m.available).map((m) => m.model)
      if (supported.length === 0) return
      if (supported.includes(model.value)) return
      model.value = supported[0]
      void persistDraft()
    })
  })

  async function testChannel(
    id: string,
    opts: { model?: string; mode?: 'generate' | 'edit' } = {},
  ): Promise<{ ok: boolean; message: string; elapsed: number; modelBlocked?: boolean }> {
    const result = await channelsApi.test(id, opts)

    /**
     * 后端在真实请求失败且判定为「模型不可用」时，已把该模型记入渠道黑名单。
     * 这里必须清掉本地缓存重新探测，否则用户点了「测试」之后，
     * 模型下拉里那个不可用的选项还在 —— 看起来像没生效。
     */
    if (result.modelBlocked) {
      // 直接 delete 不触发响应式，要整体替换一次对象
      channelModels.value = { ...channelModels.value, [id]: [] }
      await probeChannelModels(id, true)
    }

    return {
      ok: result.ok,
      message: result.message,
      elapsed: result.elapsed,
      modelBlocked: result.modelBlocked,
    }
  }

  // ------------------------------------------------------------ 任务执行器

  /**
   * 串行执行生成/编辑任务。同一时刻只允许一个任务在跑（与原站一致）。
   * 返回 false 表示未能启动（已有任务在跑或上下文已失效）。
   */
  async function runJob(job: () => Promise<void>): Promise<boolean> {
    if (submittingKind.value) return false
    const currentEpoch = epoch
    const currentRevision = revision
    if (!contextValid(currentEpoch, currentRevision)) return false

    const ac = new AbortController()
    jobAbortController.value = ac
    submitting.value = true
    submittingKind.value = activeTab.value
    submittingPrompt.value = prompt.value.trim()
    submittingStartedAt.value = new Date().toISOString()
    batchDone.value = 0
    batchTotal.value = 0

    try {
      await job()
      return true
    } finally {
      if (contextValid(currentEpoch, currentRevision)) {
        clearJobFlags()
        void persistDraft(currentEpoch, currentRevision)
      } else {
        clearJobFlags()
      }
    }
  }

  // -------------------------------------------------------------------- API

  /**
   * 按渠道能力决定「比例怎么传」。
   *
   * 这是实测逼出来的分支，不同渠道语义完全相反：
   *  - `sizeViaPrompt !== true`（woyao）：比例走 `size` 参数，提示词原样发送。
   *  - `sizeViaPrompt === true`（TokenLab）：`size` 传了也没用（13 档实测全部
   *    返回 1536×1024，含完全合规的 3840×2160），必须把比例写进提示词。
   *    此时**不传 size** —— 传了会被忽略，白白误导日志和排查。
   *
   * 统一从这里出，避免文生图与图生图两条路径行为漂移。
   */
  function resolvePromptAndSize(channelId: string): {
    prompt: string
    size: string | null
    viaPrompt: boolean
  } {
    const base = prompt.value.trim()
    // 按传入的 channelId 查渠道，而不是读全局 selectedChannel ——
    // 批量重试可能换渠道，读全局会串味。
    const channel = channels.value.find((c) => c.id === channelId)
    if (channel?.sizeViaPrompt === true) {
      return {
        prompt: buildAspectPrompt(base, aspect.value),
        size: null,
        viaPrompt: true,
      }
    }
    return { prompt: base, size: computeSize(resolution.value, aspect.value), viaPrompt: false }
  }

  /**
   * 发起一次文生图请求（JSON，非 multipart）。
   *
   * 与图生图的差别只在请求体格式与是否带图，语义上完全一致：
   * 同样是每次 n=1、response_format=b64_json。
   */
  async function requestGenerate(
    channelId: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const { prompt: finalPrompt, size } = resolvePromptAndSize(channelId)
    const body: Record<string, unknown> = {
      model: model.value,
      prompt: finalPrompt,
      n: 1,
      response_format: 'b64_json',
    }
    if (size) body.size = size
    body.quality = assertValidQuality(quality.value)
    if (format.value !== 'png') body.output_format = format.value

    const response = await proxyGenerate(channelId, body, { signal })

    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { message: text }
    }

    if (!response.ok) {
      const error = payload.error as { message?: string } | undefined
      const message = error?.message ?? (payload.message as string | undefined) ?? text
      throw new Error(message || response.statusText || `HTTP ${response.status}`)
    }
    return parseImages(payload, format.value)
  }

  /**
   * 发起一次图生图请求（支持多图）。
   *
   * 多图的传法：同名 `image` 字段重复出现，OpenAI SDK 内部也是这样编码数组的。
   * 官方限制最多 16 张。mask 若存在只作用于第一张图（官方行为）。
   *
   * 请求发往本机后端，由后端注入渠道的 API Key 并转发到上游。
   * 前端全程不接触 Key。
   */
  async function requestEdit(
    channelId: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const files = inputFiles.value
    if (files.length === 0) throw new Error('缺少源图片')

    // 蒙版必须与主图同尺寸，否则上游可能白跑数分钟再报错
    if (maskFile.value) {
      await assertMaskMatchesSource(files[0], maskFile.value)
    }

    const { prompt: finalPrompt, size } = resolvePromptAndSize(channelId)

    const form = new FormData()
    form.append('model', model.value)
    form.append('prompt', finalPrompt)
    // 同名字段重复 = 数组
    for (const file of files) form.append('image', file)
    form.append('n', '1')
    form.append('response_format', 'b64_json')
    if (size) form.append('size', size)
    form.append('quality', assertValidQuality(quality.value))
    if (format.value !== 'png') form.append('output_format', format.value)
    if (maskFile.value) form.append('mask', maskFile.value)

    const response = await proxyEdit(channelId, form, { signal })

    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { message: text }
    }

    if (!response.ok) {
      const error = payload.error as { message?: string } | undefined
      const message = error?.message ?? (payload.message as string | undefined) ?? text
      throw new Error(message || response.statusText || `HTTP ${response.status}`)
    }
    return parseImages(payload, format.value)
  }

  /**
   * 并发受限的批量请求。
   *
   * 不是 n=N，而是 N 次 n=1；与原站一致。默认最多同时 2 路，
   * 避免 count=4 时打满上游限流与费用尖刺。每次出图立刻回调落库。
   */
  async function runBatch(
    total: number,
    channelId: string,
    kind: JobKind,
    onImages: (urls: string[]) => Promise<void>,
  ): Promise<string[]> {
    const signal = jobAbortController.value?.signal
    batchTotal.value = total
    batchDone.value = 0

    const send = kind === 'generate' ? requestGenerate : requestEdit
    const concurrency = Math.max(1, Math.min(batchConcurrency.value, total))
    const results: PromiseSettledResult<string[]>[] = new Array(total)
    let nextIndex = 0

    async function worker() {
      while (true) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        const i = nextIndex
        nextIndex += 1
        if (i >= total) return
        try {
          const urls = await send(channelId, signal)
          if (urls.length === 0) throw new Error('响应中不含图片')
          await onImages(urls)
          batchDone.value += 1
          results[i] = { status: 'fulfilled', value: urls }
        } catch (reason) {
          results[i] = { status: 'rejected', reason }
          // 硬失败时不再派新任务；已在途的仍跑完
          nextIndex = total
          throw reason
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () =>
      worker().then(
        () => undefined,
        () => undefined,
      ),
    )
    await Promise.all(workers)

    // 未开跑就被拦下的槽位标为 abort / 中止
    for (let i = 0; i < total; i++) {
      if (!results[i]) {
        results[i] = {
          status: 'rejected',
          reason: signal?.aborted
            ? new DOMException('Aborted', 'AbortError')
            : new Error('任务未执行'),
        }
      }
    }

    const aborted = results.some(
      (r) => r.status === 'rejected' && isAbortError(r.reason),
    )
    if (aborted) throw new DOMException('Aborted', 'AbortError')

    const failed = results.find((r) => r.status === 'rejected')
    if (failed) throw failed.reason

    const all = results
      .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .slice(0, total)
    if (all.length < total) throw new Error('返回图片数量不足')
    return all
  }

  return {
    // state
    prompt,
    resolution,
    aspect,
    model,
    quality,
    count,
    format,
    maxCount,
    activeTab,
    galleryItems,
    galleryFilter,
    sourceFile,
    referenceFiles,
    maskFile,
    sourcePreview,
    referencePreviews,
    maskPreview,
    channels,
    channelsLoading,
    channelsError,
    selectedChannelId,
    channelModels,
    modelsProbing,
    submitting,
    submittingKind,
    submittingPrompt,
    submittingStartedAt,
    batchDone,
    batchTotal,
    batchConcurrency,
    // getters
    selectedChannel,
    sizeViaPrompt,
    usableChannels,
    channelModelIds,
    unavailableModelSet,
    inputFiles,
    requestTarget,
    filteredGallery,
    hasActiveJob,
    // actions
    hydrate,
    persistDraft,
    setUploadFile,
    removeReference,
    clearUploadFile,
    addGalleryItems,
    applyFromGallery,
    useAsEditSource,
    deleteImage,
    clearGallery,
    clearLocalData,
    cancelJob,
    runJob,
    runBatch,
    requestEdit,
    requestGenerate,
    loadChannels,
    ensureChannelSelected,
    probeChannelModels,
    unblockChannelModel,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel,
    selectChannel,
    normalizedCount: () => countClamp(count.value, maxCount.value),
    clampCount: (max: number) => {
      count.value = countClamp(count.value, max)
      return count.value
    },
  }
})

/** 图片内容指纹。取长度 + 头尾片段，避免对 MB 级 base64 做整串哈希。 */
function imageFingerprint(src: string): string {
  const payload = src.startsWith('data:') ? src.slice(src.indexOf(',') + 1) : src
  if (payload.length <= 128) return payload
  return `${payload.length}:${payload.slice(0, 64)}:${payload.slice(-64)}`
}

/** 读取图片像素尺寸（File / Blob / data URL / http URL） */
function readImageSize(source: Blob | string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    const img = new Image()
    img.onload = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
      reject(new Error('无法读取图片尺寸'))
    }
    img.src = url
  })
}

async function assertMaskMatchesSource(source: File, mask: File): Promise<void> {
  const [a, b] = await Promise.all([readImageSize(source), readImageSize(mask)])
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `蒙版尺寸（${b.width}×${b.height}）与主图（${a.width}×${a.height}）不一致，请重新绘制或上传同尺寸蒙版`,
    )
  }
}

/** 把远程 URL 拉成 data URL，便于 IndexedDB 持久化 */
async function ensureLocalImageSrc(src: string): Promise<string> {
  if (!src) return src
  if (src.startsWith('data:')) return src
  if (!/^https?:\/\//i.test(src)) return src
  const response = await fetch(src)
  if (!response.ok) throw new Error(`下载结果图失败：HTTP ${response.status}`)
  const blob = await response.blob()
  return fileToDataUrl(new File([blob], 'remote.png', { type: blob.type || 'image/png' }))
}

function extFromSrc(src: string, fallback: OutputFormat = 'png'): string {
  if (fallback === 'jpeg') return 'jpg'
  if (fallback === 'webp') return 'webp'
  if (src.startsWith('data:image/jpeg')) return 'jpg'
  if (src.startsWith('data:image/webp')) return 'webp'
  return 'png'
}

async function dataUrlOrUrlToFile(src: string, filename: string): Promise<File> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`)
  const blob = await response.blob()
  const type = blob.type || 'image/png'
  return new File([blob], filename, { type })
}

/**
 * 解析上游响应，兼容 OpenAI 标准形态与 output[].result 形态。
 *
 * 坑（实测踩过）：woyao 返回的 `data[0]` **同时含 b64_json 和 url**，
 * 且 url 本身就是同一个 data URL（只多了 `data:image/png;base64,` 前缀）。
 * 早先写成「两个字段各 push 一次」，导致 n=1 的请求在画廊里出现两张
 * 完全一样的图，看起来像「生成数量翻倍」，实际是同一张被数了两遍。
 *
 * 因此这里做两件事：
 *  1. 每条记录只取一个来源（优先 b64_json，它是自包含的，不依赖 URL 有效期）
 *  2. 按归一化后的内容去重 —— 同一张图即使用不同字段表示也只保留一份
 */
export function parseImages(payload: Record<string, unknown>, fallbackFormat: OutputFormat): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  /** 归一化后作为去重键：剥掉 data URL 前缀，只比内容 */
  const dedupeKey = (src: string): string =>
    src.startsWith('data:') ? src.slice(src.indexOf(',') + 1) : src

  const push = (src: string) => {
    const key = dedupeKey(src)
    if (seen.has(key)) return
    seen.add(key)
    urls.push(src)
  }

  const data = payload.data
  if (Array.isArray(data)) {
    for (const item of data as Array<{ b64_json?: string; url?: string; revised_prompt?: string }>) {
      // 一条记录只取一个来源：b64_json 自包含，url 可能是会过期的临时地址
      const src = item.b64_json
        ? toDataUrl(item.b64_json, fallbackFormat)
        : item.url
      if (src) push(src)
    }
  }

  const output = payload.output
  if (Array.isArray(output)) {
    for (const item of output as Array<{ result?: string; b64_json?: string; image_url?: string }>) {
      const raw = item.result || item.b64_json || item.image_url
      if (!raw) continue
      push(raw.startsWith('http') || raw.startsWith('data:') ? raw : toDataUrl(raw, fallbackFormat))
    }
  }

  return urls
}

function toDataUrl(base64: string, format: OutputFormat): string {
  if (base64.startsWith('data:')) return base64
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`
  return `data:${mime};base64,${base64}`
}

/** 图片 → PNG Blob（非 PNG 时经 canvas 转码，用于复制到剪贴板） */
export async function toPngBlob(src: string): Promise<Blob> {
  const raw = src.startsWith('data:') ? await dataUrlToBlobStrict(src) : await (await fetch(src)).blob()
  if (raw.type === 'image/png') return raw

  return new Promise<Blob>((resolve, reject) => {
    const objectURL = URL.createObjectURL(raw)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectURL)
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas 不可用'))
        return
      }
      ctx.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('图片编码失败'))
          return
        }
        resolve(blob)
      }, 'image/png')
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectURL)
      reject(new Error('图片加载失败'))
    }
    image.src = objectURL
  })
}

/** data URL → Blob。用 fetch 走浏览器原生解码，避免 atob 循环卡死主线程。 */
async function dataUrlToBlobStrict(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

