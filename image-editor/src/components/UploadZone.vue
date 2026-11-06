<script setup lang="ts">
/**
 * 图片上传区。
 * 支持点击选择、拖拽、粘贴。
 * multiple=true 时可一次选多张（用于多图参考）。
 */
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    hint: string
    /** 单图模式：预览单张；多图模式：忽略此字段 */
    preview?: string
    /** 多图模式的预览列表 */
    previews?: string[]
    accept?: string
    multiple?: boolean
    disabled?: boolean
  }>(),
  { preview: '', previews: () => [], multiple: false, disabled: false },
)

const emit = defineEmits<{
  (e: 'pick', files: File[]): void
  (e: 'clear'): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

/** 多图模式下即使已有图也允许继续添加；单图模式有图就禁用 */
const isFull = () => !props.multiple && Boolean(props.preview)

function openPicker() {
  if (props.disabled) return
  fileInput.value?.click()
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files ?? [])
  if (files.length > 0) emit('pick', files)
  target.value = ''
}

function onDragEnter(event: DragEvent) {
  if (props.disabled) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragging.value = true
}

function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget
  const current = event.currentTarget
  if (related instanceof Node && current instanceof Node && current.contains(related)) {
    return
  }
  dragging.value = false
}

function onDrop(event: DragEvent) {
  dragging.value = false
  if (props.disabled) return
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
    f.type.startsWith('image/'),
  )
  if (files.length === 0) return
  // 单图模式只取第一张
  emit('pick', props.multiple ? files : [files[0]])
}

function onPaste(event: ClipboardEvent) {
  if (props.disabled) return
  const items = Array.from(event.clipboardData?.items ?? []).filter((i) =>
    i.type.startsWith('image/'),
  )
  const files = items
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null)
  if (files.length === 0) return
  emit('pick', props.multiple ? files : [files[0]])
}

defineExpose({ openPicker })
</script>

<template>
  <div
    class="upload-card"
    @paste="onPaste"
  >
    <button
      type="button"
      class="upload-zone"
      :class="{ dragging, 'has-image': isFull() }"
      :disabled="disabled || (!multiple && Boolean(preview))"
      @click="openPicker"
      @dragenter="onDragEnter"
      @dragover="onDragEnter"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- 多图模式：网格展示 -->
      <template v-if="multiple && previews.length > 0">
        <div class="upload-grid-mini">
          <div
            v-for="(src, i) in previews"
            :key="i"
            class="upload-thumb"
          >
            <img
              :src="src"
              class="upload-preview"
              alt=""
            >
            <span class="thumb-index">{{ i + 1 }}</span>
          </div>
        </div>
        <span class="upload-more">继续添加（共 {{ previews.length }} 张）</span>
      </template>

      <!-- 单图模式 -->
      <template v-else-if="preview">
        <img
          :src="preview"
          class="upload-preview"
          alt=""
        >
      </template>

      <template v-else>
        <span
          aria-hidden="true"
          style="font-size: 26px; line-height: 1"
        >+</span>
        <span>{{ label }}</span>
        <small>{{ hint }}</small>
      </template>
    </button>

    <input
      ref="fileInput"
      type="file"
      :accept="accept ?? 'image/png,image/jpeg,image/webp'"
      :multiple="multiple"
      style="display: none"
      @change="onChange"
    >

    <button
      v-if="preview || (multiple && previews.length > 0)"
      type="button"
      class="upload-clear"
      :aria-label="`清空${label}`"
      @click.stop="emit('clear')"
    >
      ×
    </button>
  </div>
</template>
