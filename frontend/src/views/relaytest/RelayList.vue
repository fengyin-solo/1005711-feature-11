<template>
  <table class="data-table relay-table">
    <thead>
      <tr>
        <th v-for="column in columns" :key="column">{{ column }}</th>
        <th>当前状态</th>
        <th>可执行动作</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="String(row.id)">
        <td v-for="column in columns" :key="column" :class="cellClass(row, column)">
          <template v-if="isValueColumn(column)">
            <template v-if="editingId === row.id && editingField === column">
              <input
                v-model="draftText"
                class="cell-input"
                :aria-label="`编辑${column}`"
                @keyup.enter="commitEdit(row)"
                @keyup.esc="cancelEdit"
              />
            </template>
            <template v-else>
              <span v-if="checkOf(row)[fieldKey(column)].missing" class="missing-tag">
                缺{{ column }}
              </span>
              <template v-else>
                <span>{{ row[column] }}</span>
                <span v-if="valueIssue(row, column)" class="abnormal-tag">
                  {{ valueIssue(row, column) }}
                </span>
              </template>
              <button
                v-if="canEdit"
                class="link cell-edit"
                type="button"
                @click="startEdit(row, column)"
              >
                改
              </button>
            </template>
          </template>
          <template v-else>
            <span
              v-if="column === '校验项目' && checkOf(row).issues.includes('unknown-item')"
              class="abnormal-tag"
            >
              无技术要求
            </span>
            {{ row[column] ?? '—' }}
          </template>
        </td>
        <td>
          <span class="status-pill" :class="statusClass(row.status)">{{ row.status }}</span>
        </td>
        <td class="row-actions">
          <button class="link" type="button" @click="emit('submit', row)">提交校验</button>
          <button
            class="link"
            type="button"
            :disabled="processingId === row.id"
            @click="emit('pass', row)"
          >
            判定合格
          </button>
          <button
            class="link danger"
            type="button"
            :disabled="processingId === row.id"
            @click="emit('fail', row)"
          >
            标记不合格
          </button>
          <button class="link" type="button" @click="emit('detail', row)">详情</button>
        </td>
      </tr>
      <tr v-if="!rows.length">
        <td :colspan="columns.length + 2" class="empty-state">
          <div class="empty-block">
            <p class="empty-title">{{ emptyTitle }}</p>
            <p class="empty-tip">{{ emptyTip }}</p>
            <button v-if="showReset" class="btn" type="button" @click="emit('reset-filter')">
              清空筛选条件
            </button>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { checkRelayValues, type RelayCheckResult } from '@/data/relay-spec'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  rows: EntryRow[]
  columns: string[]
  canEdit: boolean
  processingId: number | null
  emptyTitle: string
  emptyTip: string
  showReset: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', row: EntryRow): void
  (e: 'pass', row: EntryRow): void
  (e: 'fail', row: EntryRow): void
  (e: 'detail', row: EntryRow): void
  (e: 'reset-filter'): void
  // 列表与详情面板的动作值/返回值走同一个保存事件，校验口径只有一份。
  (
    e: 'save-value',
    payload: { id: number; field: '动作值' | '返回值'; value: string },
  ): void
}>()

const editingId = ref<number | null>(null)
const editingField = ref<'动作值' | '返回值' | ''>('')
const draftText = ref('')
// 校验结果只依赖行数据，列表重渲染时直接复用；行被父级整体替换后自然失效重算。
const checks = new Map<number, RelayCheckResult>()

function checkOf(row: EntryRow): RelayCheckResult {
  const key = Number(row.id)
  const cached = checks.get(key)
  if (cached && cached.action.text === String(row['动作值'] ?? '').trim()
    && cached.retract.text === String(row['返回值'] ?? '').trim()
    && cached.item === String(row['校验项目'] ?? '').trim()) {
    return cached
  }
  const result = checkRelayValues(row)
  checks.set(key, result)
  return result
}

function isValueColumn(column: string): column is '动作值' | '返回值' {
  return column === '动作值' || column === '返回值'
}

function fieldKey(column: string): 'action' | 'retract' {
  return column === '动作值' ? 'action' : 'retract'
}

function valueIssue(row: EntryRow, column: string): string {
  const result = checkOf(row)
  const badIssue = column === '动作值' ? 'bad-action' : 'bad-retract'
  const specIssue = column === '动作值' ? 'spec-action' : 'spec-retract'
  if (result.issues.includes(badIssue)) {
    return '非数值'
  }
  if (result.issues.includes(specIssue)) {
    return '超技术要求'
  }
  return ''
}

function cellClass(row: EntryRow, column: string): Record<string, boolean> {
  if (!isValueColumn(column)) {
    return {}
  }
  const result = checkOf(row)
  const field = fieldKey(column)
  return {
    'cell-missing': result[field].missing,
    'cell-abnormal': valueIssue(row, column) !== '',
  }
}

function statusClass(status: string | number | boolean): string {
  const text = String(status)
  if (text === '校验合格') {
    return 'ok'
  }
  if (text === '校验不合格') {
    return 'bad'
  }
  if (text === '校验中') {
    return 'doing'
  }
  return 'pending'
}

function startEdit(row: EntryRow, column: '动作值' | '返回值') {
  editingId.value = Number(row.id)
  editingField.value = column
  draftText.value = String(row[column] ?? '')
}

function cancelEdit() {
  editingId.value = null
  editingField.value = ''
  draftText.value = ''
}

function commitEdit(row: EntryRow) {
  if (isValueColumn(editingField.value)) {
    emit('save-value', {
      id: Number(row.id),
      field: editingField.value,
      value: draftText.value,
    })
  }
  cancelEdit()
}
</script>
