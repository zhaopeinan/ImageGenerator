<script setup lang="ts">
/**
 * 自定义下拉框。
 *
 * ## 为什么不用原生 <select>
 *
 * 原生控件只有触发器能上样式（appearance:none + 自绘箭头），
 * **展开后的选项列表由系统绘制，无法用 CSS 控制配色与圆角** ——
 * 结果就是「输入框是自定义风格、点开下拉却变成系统灰白方块」，
 * 深色模式下尤其割裂。
 *
 * 这里把弹层也用 HTML 渲染，才能真正做到全站统一样式。
 *
 * 交互按桌面惯例：
 *  - 点击 / Enter / 空格 打开
 *  - ↑↓ 移动高亮、Enter 选中、Esc 关闭
 *  - 点击外部关闭
 *  - 选中后自动向上滚动，保证当前项可见
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface SelectOption {
  value: string
  label: string
  /** 附注，显示在右侧（如模型说明） */
  hint?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    id?: string
    /** 无匹配项时的提示 */
    emptyText?: string
  }>(),
  { placeholder: '请选择', disabled: false, id: undefined, emptyText: '无可选项' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const open = ref(false)
const highlight = ref(-1)
/** 弹层定位用的列表容器 */
const listRef = ref<HTMLDivElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)

const current = computed(() => props.options.find((o) => o.value === props.modelValue))

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    const idx = props.options.findIndex((o) => o.value === props.modelValue)
    highlight.value = idx >= 0 ? idx : 0
    void nextTick(scrollHighlightIntoView)
  }
}

function close() {
  open.value = false
}

function choose(value: string) {
  emit('update:modelValue', value)
  close()
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return

  if (!open.value) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      toggle()
    }
    return
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      break
    case 'ArrowDown':
      event.preventDefault()
      highlight.value = Math.min(highlight.value + 1, props.options.length - 1)
      void nextTick(scrollHighlightIntoView)
      break
    case 'ArrowUp':
      event.preventDefault()
      highlight.value = Math.max(highlight.value - 1, 0)
      void nextTick(scrollHighlightIntoView)
      break
    case 'Enter':
    case ' ': {
      event.preventDefault()
      const option = props.options[highlight.value]
      if (option) choose(option.value)
      break
    }
    case 'Home':
      event.preventDefault()
      highlight.value = 0
      void nextTick(scrollHighlightIntoView)
      break
    case 'End':
      event.preventDefault()
      highlight.value = props.options.length - 1
      void nextTick(scrollHighlightIntoView)
      break
  }
}

/** 保证高亮项在可视区内 */
function scrollHighlightIntoView() {
  const list = listRef.value
  if (!list) return
  const item = list.children[highlight.value] as HTMLElement | undefined
  if (!item) return
  const listTop = list.scrollTop
  const listBottom = listTop + list.clientHeight
  const itemTop = item.offsetTop
  const itemBottom = itemTop + item.offsetHeight
  if (itemTop < listTop) list.scrollTop = itemTop
  else if (itemBottom > listBottom) list.scrollTop = itemBottom - list.clientHeight
}

function onDocumentClick(event: MouseEvent) {
  if (!open.value) return
  const root = rootRef.value
  if (root && !root.contains(event.target as Node)) close()
}

watch(
  () => props.modelValue,
  () => {
    // 值被外部改动（如切换渠道回退）时同步高亮
    if (!open.value) return
    const idx = props.options.findIndex((o) => o.value === props.modelValue)
    if (idx >= 0) highlight.value = idx
  },
)

// 选项变化（探测完成后列表刷新）时，若高亮越界则收敛
watch(
  () => props.options.length,
  () => {
    if (highlight.value >= props.options.length) {
      highlight.value = Math.max(0, props.options.length - 1)
    }
  },
)

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div
    ref="rootRef"
    class="selectbox"
    :class="{ open, disabled }"
  >
    <button
      :id="id"
      type="button"
      class="selectbox-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="selectbox-value" :class="{ placeholder: !current }">
        {{ current?.label ?? placeholder }}
      </span>
      <svg
        class="selectbox-arrow"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 6.5L8 10.5L12 6.5"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div
      v-if="open"
      ref="listRef"
      class="selectbox-list"
      role="listbox"
    >
      <div
        v-if="options.length === 0"
        class="selectbox-empty"
      >
        {{ emptyText }}
      </div>
      <div
        v-for="(o, i) in options"
        :key="o.value"
        class="selectbox-option"
        :class="{ active: o.value === modelValue, highlighted: i === highlight }"
        role="option"
        :aria-selected="o.value === modelValue"
        @mouseenter="highlight = i"
        @click="choose(o.value)"
      >
        <span class="selectbox-option-label">{{ o.label }}</span>
        <span
          v-if="o.hint"
          class="selectbox-option-hint"
        >{{ o.hint }}</span>
      </div>
    </div>
  </div>
</template>
