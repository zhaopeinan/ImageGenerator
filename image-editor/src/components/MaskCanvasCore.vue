<script setup lang="ts">
/**
 * 遮罩画布内核。
 *
 * 缩略视图与全屏精绘共用同一套渲染逻辑，只是尺寸与交互开关不同。
 *
 * 显示方式采用三层叠加，而不是单一色块覆盖：
 *   1. 底图      —— 原图，完整可见
 *   2. 压暗层    —— 未选区域加黑色半透明，让选区自然「突显」
 *   3. 选区层    —— 涂抹区域保持原亮度 + 主题色轮廓，边界锐利
 *
 * 比单一红色涂抹好在：选区内原图细节仍可读（用户要照着原图涂），
 * 边界靠轮廓线而非颜色猜测。
 *
 * mask 的真实语义是「全透明 = 重绘」，与多数设计工具的黑白蒙版相反，
 * 因此这里全图初始化为不透明（保留），涂抹处用 destination-out 擦成透明。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 主图 data URL，同时决定 mask 的输出尺寸 */
    source: string
    /** 已有的遮罩 data URL；改变时重新载入 */
    mask?: string
    /** 是否可绘制。全屏精绘为 true，纯预览为 false */
    interactive?: boolean
    /** 是否压暗未选区域 */
    dim?: boolean
    /** 主题色，用于轮廓 */
    accent?: string
    /** 是否在指针处绘制笔刷尺寸圈（替代系统十字光标） */
    cursorRing?: boolean
  }>(),
  { mask: '', interactive: false, dim: true, accent: '20, 184, 166', cursorRing: false },
)

const emit = defineEmits<{
  /** 每次笔迹变化都抛出，便于父级实时反馈 */
  (e: 'change', maskDataUrl: string, paintedCount: number): void
}>()

/** 事件承载层：只负责接收指针事件 */
const hitRef = ref<HTMLCanvasElement | null>(null)
/** 选区层：压暗 + 高亮 + 轮廓 */
const selectRef = ref<HTMLCanvasElement | null>(null)
/** 离屏：真正的 mask。全不透明白，涂抹处透明 */
const maskRef = ref<HTMLCanvasElement | null>(null)
/** 底图，用于测量 contain 区域 */
const baseRef = ref<HTMLImageElement | null>(null)
/** 外层容器，用于测量可用空间 */
const stackRef = ref<HTMLElement | null>(null)
/** 容器尺寸变化时重算 contain */
let observer: ResizeObserver | null = null

let selectCtx: CanvasRenderingContext2D | null = null
let maskCtx: CanvasRenderingContext2D | null = null
let drawing = false
let last: { x: number; y: number } | null = null

/** 已涂抹面积占比（0~1），用于提示涂抹程度 */
const coverage = ref(0)
let painted = false

/** 笔刷半径（像素，基于 mask 原始分辨率） */
const brushRadius = ref(40)

/**
 * 期望的笔刷**屏幕**直径。
 * 存下来是因为 setBrushByCss 可能因 canvas 尚未初始化而无法换算，
 * 那时若直接 return，用户在打开弹窗后立刻拖滑杆，设置就会被丢弃。
 * 之后由 applyPendingBrush 补算。
 */
let pendingBrushCss = 0

/** 笔刷光标圈 */
const cursorRef = ref<HTMLDivElement | null>(null)
/** 光标位置（相对 stack 容器，CSS 像素） */
const cursorPos = ref({ x: -999, y: -999 })
/** 光标是否在画布区域内 */
const cursorInside = ref(false)
/**
 * 光标圈的屏幕半径。
 * 笔刷半径是「图片像素」，而光标圈要按「屏幕像素」画，
 * 所以必须乘上当前显示缩放比（displayWidth / imageWidth），
 * 否则放大视图下圈会与实际涂抹范围不一致。
 */
const cursorRadiusCss = ref(20)

