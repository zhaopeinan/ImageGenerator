<script setup lang="ts">
/**
 * 图像编辑主页面。
 *
 * 布局与交互移植自 sub2api 原站产物 ImageGeneratorView-Cp8RDZb3.js，
 * 去掉 generate 分支，保留 edit 的完整能力（源图 + 蒙版 + 参数 + 画廊）。
 *
 * 渠道与 API Key 由后端保管，前端只持有渠道 ID。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ChannelsDialog from './components/ChannelsDialog.vue'
import MaskPanel from './components/MaskPanel.vue'
import SelectBox from './components/SelectBox.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import UploadZone from './components/UploadZone.vue'
import { toPngBlob, useEditorStore } from './composables/useEditorStore'
import { isAbortError } from './utils/api'
import { GALLERY_LIMIT, MAX_INPUT_IMAGES } from './types'
import type { GalleryItem, OutputFormat, Quality } from './types'
import {
  ASPECTS,
  RESOLUTIONS,
  computeSize,
  findModel,
  findResolution,
  isModelUsable,
  modelBadge,
  usableModels,
} from './types/models'
import { fileToDataUrl } from './utils/storage'

const store = useEditorStore()

const channelsOpen = ref(false)
const settingsOpen = ref(false)
const confirmState = ref<{ kind: 'delete' | 'clear'; id?: string } | null>(null)
/** 当前展开详情的画廊条目 id，空串表示收起 */
const expandedItem = ref('')
/** 灯箱当前展示的画廊条目；null 表示未打开 */
const lightboxItem = ref<GalleryItem | null>(null)
const testResults = ref<Record<string, { ok: boolean; message: string }>>({})

const toasts = ref<{ id: number; message: string; kind: 'success' | 'error' }[]>([])
let toastSeed = 0

function notify(message: string, kind: 'success' | 'error' = 'success') {
  const id = ++toastSeed
  toasts.value.push({ id, message, kind })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 4000)
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const canSubmit = computed(() => {
  if (store.hasActiveJob) return false
  if (!store.selectedChannel) return false
  if (!store.prompt.trim()) return false
  // 图生图必须上传源图；文生图不需要
  if (store.activeTab === 'edit' && !store.sourceFile) return false
  return true
})

const submitHint = computed(() => {
  if (store.hasActiveJob) return ''
  if (store.channelsLoading) return '正在加载渠道…'
  if (store.channels.length === 0) return '请先在渠道管理中添加一个渠道'
  if (store.usableChannels.length === 0) return '没有可用渠道，请检查是否禁用或未填 Key'
  if (!store.prompt.trim()) return '请输入生成描述或编辑指令'
  if (store.activeTab === 'edit' && !store.sourceFile) return '图生图模式下请上传源图'
  return ''
})

/** 任务进行中的进度文案：张数 + 已用时 */
const jobElapsedSec = ref(0)
let jobElapsedTimer: number | null = null

const jobProgressLabel = computed(() => {
  if (!store.hasActiveJob) return ''
  const verb = store.submittingKind === 'edit' ? '编辑中' : '生成中'
  const total = store.batchTotal
  const done = store.batchDone
  const progress = total > 1 ? ` ${done}/${total}` : ''
  const elapsed = jobElapsedSec.value > 0 ? ` · ${jobElapsedSec.value}s` : ''
  return `${verb}${progress}${elapsed}`
})

watch(
  () => store.hasActiveJob,
  (active) => {
    if (jobElapsedTimer !== null) {
      window.clearInterval(jobElapsedTimer)
      jobElapsedTimer = null
    }
    jobElapsedSec.value = 0
    if (!active) return
    jobElapsedTimer = window.setInterval(() => {
      jobElapsedSec.value += 1
    }, 1000)
  },
)

type UploadSlot = 'source' | 'reference' | 'mask'

async function onPick(slot: UploadSlot, files: File[]) {
  const valid = files.filter((f) => ACCEPTED_TYPES.has(f.type))
  if (valid.length === 0) {
    notify('仅支持 PNG / JPEG / WebP 格式', 'error')
    return
  }
  if (valid.length < files.length) {
    notify(`已跳过 ${files.length - valid.length} 个不支持的文件`, 'error')
  }

  // 参考图受总上限约束
  let accepted = valid
  if (slot === 'reference') {
    const room = MAX_INPUT_IMAGES - store.inputFiles.length
    if (room <= 0) {
      notify(`最多 ${MAX_INPUT_IMAGES} 张输入图`, 'error')
      return
    }
    if (valid.length > room) {
      notify(`超出上限，仅添加前 ${room} 张`, 'error')
      accepted = valid.slice(0, room)
    }
  }

  for (const file of accepted) {
    const dataUrl = await fileToDataUrl(file)
    const ok = await store.setUploadFile(slot, file, dataUrl)
    if (!ok) {
      notify('本地存储写入失败，数据可能无法保留', 'error')
      return
    }
  }
}

async function onClearUpload(slot: UploadSlot) {
  await store.clearUploadFile(slot)
}

/**
 * 全屏精绘确认后收到的遮罩 data URL，转成 File 走标准持久化链路。
 * 必须是 PNG —— 官方要求 mask 带 alpha 通道，JPG 会被当作整图可改。
 */
async function onMaskPainted(maskDataUrl: string) {
  const ok = await dataUrlToFile(maskDataUrl, 'mask.png')
  if (!ok) notify('遮罩写入本地存储失败，可能无法保留', 'error')
}

