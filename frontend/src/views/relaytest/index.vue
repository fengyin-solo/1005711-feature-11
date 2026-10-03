<template>
  <section class="page" data-module="relaytest">
    <header class="page-head">
      <div>
        <h2>保护校验管理</h2>
        <p class="page-desc">
          动作值、返回值按校验项目技术要求核对：缺值照常列出并标明缺在哪一格，超技术要求挡回保存；
          判定不合格自动回写保护装置台账待校验清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记校验记录</button>
        <button class="btn" type="button" @click="openExport">导出保护校验清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item warn">缺动作值/返回值待补：{{ gapCount }}</span>
      <span class="legend-item danger">超技术要求异常：{{ abnormalCount }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <RelayList
      :rows="rows"
      :columns="columns"
      :can-edit="true"
      :processing-id="processingId"
      :empty-title="emptyTitle"
      :empty-tip="emptyTip"
      :show-reset="hasActiveFilter"
      @submit="runSubmit"
      @pass="(row) => runVerdict(row, '合格')"
      @fail="(row) => runVerdict(row, '不合格')"
      @detail="openDetail"
      @reset-filter="resetFilters"
      @save-value="saveInlineValue"
    />

    <footer class="page-foot">
      <span>共 {{ total }} 条保护校验记录；同一台装置重复提交只保留一条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <RelayFormModal v-if="showForm" @close="showForm = false" @saved="onEntrySaved" />
    <RelayDetailDrawer
      :row="detailRow"
      @close="detailRow = null"
      @saved="onDetailSaved"
    />
    <RelayExportModal
      v-if="showExport"
      ref="exportModal"
      :filters="filters"
      @close="showExport = false"
      @fill="openDetailFromExport"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listEntries, moduleMeta } from '@/api/local-service'
import { checkRelayValues } from '@/data/relay-spec'
import {
  setRelayVerdict,
  submitRelay,
  updateRelayValues,
} from '@/data/relay-service'
import type { EntryRow } from '@/data/types'

import RelayList from './RelayList.vue'
import RelayFormModal from './RelayFormModal.vue'
import RelayDetailDrawer from './RelayDetailDrawer.vue'
import RelayExportModal from './RelayExportModal.vue'

const meta = moduleMeta('relaytest')
// 列与模块元数据字段保持一致，导出也是这一份。
const columns = ['校验编号', '装置编号', '装置名称', '校验项目', '动作值', '返回值', '校验人', '校验日期', '校验状态']
const statuses = ['待校验', '校验中', '校验合格', '校验不合格']
const filterFields = ['校验编号', '装置编号', '装置名称', '校验项目']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const processingId = ref<number | null>(null)
const showForm = ref(false)
const showExport = ref(false)
const detailRow = ref<EntryRow | null>(null)
const exportModal = ref<InstanceType<typeof RelayExportModal> | null>(null)

const hasActiveFilter = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const gapCount = computed(
  () => rows.value.filter((row) => checkRelayValues(row).missing).length,
)
const abnormalCount = computed(
  () => rows.value.filter((row) => checkRelayValues(row).abnormal).length,
)

const stats = computed(() => [
  { label: '待校验装置', value: countByStatus(['待校验', '校验中']) },
  { label: '校验合格装置', value: countByStatus(['校验合格']) },
  { label: '校验不合格装置', value: countByStatus(['校验不合格']) },
])

function countByStatus(targets: string[]): number {
  return rows.value.filter((row) => targets.includes(String(row.status))).length
}

const emptyTitle = computed(() =>
  hasActiveFilter.value
    ? '当前筛选条件下没有匹配的校验记录'
    : '暂无任何保护校验记录',
)
const emptyTip = computed(() =>
  hasActiveFilter.value
    ? '可清空筛选条件查看全部记录，或调整检索词后重试'
    : '可点击右上角「登记校验记录」补录第一条；缺动作值或返回值的记录也会照常列在这里',
)

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护校验列表读取失败'
  }
}

function findRow(id: number): EntryRow | undefined {
  return rows.value.find((row) => Number(row.id) === id)
}

function saveInlineValue(payload: {
  id: number
  field: '动作值' | '返回值'
  value: string
}) {
  const current = findRow(payload.id)
  if (!current) {
    return
  }
  const patch = {
    动作值: payload.field === '动作值' ? payload.value : String(current['动作值'] ?? ''),
    返回值: payload.field === '返回值' ? payload.value : String(current['返回值'] ?? ''),
  }
  const result = updateRelayValues(payload.id, patch)
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function runSubmit(row: EntryRow) {
  const result = submitRelay(Number(row.id))
  errorMessage.value = result.ok ? '' : result.message
  reload()
}

function runVerdict(row: EntryRow, verdict: '合格' | '不合格') {
  errorMessage.value = ''
  processingId.value = Number(row.id)
  try {
    const result = setRelayVerdict(Number(row.id), verdict)
    errorMessage.value = result.ok ? '' : result.message
    reload()
  } finally {
    processingId.value = null
  }
}

function openCreate() {
  showForm.value = true
}

function onEntrySaved() {
  showForm.value = false
  reload()
}

function openDetail(row: EntryRow) {
  detailRow.value = row
}

function openExport() {
  showExport.value = true
}

// 导出向导里点「去补录/修正」：带着失败条目打开详情；保存后通知向导从该条续导。
function openDetailFromExport(row: EntryRow) {
  detailRow.value = row
}

function onDetailSaved() {
  reload()
  if (showExport.value) {
    exportModal.value?.resumeAfterFix()
  }
}

onMounted(reload)
</script>