function setBrush(radius: number) {
  brushRadius.value = Math.max(4, radius)
  updateCursorRadius()
}

/** 重算光标圈的屏幕半径 */
function updateCursorRadius() {
  const scale = getDisplayScale()
  if (!scale) return
  cursorRadiusCss.value = brushRadius.value * scale
}

/** 全图重置为不透明 = 全部保留 */
function reset() {
  const canvas = maskRef.value
  const mctx = maskCtx
  if (!canvas || !mctx) return
  mctx.globalCompositeOperation = 'source-over'
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, canvas.width, canvas.height)
  renderSelect()
  coverage.value = 0
  painted = false
}

/** 只重绘画布尺寸，不重置内容 */
function resize(width: number, height: number) {
  for (const c of [hitRef.value, selectRef.value, maskRef.value]) {
    if (!c) continue
    if (c.width === width && c.height === height) continue
    c.width = width
    c.height = height
  }
  selectCtx = selectRef.value?.getContext('2d') ?? null
  maskCtx = maskRef.value?.getContext('2d') ?? null
  if (maskCtx) {
    maskCtx.globalCompositeOperation = 'source-over'
    maskCtx.fillStyle = '#ffffff'
    maskCtx.fillRect(0, 0, width, height)
  }
  renderSelect()
}

/** 根据 mask 重绘选区层：压暗 + 高亮 + 轮廓 */
function renderSelect() {
  const select = selectRef.value
  const mask = maskRef.value
  const sctx = selectCtx
  if (!select || !mask || !sctx) return

  const w = select.width
  const h = select.height

  sctx.globalCompositeOperation = 'source-over'
  sctx.clearRect(0, 0, w, h)

  if (!painted) {
    // 未涂抹：整图统一压一层（等价于「全图可改」）
    if (props.dim) {
      sctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
      sctx.fillRect(0, 0, w, h)
    }
    return
  }

  // 步骤 1：整图压暗
  if (props.dim) {
    sctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
    sctx.fillRect(0, 0, w, h)
  }

  // 步骤 2：用 mask 的 alpha 抠掉压暗 → 选区恢复原亮度
  sctx.globalCompositeOperation = 'destination-out'
  sctx.drawImage(mask, 0, 0, w, h)
  sctx.globalCompositeOperation = 'source-over'

  // 步骤 3：给选区描一圈主题色轮廓。
  // 做法：先把 mask 模糊膨胀得到「向外扩张的环」，
  // 再用原 mask 从这个环里「挖掉内部」，剩下的正是边界带。
  // 模糊半径按图片短边比例取，保证大图小图的轮廓视觉粗细一致。
  const ring = document.createElement('canvas')
  ring.width = w
  ring.height = h
  const rctx = ring.getContext('2d')
  if (!rctx) return

  const blurPx = Math.max(1, Math.round(Math.min(w, h) / 220))

  rctx.filter = `blur(${blurPx}px)`
  rctx.drawImage(mask, 0, 0, w, h)
  rctx.filter = 'none'
  // 挖掉内部，只留环带
  rctx.globalCompositeOperation = 'destination-out'
  rctx.drawImage(mask, 0, 0, w, h)
  rctx.globalCompositeOperation = 'source-over'

  // 把环染成主题色
  rctx.globalCompositeOperation = 'source-in'
  rctx.fillStyle = `rgba(${props.accent}, 0.95)`
  rctx.fillRect(0, 0, w, h)

  sctx.drawImage(ring, 0, 0)
}

/** 估算涂抹覆盖率：用 1/8 精度采样，避免逐像素遍历大图 */
/**
 * 估算涂抹覆盖率。
 *
 * 坑（踩过）：`getImageData(x, y, w, h)` 的后两个参数是**源矩形的尺寸**，
 * 不是采样步长。误把 step 当成尺寸会只读到左上角 step×step 区域，
 * 覆盖率永远接近 0（表现为「明明涂了，界面说没涂」）。
 *
 * 正确做法：按网格分块读，每块取中心像素参与统计。
 */