/** data URL → File（画布导出的是 PNG blob） */
async function dataUrlToFile(dataUrl: string, filename: string): Promise<boolean> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const file = new File([blob], filename, { type: 'image/png' })
  return store.setUploadFile('mask', file, dataUrl)
}

async function submit() {
  if (!canSubmit.value) return
  const channel = store.selectedChannel
  if (!channel) return
  const kind = store.activeTab

  await store.runJob(async () => {
    const total = store.normalizedCount()
    const jobPrompt = store.prompt
    try {
      await store.runBatch(total, channel.id, kind, async (urls) => {
        const result = await store.addGalleryItems(urls, jobPrompt, kind)
        if (!result.persisted) {
          notify('画廊写入失败，结果可能无法保留', 'error')
        }
      })
      notify(`${kind === 'generate' ? '生成' : '编辑'}完成，已产出 ${total} 张`)
    } catch (err) {
      const done = store.batchDone
      if (isAbortError(err)) {
        notify(
          done > 0
            ? `已取消，保留已完成的 ${done} 张`
            : '已取消',
        )
        return
      }
      const base = describeError(err)
      notify(
        done > 0
          ? `${base}（已保留完成的 ${done}/${total} 张）`
          : base,
        'error',
      )
      suggestAlternateChannel(err)
    }
  })
}

function cancelSubmit() {
  if (!store.hasActiveJob) return
  store.cancelJob()
}

/** 把底层错误翻译成人话 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return '请求失败'
  if (isAbortError(err)) return '已取消'
  const text = err.message

  // 模型未开通是最常见的失败原因，给明确指引而不是干巴巴的英文错误
  if (text.includes('model_not_found') || text.includes('not supported by any configured account')) {
    return `当前渠道未开通模型「${store.model}」，请换一个模型或线路`
  }
  if (text.includes('image file is required')) return '请先上传源图片'
  if (text.includes('响应超时') || text.includes('timeout')) {
    return '上游响应超时。4K 分辨率可能需要 3 分钟以上，建议重试或换线路'
  }
  if (isNetworkError(err)) return '网络请求失败，请检查网络或换渠道'
  if (text.includes('缺少源图片')) return '请先上传待编辑的图片'
  if (text.includes('蒙版尺寸')) return text
  if (text.includes('响应中不含图片')) return '响应中不含图片'
  if (text.includes('返回图片数量不足')) return '返回图片数量不足'
  if (text.includes('客户端已取消')) return '已取消'
  return text || '请求失败'
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false
  const text = err.message.toLowerCase()
  return (
    text.includes('load failed') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed')
  )
}

/** 网络失败时提示切换渠道（不自动重试，避免重复计费） */
function suggestAlternateChannel(err: unknown) {
  if (!isNetworkError(err)) return
  const currentId = store.selectedChannelId
  const alternative = store.usableChannels.find((c) => c.id !== currentId)
  if (!alternative) return
  const ok = window.confirm(
    `当前渠道连接失败。\n\n是否切换到「${alternative.name}」？\n${alternative.endpoint}`,
  )
  if (ok) {
    store.selectChannel(alternative.id)
    notify(`已切换到 ${alternative.name}`)
  }
}

// ------------------------------------------------------------ 渠道操作

async function refreshChannels() {
  await store.loadChannels()
}

async function createChannel(input: { name: string; endpoint: string; apiKey: string; note?: string }) {
  await store.createChannel(input)
  notify(`渠道「${input.name}」已添加`)
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
) {
  await store.updateChannel(id, input)
  notify('渠道已更新')
}

async function removeChannel(id: string) {
  await store.deleteChannel(id)
  notify('渠道已删除')
}

async function testChannel(id: string) {
  try {
    // 按当前模式与所选模型测 —— 不同渠道开通的子模型不同，
    // 写死模型会误判。mode 传当前页签，「仅生图」模型在 edit 下失败属预期。
    const result = await store.testChannel(id, {
      model: store.model,
      mode: store.activeTab,
    })
    testResults.value = { ...testResults.value, [id]: { ok: result.ok, message: result.message } }
    if (result.modelBlocked) {
      // 该模型已被后端记入黑名单，模型下拉已自动刷新
      notify(`${result.message}（已从模型列表移除）`, 'error')
      return
    }
    notify(result.message, result.ok ? 'success' : 'error')
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试失败'
    testResults.value = { ...testResults.value, [id]: { ok: false, message } }
    notify(message, 'error')
  }
}

// ------------------------------------------------------------ 画廊操作

function downloadName(item: GalleryItem): string {
  const ext = item.format === 'jpeg' ? 'jpg' : item.format
  return `image-edit-${item.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.${ext}`
}

/** data URL → Blob。用 fetch 走原生解码，避免 atob 逐字节循环卡死主线程。 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return response.blob()
}

async function downloadImage(item: GalleryItem) {
  try {
    const blob = item.src.startsWith('data:')
      ? await dataUrlToBlob(item.src)
      : await (await fetch(item.src)).blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName(item)
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    notify('下载失败', 'error')
  }
}

async function copyImage(item: GalleryItem) {
  try {
    const blob = await toPngBlob(item.src)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    notify('图片已复制到剪贴板')
  } catch {
    notify('复制失败，浏览器可能不支持图片写入剪贴板', 'error')
  }
}

async function copyDataUrl(item: GalleryItem) {
  try {
    await navigator.clipboard.writeText(item.src)
    notify('图片数据已复制')
  } catch {
    notify('复制失败', 'error')
  }
}

/**
 * 检测某渠道的模型可用性。
 *
 * 探测本身零费用（读渠道声明 + 快速失败排除）；
 * 真正会花钱的是「测试」，那条路径才写入黑名单。
 */
