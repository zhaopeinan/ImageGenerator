<script setup lang="ts">
/**
 * 遮罩面板（编辑模式）。
 *
 * 流程刻意做成显式三步：增加遮罩 → 全屏精绘 → 确认。
 * 不做「一上传主图就能直接涂」，原因：
 *  - 用户常只是想整图编辑，误触涂抹反而要清除
 *  - 遮罩是有成本的决策（要局部重绘），值得一次明确点击
 *
 * 确认后在缩略图里可查看效果，也能点开重新精绘。
 */
import { ref, watch } from 'vue'
import MaskCanvasCore from './MaskCanvasCore.vue'
import MaskFullscreenDialog from './MaskFullscreenDialog.vue'
import UploadZone from './UploadZone.vue'

const props = defineProps<{
  /** 主图 data URL；为空时不能绘制 */
  sourcePreview: string
  /** 当前生效的遮罩 */
  maskPreview: string
}>()

const emit = defineEmits<{
  (e: 'change', maskDataUrl: string): void
  /** 与 UploadZone 保持一致：一次可能选到多个文件，遮罩只取第一个 */
  (e: 'upload', files: File[]): void
  (e: 'clear'): void
}>()

const dialogOpen = ref(false)
/** 输入方式：画笔 or 上传现成文件 */
const mode = ref<'brush' | 'upload'>('brush')
/** 是否存在已生效的遮罩 */
const hasMask = ref(Boolean(props.maskPreview))

// 外部遮罩变化（如刷新恢复）时同步「有无遮罩」状态
watch(
  () => props.maskPreview,
  (v) => {
    hasMask.value = Boolean(v)
  },
)

function openDialog() {
  if (!props.sourcePreview) return
  dialogOpen.value = true
}

function onConfirm(maskDataUrl: string) {
  dialogOpen.value = false
  hasMask.value = true
  emit('change', maskDataUrl)
}

function onCancel() {
  dialogOpen.value = false
}

function clearAll() {
  hasMask.value = false
  emit('clear')
}

function onUploadFile(files: File[]) {
  hasMask.value = files.length > 0
  emit('upload', files)
}
</script>

<template>
  <div class="mask-panel">
    <div class="mask-mode-tabs">
      <button
        type="button"
        class="mask-mode-tab"
        :class="{ on: mode === 'brush' }"
        @click="mode = 'brush'"
      >
        画笔涂选
      </button>
      <button
        type="button"
        class="mask-mode-tab"
        :class="{ on: mode === 'upload' }"
        @click="mode = 'upload'"
      >
        上传文件
      </button>
    </div>

    <!-- 画笔模式 -->
    <template v-if="mode === 'brush'">
      <div
        v-if="!sourcePreview"
        class="mask-placeholder"
      >
        <p>请先上传主图，才能绘制遮罩</p>
      </div>

      <!-- 已有遮罩：显示缩略效果 + 操作 -->
      <div
        v-else-if="hasMask"
        class="mask-thumb-wrap"
      >
        <!--
          缩略图本身就是「再次放大查看」的入口：
          按钮套在整个缩略图上，点击任意位置都能打开全屏精绘。
        -->
        <button
          type="button"
          class="mask-thumb-stage"
          title="点击放大查看与编辑"
          @click="openDialog"
        >
          <MaskCanvasCore
            :source="sourcePreview"
            :mask="maskPreview"
          />
          <span class="mask-thumb-zoom">点击放大</span>
        </button>

        <div class="mask-thumb-actions">
          <button
            type="button"
            class="button button-sm button-primary"
            @click="openDialog"
          >
            重新编辑
          </button>
          <button
            type="button"
            class="button button-sm button-danger"
            @click="clearAll"
          >
            移除遮罩
          </button>
        </div>

        <p class="hint mask-hint">
          涂抹过的区域会被重绘，未涂抹处保持原样。点缩略图或「重新编辑」可放大绘制。
        </p>
      </div>

      <!-- 尚未添加遮罩：显式按钮 -->
      <div
        v-else
        class="mask-add"
      >
        <p class="hint">
          遮罩用于<strong>局部重绘</strong> —— 只修改涂抹的区域，其余部分原样保留。
          不添加遮罩则整图按提示词编辑。
        </p>
        <button
          type="button"
          class="button button-primary mask-add-btn"
          @click="openDialog"
        >
          + 增加遮罩
        </button>
      </div>
    </template>

    <!-- 上传模式 -->
    <UploadZone
      v-else
      label="遮罩文件"
      hint="PNG · 透明区域=重绘 · 尺寸须与主图一致"
      :preview="maskPreview"
      @pick="onUploadFile"
      @clear="clearAll"
    />

    <!-- 全屏精绘 -->
    <MaskFullscreenDialog
      :open="dialogOpen"
      :source="sourcePreview"
      :mask="maskPreview"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </div>
</template>