function measureCoverage(): number {
  const mask = maskRef.value
  const mctx = maskCtx
  if (!mask || !mctx) return 0

  const GRID = 64 // 采样网格边长，64×64 = 4096 个采样点，足够表示比例
  const cellW = Math.max(1, Math.floor(mask.width / GRID))
  const cellH = Math.max(1, Math.floor(mask.height / GRID))

  let transparent = 0
  let total = 0

  for (let gy = 0; gy < GRID; gy += 1) {
    const sy = Math.min(gy * cellH, mask.height - 1)
    for (let gx = 0; gx < GRID; gx += 1) {
      const sx = Math.min(gx * cellW, mask.width - 1)
      try {
        // 每格取 1×1 像素；批量读会更快但跨行处理麻烦，这里够用
        const alpha = mctx.getImageData(sx, sy, 1, 1).data[3]
        total += 1
        if (alpha < 24) transparent += 1
      } catch {
        return 0
      }
    }
  }

  return total > 0 ? transparent / total : 0
}

/** 画一个圆形笔迹到 mask。选区层的重绘交给 renderSelect，避免叠加错乱。 */
function strokeTo(x: number, y: number) {
  const radius = brushRadius.value
  const mask = maskRef.value
  const mctx = maskCtx
  if (!mask || !mctx) return

  // 写入 mask：擦成透明 = 重绘区
  mctx.globalCompositeOperation = 'destination-out'
  mctx.fillStyle = '#000000'
  mctx.beginPath()
  mctx.arc(x, y, radius, 0, Math.PI * 2)
  mctx.fill()
  mctx.globalCompositeOperation = 'source-over'

  painted = true
}

/**
 * 把三个 canvas 的**显示尺寸**对齐到底图的 contain 区域。
 *
 * `<img object-fit:contain>` 会按比例缩放并在容器内居中，
 * 但 canvas 没有等价物 —— 默认铺满容器，导致压暗层盖到图片外的留白。
 * 所以用 JS 算出 contain 的实际矩形，再把 canvas 的 CSS 宽高设成它。
 * 像素分辨率（canvas.width/height）仍保持图片原始尺寸，不影响 mask 输出。
 */
function syncContain() {
  const stack = stackRef.value
  const base = baseRef.value
  if (!stack || !base) return

  const box = stack.getBoundingClientRect()
  const natW = base.naturalWidth || maskRef.value?.width || 0
  const natH = base.naturalHeight || maskRef.value?.height || 0
  if (box.width === 0 || box.height === 0 || natW === 0 || natH === 0) return

  const scale = Math.min(box.width / natW, box.height / natH)
  const dispW = natW * scale
  const dispH = natH * scale

  for (const canvas of [selectRef.value, hitRef.value]) {
    if (!canvas) continue
    canvas.style.width = `${dispW}px`
    canvas.style.height = `${dispH}px`
  }
  // 尺寸确定后才能换算笔刷与光标圈
  applyPendingBrush()
  updateCursorRadius()
}

/** 指针在画布上移动（未按下也响应）→ 更新光标圈位置 */
function onHover(event: PointerEvent) {
  if (!props.interactive || !props.cursorRing) return
  const canvas = hitRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const stack = stackRef.value
  if (!stack) return
  const stackRect = stack.getBoundingClientRect()

  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom

  cursorInside.value = inside
  if (!inside) return
  // 存相对 stack 的坐标，模板里直接用 translate 定位
  cursorPos.value = {
    x: event.clientX - stackRect.left,
    y: event.clientY - stackRect.top,
  }
}

function onLeave() {
  cursorInside.value = false
}

/** 事件坐标换算：canvas 的 CSS 尺寸现在是 contain 区域，换算更直观 */
function toPoint(event: PointerEvent): { x: number; y: number } | null {
  const canvas = hitRef.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  }
}