async function probeModels(id: string) {
  const result = await store.probeChannelModels(id, true)
  if (!result.ok) {
    notify(result.message || '更新模型列表失败', 'error')
    return
  }
  const blocked = [...store.unavailableModelSet]
  const available = store.channelModelIds
  if (available.length === 0) {
    notify('未能读取该渠道的模型列表，请检查端点或 Key', 'error')
    return
  }
  if (blocked.length === 0) {
    notify(`该渠道可用模型 ${available.length} 个：${available.join('、')}`)
  } else {
    notify(`可用 ${available.length} 个；已屏蔽 ${blocked.length} 个：${blocked.join('、')}`)
  }
}

async function refreshCurrentModels() {
  const id = store.selectedChannelId
  if (!id) {
    notify('请先选择渠道', 'error')
    return
  }
  await probeModels(id)
}

const tryModelDraft = ref('')
const tryingModel = ref(false)

async function tryModelOnChannel(
  id: string,
  modelName: string,
  opts: { force?: boolean } = {},
) {
  const result = await store.tryChannelModel(id, modelName, opts)
  if (result.ok) {
    await refreshChannels()
    notify(result.message)
    return result
  }
  if (result.canForce && !opts.force) {
    const ok = window.confirm(`${result.message}\n\n仍要强制加入下拉吗？`)
    if (ok) return tryModelOnChannel(id, modelName, { force: true })
  }
  notify(result.message, 'error')
  return result
}

async function submitTryModel() {
  const id = store.selectedChannelId
  const name = tryModelDraft.value.trim()
  if (!id) {
    notify('请先选择渠道', 'error')
    return
  }
  if (!name) {
    notify('请填写要试用的模型名', 'error')
    return
  }
  tryingModel.value = true
  try {
    const result = await tryModelOnChannel(id, name)
    if (result.ok) tryModelDraft.value = ''
  } finally {
    tryingModel.value = false
  }
}

/**
 * 恢复被屏蔽的模型到下拉。
 *
 * 黑名单只屏蔽不物理删除 —— 渠道管理员后来开通了模型时，
 * 用户可以在这里放回。若渠道其实仍不可用，选了会报错，再测一次又会被屏蔽。
 */
async function unblockModel(id: string, modelName: string) {
  try {
    await store.unblockChannelModel(id, modelName)
    await refreshChannels()
    notify(`已恢复 ${modelName}，可重新选择`)
  } catch (err) {
    notify(err instanceof Error ? err.message : '恢复失败', 'error')
  }
}

async function removeExtraModel(id: string, modelName: string) {
  try {
    await store.removeChannelExtraModel(id, modelName)
    await refreshChannels()
    notify(`已移除试用模型 ${modelName}`)
  } catch (err) {
    notify(err instanceof Error ? err.message : '移除失败', 'error')
  }
}

// ------------------------------------------------------------ 画廊操作

function requestDelete(item: GalleryItem) {
  confirmState.value = { kind: 'delete', id: item.id }
}

/** 点击画廊缩略图，放大查看大图 */
function openLightbox(item: GalleryItem) {
  lightboxItem.value = item
}

function closeLightbox() {
  lightboxItem.value = null
}

/** 灯箱内左右切换，范围是当前筛选下的画廊，到头循环 */
function stepLightbox(delta: number) {
  const list = store.filteredGallery
  if (!lightboxItem.value || list.length === 0) return
  const index = list.findIndex((it) => it.id === lightboxItem.value!.id)
  const base = index >= 0 ? index : 0
  lightboxItem.value = list[(base + delta + list.length) % list.length]
}

/** 展开/收起某张图的详情。同时只能展开一张，避免画廊被撑得很乱。 */
function toggleExpand(id: string) {
  expandedItem.value = expandedItem.value === id ? '' : id
}

async function copyPrompt(item: GalleryItem) {
  try {
    await navigator.clipboard.writeText(item.prompt)
    notify('提示词已复制')
  } catch {
    notify('复制失败', 'error')
  }
}

