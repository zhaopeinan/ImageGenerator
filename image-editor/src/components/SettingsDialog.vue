<script setup lang="ts">
/**
 * 设置：数据目录（Electron）+ 批量并发。
 * 换电脑时把整个数据目录拷走，再在新机器上选中即可还原渠道与画廊。
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
      aria-labelledby="settings-title"
    >
      <div class="settings-head">
        <h3 id="settings-title">设置</h3>
        <button
          type="button"
          class="button button-ghost"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>

      <section class="settings-section">
        <h4>数据目录</h4>
        <p class="settings-hint">
          渠道配置、画廊图片与本地草稿都保存在此目录。换电脑时把整个文件夹拷走，在新机器上选中即可继续用。
        </p>

        <template v-if="isElectron">
          <div class="settings-path-box">
            <div class="settings-path-label">当前目录</div>
            <code class="settings-path">{{ dataRoot || '…' }}</code>
            <div
              v-if="isCustom"
              class="settings-badge"
            >
              自定义
            </div>
            <div
              v-else
              class="settings-badge muted"
            >
              默认
            </div>
          </div>
          <p class="settings-sub">
            渠道文件：
            <code>{{ channelsPath }}</code>
          </p>
          <p class="settings-sub">
            默认位置：
            <code>{{ defaultDataRoot }}</code>
          </p>

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
            浏览器版数据目录固定为项目内
            <code>server/data</code>
            （渠道）与浏览器本地存储（画廊）。请使用桌面版「神笔」以自定义数据目录。
          </p>
        </template>
      </section>

      <section class="settings-section">
        <h4>批量并发</h4>
        <p class="settings-hint">
          一次生成多张时，最多同时向上游发出几路请求。调低可减轻限流与费用尖刺；调高可更快出齐。
        </p>
        <div class="settings-actions" style="align-items: center">
          <label class="settings-path-label" for="batch-concurrency">同时请求数</label>
          <select
            id="batch-concurrency"
            v-model.number="store.batchConcurrency"
            class="input"
            style="width: auto; min-width: 5rem"
          >
            <option :value="1">1（串行）</option>
            <option :value="2">2（推荐）</option>
            <option :value="3">3</option>
            <option :value="4">4</option>
          </select>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-dialog {
  width: min(560px, 92vw);
  max-height: min(80vh, 640px);
  overflow: auto;
  text-align: left;
}

.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.settings-head h3 {
  margin: 0;
}

.settings-section h4 {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
}

.settings-hint {
  margin: 0 0 1rem;
  color: var(--muted, #64748b);
  font-size: 0.85rem;
  line-height: 1.5;
}

.settings-hint.warn {
  color: #b45309;
}

.settings-path-box {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.35rem 0.75rem;
  align-items: start;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  border: 1px solid var(--border, #e2e8f0);
  background: var(--panel-2, #f8fafc);
  margin-bottom: 0.75rem;
}

.settings-path-label {
  grid-column: 1 / -1;
  font-size: 0.75rem;
  color: var(--muted, #64748b);
}

.settings-path {
  font-size: 0.8rem;
  word-break: break-all;
  line-height: 1.4;
}

.settings-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: #ccfbf1;
  color: #0f766e;
  white-space: nowrap;
}

.settings-badge.muted {
  background: #e2e8f0;
  color: #475569;
}

.settings-sub {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  color: var(--muted, #64748b);
}

.settings-sub code {
  font-size: 0.75rem;
  word-break: break-all;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.settings-msg {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
  color: #0f766e;
}

.settings-msg.error {
  color: #b91c1c;
}
</style>