function onDown(event: PointerEvent) {
  if (!props.interactive) return
  const point = toPoint(event)
  if (!point) return
  drawing = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  last = point
  strokeTo(point.x, point.y)
  painted = true
  // 不在按下时导出：toDataURL 会把整张图编码成 base64（512×512 约几百 KB），
  // 每帧都做会明显卡顿。只更新视觉，导出留给抬手。
  renderSelect()
}

function onMove(event: PointerEvent) {
  // 无论是否在绘制都更新光标圈 —— hover 时也要显示笔刷尺寸
  onHover(event)

  if (!drawing || !props.interactive) return
  const point = toPoint(event)
  if (!point) return
  const from = last ?? point
  strokeTo(from.x, from.y)
  strokeTo(point.x, point.y)
  last = point
  // 拖动中也要出视觉反馈，但 renderSelect 内含一次临时 canvas 的模糊运算，
  // 每次 pointermove 都做会卡。折中：先叠一层选区色，抬手后由 renderSelect 统一重绘。
  if (selectCtx) {
    selectCtx.fillStyle = `rgba(${props.accent}, 0.28)`
    selectCtx.beginPath()
    selectCtx.arc(point.x, point.y, brushRadius.value, 0, Math.PI * 2)
    selectCtx.fill()
  }
}

function onUp(event: PointerEvent) {
  if (!drawing) return
  drawing = false
  last = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  renderSelect()
  // 抬手时才做重活：精确覆盖率 + 导出 PNG
  coverage.value = measureCoverage()
  emit('change', maskRef.value?.toDataURL('image/png') ?? '', coverage.value)
}

/** 按显示宽度换算笔刷半径，保证不同缩放下手感一致 */
/**
 * 当前显示缩放比 = 画布显示宽度 / 画布像素宽度。
 * 必须用**画布元素的实际宽度**而不是容器宽度 —— 非方形图片 contain 后
 * 画布比容器窄，用容器算会让笔刷比实际涂抹范围小（或大）。
 * 画布未就绪时返回 0，调用方据此跳过。
 */
function getDisplayScale(): number {
  const hit = hitRef.value
  const mask = maskRef.value
  if (!hit || !mask || mask.width === 0) return 0
  const cssWidth = hit.getBoundingClientRect().width
  if (cssWidth <= 0) return 0
  return cssWidth / mask.width
}

/** 按**屏幕 CSS 像素**设定笔刷直径。
 *
 * 为什么不用「图片像素」直接设：笔刷要在缩略图与全屏下手感一致，
 * 而两者的显示缩放比不同。统一以屏幕像素为准，内部再按当前缩放比换算
 * 成图片像素。好处是：
 *  - 父组件不需要知道任何几何信息（原先要传 displayWidth，容易传错容器）
 *  - 缩放比变化时能自动保持视觉笔刷大小
 */
function setBrushByCss(diameterCss: number) {
  pendingBrushCss = diameterCss
  applyPendingBrush()
}

/** 画布就绪后把之前记下的 CSS 笔刷换算成图片像素 */
function applyPendingBrush() {
  if (pendingBrushCss <= 0) return
  const scale = getDisplayScale()
  if (!scale) return
  setBrush(pendingBrushCss / 2 / scale)
}

function exportMask(): string {
  return maskRef.value?.toDataURL('image/png') ?? ''
}

function getCoverage(): number {
  return coverage.value
}

function isPainted(): boolean {
  return painted
}

/** 主图变化 → 重建（尺寸可能变化，旧遮罩失效） */
watch(
  () => props.source,
  (src) => {
    if (!src) return
    const img = new Image()
    img.onload = () => {
      resize(img.naturalWidth, img.naturalHeight)
      if (props.mask) loadMask(props.mask)
      else reset()
      syncContain()
    }
    img.src = src
  },
  { immediate: true },
)