/** 一键回填提示词与参数到左侧表单，方便微调后再生成 */
function refillFromGallery(item: GalleryItem) {
  store.applyFromGallery(item)
  notify('已回填提示词与参数')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 把画廊图设为图生图主图，可继续整图编辑或画蒙版局部精修 */
async function useAsEditSource(item: GalleryItem) {
  if (store.hasActiveJob) {
    notify('请先等待或取消当前任务', 'error')
    return
  }
  try {
    const ok = await store.useAsEditSource(item)
    if (!ok) {
      notify('带入图生图失败', 'error')
      return
    }
    notify('已带到图生图，可直接编辑或绘制遮罩')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (err) {
    notify(err instanceof Error ? err.message : '带入图生图失败', 'error')
  }
}

function requestClear() {
  if (store.galleryItems.length === 0) return
  confirmState.value = { kind: 'clear' }
}

async function runConfirm() {
  const state = confirmState.value
  confirmState.value = null
  if (!state) return
  if (state.kind === 'delete' && state.id) {
    const result = await store.deleteImage(state.id)
    if (!result.persisted) notify('删除未完全生效，刷新后可能恢复', 'error')
    return
  }
  const result = await store.clearGallery()
  if (!result.persisted) notify('清空未完全生效，刷新后可能恢复', 'error')
}

async function wipeAll() {
  if (!window.confirm('将清空全部本地数据（画廊、草稿、上传文件）。\n渠道与 API Key 保留在后端，不受影响。\n\n确定？')) return
  const ok = await store.clearLocalData()
  if (ok) notify('本地数据已清空')
  else notify('清空失败', 'error')
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!store.hasActiveJob) return
  event.preventDefault()
  event.returnValue = ''
}

function onKeyDown(event: KeyboardEvent) {
  // 灯箱层级最高：Esc 关闭，左右键切换图片
  if (lightboxItem.value) {
    if (event.key === 'Escape') {
      lightboxItem.value = null
    } else if (event.key === 'ArrowLeft') {
      stepLightbox(-1)
    } else if (event.key === 'ArrowRight') {
      stepLightbox(1)
    } else {
      return
    }
    event.preventDefault()
    return
  }
  if (event.key !== 'Escape') return
  // 弹层优先关闭，再取消生成
  if (confirmState.value) {
    confirmState.value = null
    event.preventDefault()
    return
  }
  if (channelsOpen.value) {
    channelsOpen.value = false
    event.preventDefault()
    return
  }
  if (settingsOpen.value) {
    settingsOpen.value = false
    event.preventDefault()
    return
  }
  if (!store.hasActiveJob) return
  event.preventDefault()
  cancelSubmit()
}

watch(
  () => store.prompt,
  () => {
    void store.persistDraft()
  },
)

watch(
  [
    () => store.quality,
    () => store.format,
    () => store.resolution,
    () => store.aspect,
    () => store.model,
  ],
  () => {
    void store.persistDraft()
  },
)

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onKeyDown)
  // 顺序很重要：先拉渠道（会兜底选中一个可用渠道），
  // 再恢复草稿。若并发执行，两者都写 selectedChannelId，谁后执行谁赢，不确定。
  await store.loadChannels()
  await store.hydrate()
  store.ensureChannelSelected()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onKeyDown)
  if (jobElapsedTimer !== null) {
    window.clearInterval(jobElapsedTimer)
    jobElapsedTimer = null
  }
})

/**
 * 质量档位。
 *
 * `tokens` 是本机实测的 output_tokens 相对倍数（同模型、同尺寸、gpt-image-2）：
 *   low=425  medium=1650  high=6500
 * 即 high 的推理开销约为 low 的 **15 倍**。
 *
 * 这个差异**远大于分辨率**（1K→4K 只贵 $0.10→$0.20），
 * 所以质量才是成本与细节的主要杠杆。
 */
const QUALITY_OPTIONS: { value: Quality; label: string; hint: string; tokens: number }[] = [
  { value: 'low', label: '低（快）', hint: '省', tokens: 1 },
  { value: 'medium', label: '中（默认）', hint: '均衡', tokens: 4 },
  { value: 'high', label: '高（精细）', hint: '贵', tokens: 15 },
]

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'png', label: 'PNG（无损）' },
  { value: 'jpeg', label: 'JPEG（体积小）' },
  { value: 'webp', label: 'WebP（均衡）' },
]

/**
 * 模型选项。三层过滤：
 *  1. 按当前模式过滤（图生图排除「仅支持文生图」的模型）
 *  2. 排除**该渠道已确认不可用**的模型 —— 不同渠道开通情况不同，
 *     且受 Key 所属分组限制（实测 woyao 文档写可用但分组没开通照样 404）。
 *     只排除后端探测到 model_not_found 的，未确认的一律保留。
 *  3. 探测结果与内置列表完全不相交时不过滤（渠道可能用了别的模型名）。
 */
/**
 * 模型下拉的唯一数据源：当前渠道**实际支持**的模型。
 *
 * 之前是「全局列表 − 探测排除集」，在 TokenLab 上失效（它不校验模型名，
 * 一个都排除不掉），导致 woyao 专属的 gpt-image-2-x 也出现在 TokenLab 下拉里。
 * 改成正列表后，选哪个渠道就只显示哪个渠道的模型。
 *
 * 探测未完成时 channelModelIds 为空，usableModels 会降级用内置兜底列表。
 */
const modelOptions = computed(() => {
  const id = store.selectedChannelId
  // undefined = 尚未探测 → 用内置兜底；已探测（含空数组）则严格用渠道结果
  const probed = id ? store.channelModels[id] : undefined
  if (probed === undefined) return usableModels(store.activeTab, null)
  return usableModels(store.activeTab, store.channelModelIds)
})

const modelSelectOptions = computed(() =>
  modelOptions.value.map((m) => ({
    value: m.id,
    label: m.id,
    hint: m.note,
  })),
)

const channelOptions = computed(() =>
  store.usableChannels.map((c) => ({ value: c.id, label: c.name })),
)

const formatOptions = computed(() =>
  FORMAT_OPTIONS.map((f) => ({ value: f.value, label: f.label })),
)

/** 探测是否正在进行 —— 用于在模型旁提示 */
const isProbingModels = computed(() => store.modelsProbing)

