<template>
  <div v-if="row" class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-label="校验记录详情">
      <header class="drawer-head">
        <div>
          <h3>校验记录详情</h3>
          <p class="drawer-sub">{{ String(row['校验编号']) }} · {{ String(row['装置名称'] ?? '—') }}</p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="drawer-body">
        <dl class="detail-grid">
          <div v-for="field in readFields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd>{{ row[field] === '' || row[field] === undefined ? '—' : row[field] }}</dd>
          </div>
          <div class="detail-item">
            <dt>当前状态</dt>
            <dd>{{ row.status }}</dd>
          </div>
        </dl>

        <section class="spec-panel">
          <h4>技术要求（{{ spec ? spec.item : '未登记' }}）</h4>
          <p v-if="!spec" class="error-text">该项目未登记技术要求，动作值无法核对</p>
          <ul v-else class="spec-list">
            <li>动作值允许范围：{{ rangeText(spec.action, spec.unit) }}</li>
            <li>返回值允许范围：{{ rangeText(spec.retract, spec.unit) }}</li>
          </ul>
        </section>

        <section class="edit-panel">
          <h4>动作值 / 返回值录入</h4>
          <p class="panel-tip">与列表格内录入同源：此处保存后列表同步刷新，沿用同一校验口径。</p>
          <div class="form-grid">
            <label class="form-item">
              <span>动作值（{{ spec ? spec.unit : '' }}）</span>
              <input v-model="draft.动作值" placeholder="如 6.00A" />
              <small v-if="error.actionError" class="field-error">{{ error.actionError }}</small>
              <small v-else-if="result.action.missing" class="field-warn">动作值空缺，列表已标出待补</small>
            </label>
            <label class="form-item">
              <span>返回值（{{ spec ? spec.unit : '' }}）</span>
              <input v-model="draft.返回值" placeholder="如 5.10A" />
              <small v-if="error.retractError" class="field-error">{{ error.retractError }}</small>
              <small v-else-if="result.retract.missing" class="field-warn">返回值空缺，列表已标出待补</small>
            </label>
          </div>
          <div class="drawer-actions">
            <button class="btn primary" type="button" :disabled="saving" @click="saveValues">
              {{ saving ? '保存中…' : '保存动作值/返回值' }}
            </button>
            <button class="btn ghost" type="button" @click="emit('close')">取消</button>
          </div>
          <p v-if="saveMessage" class="save-tip" :class="{ ok: saveOk }">{{ saveMessage }}</p>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import {
  checkRelayValues,
  findRelaySpec,
  rangeText,
} from '@/data/relay-spec'
import { updateRelayValues, validateRelayDraft } from '@/data/relay-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  row: EntryRow | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const readFields = ['校验编号', '装置编号', '装置名称', '校验项目', '校验人', '校验日期', '校验状态']

const draft = reactive({ 动作值: '', 返回值: '' })
const saving = ref(false)
const saveMessage = ref('')
const saveOk = ref(false)

watch(
  () => props.row,
  (row) => {
    draft.动作值 = row ? String(row['动作值'] ?? '') : ''
    draft.返回值 = row ? String(row['返回值'] ?? '') : ''
    saveMessage.value = ''
  },
  { immediate: true },
)

const spec = ref(findRelaySpec(props.row ? String(props.row['校验项目'] ?? '') : ''))

watch(
  () => props.row?.['校验项目'],
  (item) => {
    spec.value = item === undefined ? undefined : findRelaySpec(String(item))
  },
  { immediate: true },
)

const result = ref(checkRelayValues({ 校验项目: '', 动作值: '', 返回值: '' }))
const error = ref<{ actionError: string; retractError: string }>({
  actionError: '',
  retractError: '',
})

watch(
  [() => props.row, draft],
  () => {
    if (!props.row) {
      return
    }
    const checked = checkRelayValues({
      校验项目: props.row['校验项目'],
      动作值: draft.动作值,
      返回值: draft.返回值,
    })
    result.value = checked
    const validation = validateRelayDraft({
      装置编号: String(props.row['装置编号'] ?? ''),
      装置名称: String(props.row['装置名称'] ?? ''),
      校验项目: String(props.row['校验项目'] ?? ''),
      动作值: draft.动作值,
      返回值: draft.返回值,
      校验人: String(props.row['校验人'] ?? ''),
      校验日期: String(props.row['校验日期'] ?? ''),
    })
    error.value = { actionError: validation.actionError, retractError: validation.retractError }
  },
  { deep: true, immediate: true },
)

function saveValues() {
  if (!props.row || saving.value) {
    return
  }
  saving.value = true
  try {
    const outcome = updateRelayValues(Number(props.row.id), {
      动作值: draft.动作值,
      返回值: draft.返回值,
    })
    saveOk.value = outcome.ok
    saveMessage.value = outcome.message
    if (outcome.ok) {
      emit('saved')
    }
  } finally {
    saving.value = false
  }
}
</script>