onMounted(() => {
  // 容器尺寸变化（窗口缩放、全屏切换、面板展开）都要重算 contain
  if (stackRef.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => syncContain())
    observer.observe(stackRef.value)
  }
  baseRef.value?.addEventListener('load', syncContain)
  syncContain()
  // v-if 挂载时容器可能还没完成布局，首帧的尺寸是 0。
  // 补两帧延迟重算，否则 canvas 会保持 0 宽高直到用户碰巧触发 resize。
  requestAnimationFrame(() => {
    syncContain()
    requestAnimationFrame(() => syncContain())
  })
})

/** 外部遮罩变化（如打开全屏时载入已有遮罩） */
watch(
  () => props.mask,
  (next, prev) => {
    if (next && next !== prev) loadMask(next)
  },
)

function loadMask(dataUrl: string) {
  const mask = maskRef.value
  const mctx = maskCtx
  if (!mask || !mctx || mask.width === 0) {
    // canvas 尚未初始化（v-if 挂载的同一帧内 ref 可能还是 null）。
    // 延后一帧重试，否则已有遮罩会「打开后不显示」。
    requestAnimationFrame(() => loadMask(dataUrl))
    return
  }
  const img = new Image()
  img.onload = () => {
    if (img.naturalWidth !== mask.width || img.naturalHeight !== mask.height) {
      // 尺寸不匹配 = 旧遮罩已失效（换了主图），丢弃而不是错位套用
      reset()
      return
    }
    mctx.globalCompositeOperation = 'source-over'
    mctx.clearRect(0, 0, mask.width, mask.height)
    mctx.drawImage(img, 0, 0, mask.width, mask.height)
    mctx.globalCompositeOperation = 'source-over'
    painted = true
    coverage.value = measureCoverage()
    renderSelect()
  }
  img.src = dataUrl
}

/** 非绘制状态下也要保持视觉正确（压暗/显示遮罩） */
watch(
  () => props.dim,
  () => renderSelect(),
)

onBeforeUnmount(() => {
  drawing = false
  selectCtx = null
  maskCtx = null
  observer?.disconnect()
  observer = null
  baseRef.value?.removeEventListener('load', syncContain)
})

defineExpose({
  setBrush,
  /** 按屏幕 CSS 像素直径设定笔刷（父层用这个） */
  setBrushByCss,
  exportMask,
  getCoverage,
  isPainted,
  reset,
  renderSelect,
})
</script>

<template>
  <div
    ref="stackRef"
    class="mask-canvas-stack"
  >
    <img
      ref="baseRef"
      :src="source"
      alt="待编辑图片"
      class="mask-layer mask-base"
    >

    <!-- 选区层：压暗 + 高亮 + 轮廓，纯视觉 -->
    <canvas
      ref="selectRef"
      class="mask-layer mask-select"
    />

    <!-- 事件层：接收指针 -->
    <canvas
      ref="hitRef"
      class="mask-layer mask-hit"
      :class="{ interactive, 'has-ring': cursorRing }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onLeave"
    />

    <!--
      笔刷尺寸圈：跟随指针，直径 = 实际笔刷的屏幕尺寸。
      替代系统十字光标 —— 用户能直接看出这一笔会涂多宽，
      不必靠「试一下再撤销」来校准。
    -->
    <div
      v-if="cursorRing"
      ref="cursorRef"
      class="mask-cursor"
      :class="{ visible: cursorInside }"
      :style="{
        width: `${cursorRadiusCss * 2}px`,
        height: `${cursorRadiusCss * 2}px`,
        transform: `translate(${cursorPos.x - cursorRadiusCss}px, ${cursorPos.y - cursorRadiusCss}px)`,
      }"
    />

    <!--
      离屏 mask：必须真实存在于 DOM 中，否则模板 ref 拿不到、导出恒为空串。
      用 opacity:0 移出可视区域而非 display:none。
    -->
    <canvas
      ref="maskRef"
      class="mask-offscreen"
      aria-hidden="true"
    />
  </div>
</template>