const currentModelInfo = computed(() => findModel(store.model))
const currentResolution = computed(() => findResolution(store.resolution))

/** 实际会传给上游的 size，用于在界面上明确显示 */
const actualSize = computed(() => {
  // 该渠道只认提示词时，size 压根不会发出去，不能报一个从未传给上游的尺寸
  if (store.sizeViaPrompt) return '由渠道按提示词决定'
  const size = computeSize(store.resolution, store.aspect)
  return size ?? '由上游决定'
})

/** 比例按钮里的示意方块，按真实宽高比呈现 */
function aspectShapeStyle(aspect: string): Record<string, string> {
  const info = ASPECTS.find((a) => a.id === aspect)
  if (!info) return {}
  const { w, h } = info.base
  const max = 18
  const scale = max / Math.max(w, h)
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` }
}

/**
 * 本次预计花费。
 *
 * 之前只按分辨率算，**完全忽略了 quality** —— 而 quality 恰恰是成本的主要杠杆
 * （woyao 实测 output_tokens：low 425 / medium 1650 / high 6500，相差 15 倍）。
 *
 * 但要注意：**不是所有渠道都透传 quality**。实测 TokenLab 三档体积几乎无差异
 * （极差 0.5%），说明上游不透传，选了也没用 —— 这类渠道三档应按同价计算。
 *
 * 算法：
 *  - 渠道不透传 quality → 只按分辨率算，并提示该渠道不支持此参数
 *  - 渠道透传 quality（woyao）→ 以 low 档为基准 × 实测 token 倍数
 *  - 未验证（null）→ 保守按透传处理，但标注「未验证」
 *
 * 注意：这是**参考值**。真实账单以渠道为准。
 */
const qualityOption = computed(
  () => QUALITY_OPTIONS.find((q) => q.value === store.quality) ?? QUALITY_OPTIONS[1],
)

/** 当前渠道是否真的把 quality 透传给上游 */
const qualitySupported = computed(() => {
  const flag = store.selectedChannel?.qualityPassthrough
  // null / undefined = 未验证，保守放行
  return flag !== false
})

const qualitySelectOptions = computed(() =>
  QUALITY_OPTIONS.map((q) => ({
    value: q.value,
    label: q.label,
    hint: qualitySupported.value ? `${q.tokens}×` : '',
  })),
)

/** 单张参考单价 */
const perImageCost = computed(() => {
  // size 不生效的渠道没有「2K/4K」概念，档位价对它无意义，
  // 统一按 auto/1K 基准价算，避免给出虚高的预估。
  const basePrice = store.sizeViaPrompt
    ? (RESOLUTIONS[0]?.price ?? 0.1)
    : currentResolution.value?.price ?? 0.1
  if (!qualitySupported.value) return basePrice
  return basePrice * qualityOption.value.tokens
})

const estimatedCost = computed(() =>
  `${(perImageCost.value * store.count).toFixed(2)} 美元`,
)

// 切换模式时，若当前模型在目标模式不可用则回退到 gpt-image-2
watch(
  () => store.activeTab,
  (tab) => {
    if (!isModelUsable(store.model, tab)) store.model = 'gpt-image-2'
    void store.persistDraft()
  },
)
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="app-brand">
        <div class="app-mark-wrap" aria-hidden="true">
          <img
            class="app-mark"
            src="/brand-mark.png"
            width="48"
            height="48"
            alt=""
          >
        </div>
        <div class="app-brand-text">
          <div class="app-title-row">
            <h1 class="app-title">神笔</h1>
            <span class="app-wordmark">SHENBI</span>
          </div>
          <p class="app-subtitle">
            <span class="app-mode">文生图</span>
            <span class="app-dot" aria-hidden="true" />
            <span class="app-mode">图生图</span>
            <span class="app-dot" aria-hidden="true" />
            <span class="app-mode">局部精修</span>
          </p>
        </div>
      </div>
      <div class="app-header-actions">
        <button
          type="button"
          class="button"
          @click="channelsOpen = true"
        >
          渠道
        </button>
        <button
          type="button"
          class="button button-ghost"
          @click="settingsOpen = true"
        >
          设置
        </button>
        <button
          type="button"
          class="button button-ghost button-danger"
          @click="wipeAll"
        >
          清空数据
        </button>
      </div>
    </header>

    <div class="workspace">
      <!-- 左：编辑面板 -->
      <section class="panel">
        <div class="field">
          <label
            class="label"
            for="channel"
          >渠道</label>
          <SelectBox
            id="channel"
            v-if="store.usableChannels.length > 0"
            v-model="store.selectedChannelId"
            :options="channelOptions"
            placeholder="选择渠道"
          />
          <div
            v-else
            class="notice notice-warn"
          >
            {{ store.channelsLoading ? '正在加载渠道…' : '尚无可用渠道' }}
            <button
              type="button"
              class="button button-sm"
              style="margin-left: auto"
              @click="channelsOpen = true"
            >
              去添加
            </button>
          </div>
          <p class="hint">
            请求经本机后端转发到 <code v-if="store.selectedChannel">{{ store.selectedChannel.endpoint }}</code><span
              v-else
            >上游渠道</span>，Key 由后端注入。
          </p>
        </div>

        <!-- 模式切换 -->
        <nav class="tabs" aria-label="生成模式">
          <button
            type="button"
            class="tab"
            :class="{ active: store.activeTab === 'generate' }"
            @click="store.activeTab = 'generate'"
          >
            文生图
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: store.activeTab === 'edit' }"
            @click="store.activeTab = 'edit'"
          >
            图生图
          </button>
        </nav>

        <form @submit.prevent="submit">
          <div
            v-if="store.activeTab === 'edit'"
            class="upload-grid"
          >
            <UploadZone
              label="主图"
              hint="点击 / 拖拽 / 粘贴"
              :preview="store.sourcePreview"
              @pick="onPick('source', $event)"
              @clear="onClearUpload('source')"
            />
            <UploadZone
              label="附加参考图（可选）"
              :hint="`可多选，最多 ${MAX_INPUT_IMAGES - 1} 张`"
              :previews="store.referencePreviews"
              multiple
              @pick="onPick('reference', $event)"
              @clear="onClearUpload('reference')"
            />
          </div>

<MaskPanel
            v-if="store.activeTab === 'edit'"
            :source-preview="store.sourcePreview"
            :mask-preview="store.maskPreview"
            @change="onMaskPainted"
            @upload="onPick('mask', $event)"
            @clear="onClearUpload('mask')"
          />

          <p
            v-if="store.activeTab === 'edit' && store.inputFiles.length > 1"
            class="hint"
            style="margin: -0.5rem 0 1rem"
          >
            共 {{ store.inputFiles.length }} 张输入图。提示词里可用「第1张」「第2张」指代，
            顺序即上传顺序。
          </p>

          <div class="field">
            <label
              class="label"
              for="prompt"
            >{{ store.activeTab === 'generate' ? '生成描述' : '编辑指令' }}</label>
            <textarea
              id="prompt"
              v-model="store.prompt"
              class="textarea"
              rows="5"
              :placeholder="
                store.activeTab === 'generate'
                  ? '例：一只橘猫坐在窗台，午后阳光，胶片质感'
                  : '例：把背景换成雪山，人物保留；或：去掉画面中的电线'
              "
            />
          </div>

          <div class="field">
            <label
              class="label"
              for="quality"
            >质量</label>
            <SelectBox
              id="quality"
              v-model="store.quality"
              :options="qualitySelectOptions"
              :disabled="!qualitySupported"
            />
            <p
              v-if="!qualitySupported"
              class="hint hint-warn"
            >
              该渠道不透传此参数，三档画质实测无差异，选哪档都一样。
            </p>
          </div>

          <div class="field">
            <label
              class="label"
              for="model"
            >
              模型
              <span class="hint" style="display: inline; margin-left: 0.5rem">子渠道</span>
            </label>
            <div class="model-toolbar">
              <SelectBox
                id="model"
                v-model="store.model"
                :options="modelSelectOptions"
                placeholder="选择模型"
                empty-text="该渠道未提供图像模型"
              />
              <button
                type="button"
                class="button button-sm"
                :disabled="!store.selectedChannelId || isProbingModels"
                title="重新拉取当前渠道支持的模型列表（不产生出图费用）"
                @click="refreshCurrentModels"
              >
                {{ isProbingModels ? '更新中' : '更新模型' }}
              </button>
            </div>
            <div class="try-model-row">
              <input
                v-model="tryModelDraft"
                class="input"
                placeholder="试用新模型，如 gpt-image-2.6"
                :disabled="!store.selectedChannelId || tryingModel"
                @keydown.enter.prevent="submitTryModel()"
              >
              <button
                type="button"
                class="button button-sm"
                :disabled="!store.selectedChannelId || tryingModel || !tryModelDraft.trim()"
                title="探测上游是否接受该模型名；通过后加入下拉"
                @click="submitTryModel()"
              >
                {{ tryingModel ? '探测中' : '试用' }}
              </button>
            </div>
            <p
              v-if="isProbingModels"
              class="hint"
            >
              正在读取该渠道的模型列表…
            </p>
            <p
              v-else-if="currentModelInfo"
              class="hint"
            >
              {{ modelBadge(currentModelInfo, store.activeTab).text }} ·
              单张 {{ currentResolution?.price.toFixed(2) ?? '0.10' }} 美元（{{ currentModelInfo.price?.tier4.toFixed(2) ?? '0.20' }} 美元 @4K）
            </p>
          </div>

          <div class="field">
            <label class="label">画面比例</label>
            <div class="aspect-group">
              <button
                v-for="a in ASPECTS"
                :key="a.id"
                type="button"
                class="aspect-btn"
                :class="{ active: store.aspect === a.id }"
                :title="`${a.id} · ${a.label}`"
                @click="store.aspect = a.id"
              >
                <span
                  class="aspect-shape"
                  :style="aspectShapeStyle(a.id)"
                />
                <span class="aspect-label">{{ a.id }}</span>
              </button>
            </div>
            <!-- 该渠道只认提示词时，比例的实现方式完全不同，必须说清楚 -->
            <p
              v-if="store.sizeViaPrompt"
              class="hint hint-warn"
            >
              当前渠道<strong>不接受 size 参数</strong>，比例会自动追加到提示词末尾。
              实测 16:9 → 1672×941、9:16 → 941×1672、1:1 → 1254×1254，
              所以输出尺寸由渠道决定，画廊显示的是实际尺寸。
            </p>
            <p
              v-else
              class="hint"
            >
              比例由 size 参数控制，<strong>提示词里写「16:9」无效</strong>。当前输出
              {{ actualSize }}。
            </p>
          </div>

          <div class="field">
            <label class="label">分辨率</label>
            <div class="tier-group" :class="{ disabled: store.sizeViaPrompt }">
              <button
                v-for="r in RESOLUTIONS"
                :key="r.id"
                type="button"
                class="tier"
                :class="{ active: store.resolution === r.id }"
                :disabled="store.sizeViaPrompt"
                :title="store.sizeViaPrompt ? '该渠道不接受 size 参数，档位不生效' : ''"
                @click="store.resolution = r.id"
              >
                <span class="tier-label">{{ r.label }}</span>
                <span class="tier-price">${{ r.price.toFixed(2) }}</span>
              </button>
            </div>
            <p class="hint">
              <template v-if="store.sizeViaPrompt">
                <strong>该渠道不支持分辨率档位</strong>（size 参数无效），
                费用按实际生成计。质量设置{{ qualitySupported ? '仍然生效' : '同样不透传' }}。
              </template>
              <template v-else>
                本次预计 <strong>{{ estimatedCost }}</strong>（{{ store.count }} 张 ×
                {{ perImageCost.toFixed(2) }} 美元）
                <template v-if="qualitySupported && qualityOption.tokens > 1">
                  · 质量「{{ qualityOption.label }}」约消耗 {{ qualityOption.tokens }}× 推理量
                </template>
              </template>
            </p>
          </div>

          <div class="grid-2">
            <div class="field">
              <label
                class="label"
                for="count"
              >生成张数</label>
              <input
                id="count"
                v-model.number="store.count"
                class="input"
                type="number"
                min="1"
                :max="store.maxCount"
              >
            </div>
            <div class="field">
              <label
                class="label"
                for="format"
              >输出格式</label>
              <SelectBox
                id="format"
                v-model="store.format"
                :options="formatOptions"
              />
            </div>
          </div>

          <p
            class="hint"
            style="margin: -0.5rem 0 1rem"
          >
            上限 {{ store.maxCount }} 张。每张是一次独立请求（并发发出），不是单请求多图。
          </p>

          <div
            v-if="submitHint"
            class="notice notice-info"
            style="margin-bottom: 1rem"
          >
            {{ submitHint }}
          </div>

          <div class="submit-row">
            <button
              type="submit"
              class="button button-primary"
              :disabled="!canSubmit"
            >
              <span
                v-if="store.hasActiveJob"
                class="spinner"
              />
              {{
                store.hasActiveJob
                  ? jobProgressLabel || (store.activeTab === 'generate' ? '生成中…' : '编辑中…')
                  : store.activeTab === 'generate' ? '开始生成' : '开始编辑'
              }}
            </button>
            <button
              v-if="store.hasActiveJob"
              type="button"
              class="button button-danger"
              title="Esc"
              @click="cancelSubmit"
            >
              取消
            </button>
          </div>
        </form>
      </section>

      <!-- 右：画廊 -->
      <section class="gallery">
        <div class="gallery-header">
          <div>
            <h2 class="gallery-title">结果画廊</h2>
            <span class="gallery-count">
              {{ store.filteredGallery.length }} / {{ GALLERY_LIMIT }} 张
            </span>
            <div class="gallery-filters">
              <button
                type="button"
                class="tab"
                :class="{ active: store.galleryFilter === 'all' }"
                @click="store.galleryFilter = 'all'"
              >
                全部
              </button>
              <button
                type="button"
                class="tab"
                :class="{ active: store.galleryFilter === 'generate' }"
                @click="store.galleryFilter = 'generate'"
              >
                生成
              </button>
              <button
                type="button"
                class="tab"
                :class="{ active: store.galleryFilter === 'edit' }"
                @click="store.galleryFilter = 'edit'"
              >
                编辑
              </button>
            </div>
          </div>
          <button
            v-if="store.galleryItems.length > 0"
            type="button"
            class="button button-sm button-danger"
            @click="requestClear"
          >
            清空画廊
          </button>
        </div>

        <div
          v-if="store.filteredGallery.length === 0"
          class="empty"
        >
          <span style="font-size: 30px; opacity: 0.4">▦</span>
          <span>还没有结果</span>
          <span style="font-size: 12px">文生图或图生图的结果都会出现在这里</span>
        </div>

        <div
          v-else
          class="gallery-grid"
        >
          <article
            v-for="item in store.filteredGallery"
            :key="item.id"
            class="gallery-item"
          >
            <div class="gallery-actions">
              <button
                type="button"
                class="icon-button"
                title="带到图生图"
                @click="useAsEditSource(item)"
              >
                ⇢
              </button>
              <button
                type="button"
                class="icon-button"
                title="回填提示词与参数"
                @click="refillFromGallery(item)"
              >
                ↺
              </button>
              <button
                type="button"
                class="icon-button"
                title="复制图片"
                @click="copyImage(item)"
              >
                ⧉
              </button>
              <button
                type="button"
                class="icon-button"
                title="复制图片数据"
                @click="copyDataUrl(item)"
              >
                ⧉+
              </button>
              <button
                type="button"
                class="icon-button"
                title="下载"
                @click="downloadImage(item)"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon-button"
                title="删除"
                @click="requestDelete(item)"
              >
                ×
              </button>
            </div>

            <img
              :src="item.src"
              :alt="item.prompt"
              loading="lazy"
              title="点击查看大图"
              @click="openLightbox(item)"
            >

            <div class="gallery-meta">
              <button
                type="button"
                class="gallery-prompt"
                :title="expandedItem === item.id ? '点击收起' : '点击查看完整提示词'"
                @click="toggleExpand(item.id)"
              >
                {{ item.prompt || '（无指令）' }}
                <span
                  v-if="item.prompt && expandedItem !== item.id"
                  class="prompt-more"
                >展开</span>
              </button>
              <div class="gallery-tags">
                <span class="tag-kind">{{ item.kind === 'generate' ? '生成' : '编辑' }}</span>
                <span class="tag-model">{{ item.model }}</span>
                <span>{{ item.quality }}</span>
                <span v-if="item.size !== 'auto'">{{ item.size }}</span>
                <span>{{ item.format }}</span>
                <span>{{ item.createdAt.slice(11, 19) }}</span>
              </div>

              <!-- 展开详情 -->
              <div
                v-if="expandedItem === item.id"
                class="gallery-detail"
              >
                <div class="detail-block">
                  <div class="detail-label">完整提示词</div>
                  <p class="detail-text">{{ item.prompt || '（无）' }}</p>
                  <div class="detail-actions">
                    <button
                      type="button"
                      class="button button-sm button-primary"
                      @click="useAsEditSource(item)"
                    >
                      带到图生图
                    </button>
                    <button
                      type="button"
                      class="button button-sm"
                      @click="refillFromGallery(item)"
                    >
                      回填参数
                    </button>
                    <button
                      type="button"
                      class="button button-sm"
                      @click="copyPrompt(item)"
                    >
                      复制提示词
                    </button>
                  </div>
                </div>
                <dl class="detail-list">
                  <div><dt>模型</dt><dd>{{ item.model }}</dd></div>
                  <div><dt>输出尺寸</dt><dd>{{ item.size }}</dd></div>
                  <div><dt>质量</dt><dd>{{ item.quality }}</dd></div>
                  <div><dt>格式</dt><dd>{{ item.format }}</dd></div>
                  <div><dt>生成时间</dt><dd>{{ item.createdAt.replace('T', ' ').slice(0, 19) }}</dd></div>
                </dl>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>

    <ChannelsDialog
      :open="channelsOpen"
      :channels="store.channels"
      :loading="store.channelsLoading"
      :error="store.channelsError"
      @close="channelsOpen = false"
      @create="createChannel"
      @update="updateChannel"
      @remove="removeChannel"
      @test="testChannel"
      @probe="probeModels"
      @unblock="unblockModel"
      @try-model="tryModelOnChannel"
      @remove-extra="removeExtraModel"
      @refresh="refreshChannels"
    />

    <SettingsDialog
      :open="settingsOpen"
      @close="settingsOpen = false"
    />

    <!-- 画廊大图灯箱：点暗处或 × 关闭，左右键/箭头切换 -->
    <div
      v-if="lightboxItem"
      class="lightbox-backdrop"
      @click.self="closeLightbox"
    >
      <button
        type="button"
        class="lightbox-close"
        aria-label="关闭"
        @click="closeLightbox"
      >
        ×
      </button>
      <button
        v-if="store.filteredGallery.length > 1"
        type="button"
        class="lightbox-nav lightbox-prev"
        aria-label="上一张"
        @click="stepLightbox(-1)"
      >
        ‹
      </button>
      <figure class="lightbox-stage">
        <img
          :src="lightboxItem.src"
          :alt="lightboxItem.prompt"
          class="lightbox-img"
        >
        <figcaption
          v-if="lightboxItem.prompt"
          class="lightbox-caption"
        >
          {{ lightboxItem.prompt }}
        </figcaption>
      </figure>
      <button
        v-if="store.filteredGallery.length > 1"
        type="button"
        class="lightbox-nav lightbox-next"
        aria-label="下一张"
        @click="stepLightbox(1)"
      >
        ›
      </button>
    </div>

    <!-- 确认对话框 -->
    <div
      v-if="confirmState"
      class="dialog-backdrop"
      @click.self="confirmState = null"
    >
      <div
        class="dialog"
        style="max-width: 400px"
        role="dialog"
        aria-modal="true"
      >
        <div class="dialog-head">
          <h3>{{ confirmState.kind === 'clear' ? '清空画廊' : '删除这张图片？' }}</h3>
          <button
            type="button"
            class="button dialog-close"
            aria-label="关闭"
            @click="confirmState = null"
          >
            ×
          </button>
        </div>
        <p style="margin: 0; font-size: 13px; color: var(--text-muted)">
          {{
            confirmState.kind === 'clear'
              ? '画廊中的所有图片将被移除，此操作不可撤销。'
              : '这张图片将从画廊中移除，此操作不可撤销。'
          }}
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            class="button"
            @click="confirmState = null"
          >
            取消
          </button>
          <button
            type="button"
            class="button button-danger"
            @click="runConfirm"
          >
            确认{{ confirmState.kind === 'clear' ? '清空' : '删除' }}
          </button>
        </div>
      </div>
    </div>

    <div class="toasts">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.kind === 'error' ? 'toast-error' : 'toast-success'"
      >
        {{ t.message }}
      </div>
    </div>
  </div>
</template>
