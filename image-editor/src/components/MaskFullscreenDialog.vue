<script setup lang="ts">
/**
 * 全屏遮罩精绘弹窗。
 *
 * 为什么单独做一个全屏视图：小图上涂不准细节（1px 笔刷在小图上只有几像素）。
 * 全屏下图片按视口放大，细涂抹与边缘修整都更可控。
 *
 * 交互约定：
 *  - 「确认」才把遮罩提交给父级；「取消」丢弃本次改动
 *  - 笔刷半径用**屏幕像素**表达，内部按缩放比换算成图片像素，
 *    这样放大视图下手感与缩略图一致，不会出现「大图笔刷反而更细」
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MaskCanvasCore from './MaskCanvasCore.vue'

const props = defineProps<{
  open: boolean
  source: string
  /** 已有遮罩；打开时载入 */
  mask: string
}>()

const emit = defineEmits<{
  (e: 'confirm', maskDataUrl: string): void
  (e: 'cancel'): void
}>()

const coreRef = ref<InstanceType<typeof MaskCanvasCore> | null>(null)

/** 笔刷直径（屏幕 CSS 像素），比半径更好点选 */
const brushCss = ref(80)
/** 显示模式：压暗未选区 / 不压暗（便于看清原图）/ 纯遮罩叠加 */
const display = ref<'dim' | 'bright' | 'flat'>('dim')
/** 是否显示压暗 */
const showDim = ref(true)
/** 已涂抹面积占比（百分比） */
const coverage = ref(0)
/** 工作副本：确认前不污染外部状态 */
const draftMask = ref('')
/** 画布容器，用于测缩放比 */
const stackRef = ref<HTMLElement | null>(null)

/** 当前显示模式对应的 dim 参数 */
const dimActive = computed(() => showDim.value && display.value !== 'flat')

/**
 * 滑杆旁的圆形预览。
 * 直接用 brushCss 的对数映射到预览框尺寸 —— 全值域线性映射会让
 * 8–40px 这段（精细涂抹最常用的区间）几乎看不出变化。
 */
const brushPreviewStyle = computed(() => {
  const PREVIEW_MAX = 44
  const MIN = 8
  const MAX = 400
  // 对数插值：value 8 → 6px，400 → 44px
  const ratio = Math.log(brushCss.value / MIN) / Math.log(MAX / MIN)
  const px = 6 + ratio * (PREVIEW_MAX - 6)
  return {
    width: `${px.toFixed(1)}px`,
    height: `${px.toFixed(1)}px`,
  }
})

const displayLabel = computed(() => {
  const map = { dim: '压暗选区外', bright: '全图明亮', flat: '纯遮罩叠加' }
  return map[display.value]
})

function cycleDisplay() {
  const order: Array<typeof display.value> = ['dim', 'bright', 'flat']
  const idx = order.indexOf(display.value)
  display.value = order[(idx + 1) % order.length]
}

/** 把 CSS 像素的笔刷换算成图片像素 */
/**
 * 把 CSS 像素的笔刷直径交给内核换算。
 * 父层不需要知道任何几何信息 —— 缩放比由内核自己从画布量。
 */
function syncBrush() {
  coreRef.value?.setBrushByCss(brushCss.value)
}

function onChange(mask: string, cov: number) {
  draftMask.value = mask
  coverage.value = cov
}

/** 已有遮罩载入后，把覆盖率显示同步过来（否则打开就显示「尚未涂抹」） */
watch(
  () => props.mask,
  async (m) => {
    if (!props.open || !m) return
    await nextTick()
    // 等内核把 mask 画完再读
    setTimeout(() => {
      const core = coreRef.value
      if (core) coverage.value = core.getCoverage()
    }, 120)
  },
)

function undoAll() {
  const core = coreRef.value
  if (!core) return
  core.reset()
  draftMask.value = ''
  coverage.value = 0
}

function confirm() {
  const core = coreRef.value
  if (!core) return
  if (!core.isPainted()) {
    // 没涂 = 等于不传 mask，让用户明确选择而不是误提交空遮罩
    emit('cancel')
    return
  }
  emit('confirm', core.exportMask())
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') emit('cancel')
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) confirm()
  // 括号键调笔刷，绘图软件的习惯
  if (event.key === '[') brushCss.value = Math.max(8, brushCss.value - 8)
  if (event.key === ']') brushCss.value = Math.min(400, brushCss.value + 8)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.body.style.overflow = ''
      return
    }
    draftMask.value = props.mask
    document.body.style.overflow = 'hidden'
    await nextTick()
    // 等 canvas 拿到正确尺寸后再换算笔刷，并同步已有遮罩的覆盖率
    setTimeout(() => {
      syncBrush()
      const core = coreRef.value
      if (core) coverage.value = core.getCoverage()
    }, 140)
  },
)

watch(brushCss, syncBrush)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <div
    v-if="open"
    class="mask-fullscreen-backdrop"
    @click.self="emit('cancel')"
  >
    <div class="mask-fullscreen">
      <header class="mask-fs-header">
        <div class="mask-fs-title">
          <strong>绘制遮罩</strong>
          <span class="mask-fs-sub">涂抹要<strong>重绘</strong>的区域，未涂抹处保持原样</span>
        </div>

        <div class="mask-fs-tools">
          <!--
            笔刷控制组：数值做成大字实时显示 + 圆形预览。
            原先只有一个小号的「80px」，拖动时几乎注意不到变化。
          -->
          <div class="mask-brush-group">
            <div class="mask-brush-readout">
              <span class="mask-brush-preview" :style="brushPreviewStyle" />
              <span class="mask-brush-value">
                {{ brushCss }}<small>px</small>
              </span>
              <span class="mask-brush-caption">笔刷直径</span>
            </div>
            <input
              id="fs-brush"
              v-model.number="brushCss"
              class="mask-brush"
              type="range"
              min="8"
              max="400"
              step="2"
              aria-label="笔刷直径"
            >
          </div>

          <button
            type="button"
            class="mask-chip"
            :class="{ on: showDim }"
            @click="showDim = !showDim"
          >
            {{ showDim ? '压暗：开' : '压暗：关' }}
          </button>

          <button
            type="button"
            class="mask-chip"
            :title="'当前：' + displayLabel + '（点击切换）'"
            @click="cycleDisplay"
          >
            {{ displayLabel }}
          </button>

          <button
            type="button"
            class="mask-chip"
            :disabled="!draftMask"
            @click="undoAll"
          >
            清空
          </button>

          <button
            type="button"
            class="button dialog-close"
            aria-label="关闭"
            title="Esc 取消"
            @click="emit('cancel')"
          >
            ×
          </button>
        </div>
      </header>

      <div
        ref="stackRef"
        class="mask-fs-stage"
      >
        <MaskCanvasCore
          ref="coreRef"
          :source="source"
          :mask="draftMask"
          interactive
          cursor-ring
          :dim="dimActive"
          @change="onChange"
        />
      </div>

      <footer class="mask-fs-footer">
        <div class="mask-fs-meta">
          <template v-if="coverage > 0">
            已涂抹约 <strong>{{ (coverage * 100).toFixed(1) }}%</strong> 区域
          </template>
          <template v-else>
            尚未涂抹 —— 直接确认将视为<strong>不使用遮罩</strong>
          </template>
          <span class="mask-fs-keys">[ ] 调笔刷 · Esc 取消</span>
        </div>

        <div class="mask-fs-actions">
          <button
            type="button"
            class="button"
            @click="emit('cancel')"
          >
            取消
          </button>
          <button
            type="button"
            class="button button-primary"
            @click="confirm"
          >
            确认应用
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
