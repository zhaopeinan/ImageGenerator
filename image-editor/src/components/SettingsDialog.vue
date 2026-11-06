<script setup lang="ts">
/**
 * 设置：数据目录（Electron）+ 批量并发。
 * 浅色极简；并发用分段按钮外露，不藏进自定义下拉。
 */
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../composables/useEditorStore'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useEditorStore()
const isElectron = computed(() => Boolean(window.shenbi?.isElectron))

const dataRoot = ref('')
const defaultDataRoot = ref('')
const channelsPath = ref('')
const isCustom = ref(false)
const busy = ref(false)
const message = ref('')
const error = ref('')

const concurrencyOptions = [
  { value: 1, label: '1', hint: '串行' },
  { value: 2, label: '2', hint: '推荐' },
  { value: 3, label: '3', hint: '' },
  { value: 4, label: '4', hint: '' },
] as const

async function refresh() {
  error.value = ''
  message.value = ''
  if (!window.shenbi) return
  const info = await window.shenbi.getSettings()
  dataRoot.value = info.dataRoot
  defaultDataRoot.value = info.defaultDataRoot
  channelsPath.value = info.channelsPath
  isCustom.value = info.isCustom
}

watch(
  () => props.open,
  (open) => {
    if (open) void refresh()
  },
)

async function choose() {
  if (!window.shenbi || busy.value) return
  const path = await window.shenbi.chooseDataRoot()
  if (!path) return

  const migrate = window.confirm(
    `将数据目录设为：\n${path}\n\n若该文件夹为空，是否把当前数据复制过去？\n（推荐：首次换目录时选「确定」）\n\n设置后应用会自动重启。`,
  )
  busy.value = true
  error.value = ''
  try {
    const result = await window.shenbi.setDataRoot(path, { migrate })
    if (!result.ok) {
      error.value = result.error || '设置失败'
      return
    }
    message.value = '正在重启…'
  } finally {
    busy.value = false
  }
}

async function reset() {
  if (!window.shenbi || busy.value) return
  if (!window.confirm('恢复为默认数据目录？应用将重启。\n当前自定义目录里的文件不会被删除。')) {
    return
  }
  busy.value = true
  try {
    const result = await window.shenbi.resetDataRoot()
    if (!result.ok) error.value = result.error || '恢复失败'
    else message.value = '正在重启…'
  } finally {
    busy.value = false
  }
}

async function openFolder() {
  if (!window.shenbi) return
  const result = await window.shenbi.openDataRoot()
  if (!result.ok) error.value = result.error || '无法打开文件夹'
}

function setConcurrency(n: number) {
  store.batchConcurrency = n
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    @click.self="emit('close')"
  >
    <div
      class="dialog settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div class="dialog-head">
        <h3 id="settings-title">设置</h3>
        <button
          type="button"
          class="button dialog-close"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <section class="settings-section">
        <h4>数据目录</h4>
        <p class="settings-hint">
          渠道、画廊与草稿保存在此。换电脑时拷走整个文件夹，在新机器上选中即可继续。
        </p>

        <template v-if="isElectron">
          <div class="settings-path-card">
            <div class="settings-path-top">
              <span class="settings-kicker">当前目录</span>
              <span
                class="settings-badge"
                :class="{ muted: !isCustom }"
              >
                {{ isCustom ? '自定义' : '默认' }}
              </span>
            </div>
            <code class="settings-path">{{ dataRoot || '…' }}</code>
          </div>

          <dl class="settings-meta">
            <div>
              <dt>渠道文件</dt>
              <dd><code>{{ channelsPath }}</code></dd>
            </div>
            <div>
              <dt>默认位置</dt>
              <dd><code>{{ defaultDataRoot }}</code></dd>
            </div>
          </dl>

          <div class="settings-actions">
            <button
              type="button"
              class="button"
              :disabled="busy"
              @click="choose"
            >
              选择文件夹…
            </button>
            <button
              type="button"
              class="button button-ghost"
              :disabled="busy"
              @click="openFolder"
            >
              在 Finder 中打开
            </button>
            <button
              type="button"
              class="button button-ghost"
              :disabled="busy || !isCustom"
              @click="reset"
            >
              恢复默认
            </button>
          </div>
          <p
            v-if="message"
            class="settings-msg"
          >
            {{ message }}
          </p>
          <p
            v-if="error"
            class="settings-msg error"
          >
            {{ error }}
          </p>
        </template>

        <template v-else>
          <p class="settings-hint warn">
            浏览器版数据在
            <code>server/data</code>
            与浏览器本地存储。自定义目录请用桌面版「神笔」。
          </p>
        </template>
      </section>

      <section class="settings-section">
        <h4>批量并发</h4>
        <p class="settings-hint">
          一次生成多张时，同时向上游发出几路请求。调低减轻限流；调高更快出齐。
        </p>
        <div
          class="segmented"
          role="radiogroup"
          aria-label="同时请求数"
        >
          <button
            v-for="opt in concurrencyOptions"
            :key="opt.value"
            type="button"
            class="segmented-btn"
            role="radio"
            :aria-checked="store.batchConcurrency === opt.value"
            :class="{ active: store.batchConcurrency === opt.value }"
            @click="setConcurrency(opt.value)"
          >
            <span class="seg-main">{{ opt.label }}</span>
            <span
              v-if="opt.hint"
              class="seg-hint"
            >{{ opt.hint }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-dialog {
  width: min(520px, 92vw);
  max-height: min(82vh, 680px);
  overflow: auto;
  text-align: left;
}

.settings-section + .settings-section {
  margin-top: 1.5rem;
  padding-top: 1.35rem;
  border-top: 1px solid var(--border);
}

.settings-section h4 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text);
}

.settings-hint {
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1.55;
}

.settings-hint.warn {
  color: var(--warn-text);
}

.settings-path-card {
  padding: 0.85rem 0.95rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  margin-bottom: 0.85rem;
}

.settings-path-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.settings-kicker {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.settings-path {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--text);
  word-break: break-all;
}

.settings-badge {
  flex: 0 0 auto;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  white-space: nowrap;
}

.settings-badge.muted {
  background: var(--bg-elevated);
  color: var(--text-muted);
}

.settings-meta {
  margin: 0 0 0.25rem;
}

.settings-meta > div {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.78rem;
}

.settings-meta dt {
  color: var(--text-muted);
}

.settings-meta dd {
  margin: 0;
  color: var(--text);
  min-width: 0;
}

.settings-meta code {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  word-break: break-all;
  color: var(--text);
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.95rem;
}

.settings-msg {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  color: var(--accent-text);
}

.settings-msg.error {
  color: var(--danger);
}

.seg-main {
  display: block;
  line-height: 1.2;
}

.seg-hint {
  display: block;
  margin-top: 0.15rem;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-subtle);
}

.segmented-btn.active .seg-hint {
  color: var(--accent-text);
  opacity: 0.85;
}
</style>
