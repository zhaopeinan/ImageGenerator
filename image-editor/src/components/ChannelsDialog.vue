<script setup lang="ts">
/**
 * 渠道管理对话框。
 *
 * API Key 只在保存时发往后端，之后再也不回到浏览器 ——
 * 列表里只有后端返回的脱敏预览（keyPreview）。
 */
import { computed, ref, watch } from 'vue'
import type { Channel } from '../types'

const props = defineProps<{
  open: boolean
  channels: Channel[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'create', input: { name: string; endpoint: string; apiKey: string; note?: string }): Promise<void>
  (
    e: 'update',
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
  ): Promise<void>
  (e: 'remove', id: string): Promise<void>
  (e: 'test', id: string): Promise<void>
  (e: 'probe', id: string): Promise<void>
  (e: 'unblock', id: string, model: string): Promise<void>
  (e: 'refresh'): Promise<void>
}>()

/** 三态：未验证 / 是 / 否 */
type TriFlag = 'unknown' | 'yes' | 'no'

interface Draft {
  id: string | null
  name: string
  endpoint: string
  apiKey: string
  note: string
  enabled: boolean
  isNew: boolean
  sizeViaPrompt: TriFlag
  qualityPassthrough: TriFlag
}

function triFrom(value: boolean | null | undefined): TriFlag {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'unknown'
}

function triTo(value: TriFlag): boolean | null {
  if (value === 'yes') return true
  if (value === 'no') return false
  return null
}

const draft = ref<Draft | null>(null)
const busy = ref(false)
const testing = ref<string | null>(null)
const probing = ref<string | null>(null)
/** 正在恢复的模型，格式 `${channelId}:${model}`，用于按钮级 loading */
const unblocking = ref<string | null>(null)
const testResults = ref<Record<string, { ok: boolean; message: string }>>({})
const formError = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) {
      draft.value = null
      formError.value = ''
      return
    }
    void emit('refresh')
  },
)

/** 某渠道被实测屏蔽的模型列表（附原因，用于 tooltip） */
function blockedModels(channel: Channel): { model: string; reason: string }[] {
  const map = channel.unavailableModels
  if (!map) return []
  return Object.entries(map).map(([model, info]) => ({
    model,
    reason: info?.reason ?? '实测不可用',
  }))
}

async function restoreModel(channel: Channel, model: string) {
  const key = `${channel.id}:${model}`
  if (!window.confirm(`将 ${model} 恢复到该渠道的模型下拉？\n\n如果渠道其实仍不可用，选了会报错。`)) {
    return
  }
  unblocking.value = key
  try {
    await emit('unblock', channel.id, model)
  } finally {
    unblocking.value = null
  }
}

const canSave = computed(() => {
  const d = draft.value
  if (!d) return false
  if (!d.name.trim() || !d.endpoint.trim()) return false
  // 新建必须填 Key；编辑时留空表示不修改
  if (d.isNew && !d.apiKey.trim()) return false
  return true
})

function startCreate() {
  formError.value = ''
  draft.value = {
    id: null,
    name: '',
    endpoint: 'https://api.openai.com/v1',
    apiKey: '',
    note: '',
    enabled: true,
    isNew: true,
    sizeViaPrompt: 'unknown',
    qualityPassthrough: 'unknown',
  }
}

function startEdit(channel: Channel) {
  formError.value = ''
  draft.value = {
    id: channel.id,
    name: channel.name,
    endpoint: channel.endpoint,
    apiKey: '',
    note: channel.note,
    enabled: channel.enabled,
    isNew: false,
    sizeViaPrompt: triFrom(channel.sizeViaPrompt),
    qualityPassthrough: triFrom(channel.qualityPassthrough),
  }
}

function cancelDraft() {
  draft.value = null
  formError.value = ''
}

async function save() {
  const d = draft.value
  if (!d || !canSave.value) return
  busy.value = true
  formError.value = ''
  try {
    if (d.isNew) {
      await emit('create', {
        name: d.name.trim(),
        endpoint: d.endpoint.trim(),
        apiKey: d.apiKey.trim(),
        note: d.note.trim(),
      })
    } else {
      const payload: Record<string, unknown> = {
        name: d.name.trim(),
        endpoint: d.endpoint.trim(),
        note: d.note.trim(),
        enabled: d.enabled,
        sizeViaPrompt: triTo(d.sizeViaPrompt),
        qualityPassthrough: triTo(d.qualityPassthrough),
      }
      // 留空表示不修改已有 Key
      if (d.apiKey.trim()) payload.apiKey = d.apiKey.trim()
      await emit('update', d.id as string, payload)
    }
    draft.value = null
  } catch (err) {
    formError.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    busy.value = false
  }
}

async function test(channel: Channel) {
  testing.value = channel.id
  try {
    await emit('test', channel.id)
  } finally {
    testing.value = null
  }
}

async function probeModels(channel: Channel) {
  probing.value = channel.id
  try {
    await emit('probe', channel.id)
  } finally {
    probing.value = null
  }
}

async function remove(channel: Channel) {
  if (!window.confirm(`删除渠道「${channel.name}」？\n\n该渠道保存的 API Key 会一并删除，无法恢复。`)) {
    return
  }
  await emit('remove', channel.id)
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    @click.self="emit('close')"
  >
    <div
      class="dialog"
      style="max-width: 640px"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channels-title"
    >
      <div class="dialog-head">
        <h3 id="channels-title">
          渠道管理
        </h3>
        <div class="dialog-head-actions">
          <button
            type="button"
            class="button button-sm"
            @click="emit('refresh')"
          >
            刷新
          </button>
          <button
            type="button"
            class="button dialog-close"
            aria-label="关闭"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
      </div>

      <p class="hint" style="margin: 0 0 1rem">
        渠道与 API Key 保存在本机后端（server/data/channels.json），不会下发到浏览器。
        前端只知道渠道名称，请求时由后端注入 Key 转发到上游。
      </p>

      <div
        v-if="error"
        class="notice notice-danger"
        style="margin-bottom: 1rem"
      >
        {{ error }}
      </div>

      <!-- 编辑 / 新建表单 -->
      <div
        v-if="draft"
        class="channel-form"
        style="margin-bottom: 1.25rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius)"
      >
        <div class="grid-2" style="margin-bottom: 0.75rem">
          <div>
            <label class="label">名称</label>
            <input
              v-model="draft.name"
              class="input"
              placeholder="如 WoYao 官方"
            >
          </div>
          <div>
            <label class="label">
              端点
              <span class="hint" style="display: inline; margin-left: 0.5rem">只填域名</span>
            </label>
            <input
              v-model="draft.endpoint"
              class="input"
              placeholder="https://api.example.com"
            >
            <p class="hint" style="margin: 0.25rem 0 0">
              末尾的 /images/edits 会自动补全，不用自己写
            </p>
          </div>
        </div>

        <div style="margin-bottom: 0.75rem">
          <label class="label">
            API Key
            <span
              v-if="!draft.isNew"
              class="hint"
              style="display: inline; margin-left: 0.5rem"
            >
              留空表示不修改
            </span>
          </label>
          <input
            v-model="draft.apiKey"
            class="input"
            type="password"
            :placeholder="draft.isNew ? 'sk-...' : '已保存，留空则不修改'"
          >
        </div>

        <div style="margin-bottom: 0.75rem">
          <label class="label">备注（可选）</label>
          <input
            v-model="draft.note"
            class="input"
            placeholder="如：香港线路，延迟低"
          >
        </div>

        <label
          v-if="!draft.isNew"
          style="display: flex; align-items: center; gap: 0.5rem; font-size: 13px; margin-bottom: 0.75rem"
        >
          <input
            v-model="draft.enabled"
            type="checkbox"
          >
          启用该渠道
        </label>

        <div
          v-if="!draft.isNew"
          class="grid-2"
          style="margin-bottom: 0.75rem"
        >
          <div>
            <label class="label">尺寸走提示词</label>
            <select v-model="draft.sizeViaPrompt" class="input">
              <option value="unknown">未验证（按 size 参数）</option>
              <option value="yes">是（TokenLab 类，size 无效）</option>
              <option value="no">否（woyao 类，走 size）</option>
            </select>
            <p class="hint" style="margin: 0.25rem 0 0">
              选错会导致比例无效。TokenLab 实测为「是」。
            </p>
          </div>
          <div>
            <label class="label">质量参数透传</label>
            <select v-model="draft.qualityPassthrough" class="input">
              <option value="unknown">未验证（允许选择）</option>
              <option value="yes">是（low/medium/high 生效）</option>
              <option value="no">否（改质量无差别）</option>
            </select>
            <p class="hint" style="margin: 0.25rem 0 0">
              为「否」时主界面会提示质量可能无效。
            </p>
          </div>
        </div>

        <div
          v-if="formError"
          class="notice notice-danger"
          style="margin-bottom: 0.75rem"
        >
          {{ formError }}
        </div>

        <div style="display: flex; gap: 0.5rem">
          <button
            type="button"
            class="button button-primary"
            style="width: auto; padding: 0.5rem 1.25rem"
            :disabled="!canSave || busy"
            @click="save"
          >
            {{ busy ? '保存中…' : '保存' }}
          </button>
          <button
            type="button"
            class="button"
            @click="cancelDraft"
          >
            取消
          </button>
        </div>
      </div>

      <button
        v-else
        type="button"
        class="button"
        style="width: 100%; margin-bottom: 1rem"
        @click="startCreate"
      >
        + 新建渠道
      </button>

      <!-- 渠道列表 -->
      <div
        v-if="loading && channels.length === 0"
        class="hint"
      >
        加载中…
      </div>

      <div
        v-else-if="channels.length === 0"
        class="hint"
        style="padding: 1.5rem 0; text-align: center"
      >
        还没有渠道，点上方「新建渠道」添加一个
      </div>

      <div
        v-for="c in channels"
        :key="c.id"
        class="channel-row"
      >
        <div style="min-width: 0; flex: 1">
          <div style="display: flex; align-items: center; gap: 0.5rem">
            <span style="font-size: 13px; font-weight: 500">{{ c.name }}</span>
            <span
              v-if="!c.enabled"
              class="tag-off"
            >已禁用</span>
            <span
              v-if="!c.hasKey"
              class="tag-warn"
            >未配置 Key</span>
          </div>
          <code style="font-size: 11px; color: var(--text-muted)">{{ c.endpoint }}</code>
          <div
            v-if="c.keyPreview"
            class="hint"
            style="margin-top: 0.125rem"
          >
            Key {{ c.keyPreview }}
          </div>
          <div
            v-if="c.note"
            class="hint"
          >
            {{ c.note }}
          </div>
          <div class="hint" style="margin-top: 0.25rem">
            尺寸：{{
              c.sizeViaPrompt === true ? '走提示词' : c.sizeViaPrompt === false ? '走 size' : '未验证'
            }}
            · 质量：{{
              c.qualityPassthrough === true
                ? '透传'
                : c.qualityPassthrough === false
                  ? '不透传'
                  : '未验证'
            }}
          </div>
          <div
            v-if="testResults[c.id]"
            class="hint"
            :style="testResults[c.id].ok ? 'color: var(--accent-text)' : 'color: var(--danger)'"
          >
            {{ testResults[c.id].message }}
          </div>

          <!--
            被屏蔽的模型：渠道声明支持但实测不可用，已从模型下拉剔除。
            给一个「恢复」入口 —— 渠道管理员后来开通后可以放回，
            黑名单因此只做屏蔽不做物理删除。
          -->
          <div
            v-if="blockedModels(c).length"
            class="blocked-models"
          >
            <span class="blocked-models-label">已屏蔽 {{ blockedModels(c).length }} 个模型</span>
            <div class="blocked-models-list">
              <span
                v-for="m in blockedModels(c)"
                :key="m.model"
                class="blocked-chip"
                :title="m.reason"
              >
                <span class="blocked-chip-name">{{ m.model }}</span>
                <button
                  type="button"
                  class="blocked-chip-restore"
                  :disabled="unblocking === `${c.id}:${m.model}`"
                  title="恢复该模型到下拉（渠道开通后使用）"
                  @click="restoreModel(c, m.model)"
                >
                  恢复
                </button>
              </span>
            </div>
          </div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 0.375rem; justify-content: flex-end">
          <button
            type="button"
            class="button button-sm"
            title="检查该渠道哪些模型未开通（失败的会立即排除，不产生费用）"
            @click="probeModels(c)"
          >
            {{ probing === c.id ? '检测中' : '检测模型' }}
          </button>
          <button
            type="button"
            class="button button-sm"
            :disabled="testing === c.id"
            title="发送一个最小请求，验证该渠道与所选模型能否真正出图（会产生少量费用）"
            @click="test(c)"
          >
            {{ testing === c.id ? '测试中' : '测试' }}
          </button>
          <button
            type="button"
            class="button button-sm"
            @click="startEdit(c)"
          >
            编辑
          </button>
          <button
            type="button"
            class="button button-sm button-danger"
            @click="remove(c)"
          >
            删除
          </button>
        </div>
      </div>

      <div class="dialog-actions">
        <button
          type="button"
          class="button button-primary"
          style="width: auto; padding: 0.5rem 1.25rem"
          @click="emit('close')"
        >
          完成
        </button>
      </div>
    </div>
  </div>
</template>
