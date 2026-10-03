<template>
  <section class="page" data-module="relaytest">
    <header class="page-head">
      <div>
        <h2>保护校验管理</h2>
        <p class="page-desc">
          维护校验记录：动作值、返回值按校验项目的技术要求核查；缺格照常列出并标明，超技术要求挡回保存；不合格结论回写保护装置台账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记校验记录</button>
        <button class="btn" type="button" :disabled="exporting" @click="exportRows(false)">
          {{ exporting ? '导出中…' : '导出保护校验清单' }}
        </button>
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
    </p>

    <!-- 导出中途失败：给出从失败那一条继续的入口，也可以放弃进度，页面不留死入口 -->
    <div v-if="checkpoint" class="export-banner" role="alert">
      <div class="export-banner-text">
        <strong>导出在中途暂停：</strong>{{ checkpoint.failedMessage }}。
        已导出 {{ checkpoint.exportedIds.length }} 条，修正该条数据后可从这一条接着导出，已导出的部分不会重录；
        暂停时间 {{ formatTime(checkpoint.at) }}。
      </div>
      <div class="export-banner-actions">
        <button class="btn primary" type="button" :disabled="exporting" @click="exportRows(true)">从失败条目继续导出</button>
        <button class="btn ghost" type="button" @click="discardCheckpoint">放弃本次导出进度</button>
      </div>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table v-if="allCount > 0" class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>数据核查</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="{ row, ev } in evaluatedRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column" :class="cellClass(column, ev)">
            <template v-if="column === '动作值' || column === '返回值'">
              <span v-if="cellVerdict(column, ev).status === 'empty'" class="cell-missing">
                缺{{ column }}
              </span>
              <span
                v-else-if="cellVerdict(column, ev).status !== 'ok'"
                class="cell-abnormal"
                :title="cellMessage(column, ev)"
              >
                {{ row[column] }}
                <small>（异常）</small>
              </span>
              <span v-else class="cell-ok">{{ row[column] }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td class="cell-note">
            <span v-if="ev.notes.length" :class="ev.abnormal ? 'note-abnormal' : 'note-missing'">
              {{ ev.notes.join('；') }}
            </span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!evaluatedRows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            没有符合筛选条件的校验记录，可调整筛选条件或
            <button class="link" type="button" @click="resetFilters">重置条件</button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 一条记录都没有时给出空态说明与下一步入口，而不是空白页 -->
    <div v-else class="empty-panel">
      <p class="empty-title">暂无保护校验记录</p>
      <p class="empty-desc">当前没有任何已登记的校验记录，导出也没有内容可导出。可先登记第一条校验记录。</p>
      <button class="btn primary" type="button" @click="openCreate">登记校验记录</button>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护校验记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="infoMessage" class="info-text">{{ infoMessage }}</span>
    </footer>

    <!-- 登记弹层：同一台装置重复提交校验只留一条，保存前按技术要求校验 -->
    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal-card">
        <h3>登记校验记录</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>装置编号 *</span>
            <input list="relay-device-options" v-model="createForm.装置编号" placeholder="如 PROT-0001" @change="prefillDeviceName" />
            <datalist id="relay-device-options">
              <option v-for="device in deviceOptions" :key="device.code" :value="device.code">{{ device.name }}</option>
            </datalist>
          </label>
          <label class="form-item">
            <span>装置名称 *</span>
            <input v-model="createForm.装置名称" />
          </label>
          <label class="form-item">
            <span>校验项目 *</span>
            <select v-model="createForm.校验项目">
              <option value="" disabled>请选择校验项目</option>
              <option v-for="item in itemOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>动作值</span>
            <input v-model="createForm.动作值" :placeholder="actionHint(createForm.校验项目)" />
          </label>
          <label class="form-item">
            <span>返回值</span>
            <input v-model="createForm.返回值" :placeholder="returnHint(createForm.校验项目)" />
          </label>
          <label class="form-item">
            <span>校验人 *</span>
            <input v-model="createForm.校验人" />
          </label>
          <label class="form-item">
            <span>校验日期 *</span>
            <input v-model="createForm.校验日期" type="date" />
          </label>
        </div>
        <p v-if="createRequirement" class="spec-hint">{{ createRequirement }}</p>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 详情面板：动作值/返回值与列表同步，沿用同一份技术要求校验口径 -->
    <aside v-if="detailRow" class="detail-panel">
      <div class="detail-head">
        <h3>校验记录详情</h3>
        <button class="link" type="button" @click="closeDetail">关闭</button>
      </div>
      <dl class="detail-meta">
        <div><dt>校验编号</dt><dd>{{ detailRow.校验编号 }}</dd></div>
        <div><dt>装置编号</dt><dd>{{ detailRow.装置编号 }}</dd></div>
        <div><dt>装置名称</dt><dd>{{ detailRow.装置名称 }}</dd></div>
        <div><dt>当前状态</dt><dd>{{ detailRow.status }}</dd></div>
      </dl>
      <div class="form-grid">
        <label class="form-item">
          <span>校验项目</span>
          <select v-model="detailForm.校验项目">
            <option v-for="item in itemOptions" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>动作值</span>
          <input v-model="detailForm.动作值" :placeholder="actionHint(detailForm.校验项目)" />
        </label>
        <label class="form-item">
          <span>返回值</span>
          <input v-model="detailForm.返回值" :placeholder="returnHint(detailForm.校验项目)" />
        </label>
        <label class="form-item">
          <span>校验人</span>
          <input v-model="detailForm.校验人" />
        </label>
        <label class="form-item">
          <span>校验日期</span>
          <input v-model="detailForm.校验日期" type="date" />
        </label>
      </div>
      <p v-if="detailRequirement" class="spec-hint">{{ detailRequirement }}</p>
      <ul v-if="detailEval.notes.length" class="detail-notes">
        <li v-for="note in detailEval.notes" :key="note" :class="detailEval.abnormal ? 'note-abnormal' : 'note-missing'">
          {{ note }}
        </li>
      </ul>
      <p v-if="detailError" class="error-text">{{ detailError }}</p>
      <p v-else-if="detailInfo" class="info-text">{{ detailInfo }}</p>
      <div class="modal-actions">
        <button class="btn primary" type="button" @click="saveDetail">保存（同步列表）</button>
      </div>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadCsv, listEntries } from '@/api/local-service'
import {
  discardExportCheckpoint,
  exportRelayCsv,
  getExportCheckpoint,
  relayItemOptions,
  runRelayAction,
  saveRelayEntry,
  updateRelayEntry,
} from '@/api/relay-service'
import { listRows } from '@/data/local-store'
import {
  RELAY_ITEM_SPECS,
  formatBand,
  evaluateRelayRow,
  type CellVerdict,
  type RelayRowEvaluation,
} from '@/data/relay-specs'
import type { EntryRow } from '@/data/types'

const columns = ['校验编号', '装置编号', '装置名称', '校验项目', '动作值', '返回值', '校验人', '校验日期', '校验状态']
const actions = ['提交校验', '判定合格', '标记不合格']
const statuses = ['待校验', '校验中', '校验合格', '校验不合格']
const filterFields = columns.slice(0, 4)
const itemOptions = relayItemOptions()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const allCount = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const exporting = ref(false)
const checkpoint = ref(getExportCheckpoint())

const evaluatedRows = computed<{ row: EntryRow; ev: RelayRowEvaluation }[]>(() =>
  rows.value.map((row) => ({ row, ev: evaluateRelayRow(row) })),
)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待校验装置', value: rows.value.filter((row) => String(row.status) === '待校验').length },
  { label: '校验中', value: rows.value.filter((row) => String(row.status) === '校验中').length },
  { label: '校验合格装置', value: rows.value.filter((row) => String(row.status) === '校验合格').length },
  {
    label: '校验不合格装置',
    value: rows.value.filter((row) => String(row.status) === '校验不合格').length,
  },
  {
    label: '缺格待补记录',
    value: evaluatedRows.value.filter(({ ev }) => ev.missing.length > 0).length,
  },
])

const deviceOptions = computed(() =>
  listRows('protectiondevice').map((row) => ({
    code: String(row.装置编号 ?? ''),
    name: String(row.装置名称 ?? row.所属间隔 ?? ''),
  })),
)

function cellVerdict(column: string, ev: RelayRowEvaluation): CellVerdict {
  return column === '动作值' ? ev.action : ev.ret
}

function cellMessage(column: string, ev: RelayRowEvaluation): string {
  const verdict = cellVerdict(column, ev)
  return verdict.status === 'ok' ? '' : verdict.message
}

function cellClass(column: string, ev: RelayRowEvaluation): Record<string, boolean> {
  if (column !== '动作值' && column !== '返回值') {
    return {}
  }
  const status = cellVerdict(column, ev).status
  return { 'is-missing': status === 'empty', 'is-abnormal': status === 'bad' || status === 'out' }
}

function specOf(item: string) {
  return RELAY_ITEM_SPECS.find((spec) => spec.item === item)
}

function actionHint(item: string): string {
  const spec = specOf(item)
  return spec ? `技术要求 ${formatBand(spec.action)}` : '请先选择校验项目'
}

function returnHint(item: string): string {
  const spec = specOf(item)
  return spec ? `技术要求 ${formatBand(spec.return)}` : '请先选择校验项目'
}

function formatTime(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString()
}

function flash(message: string, ok: boolean) {
  if (ok) {
    errorMessage.value = ''
    infoMessage.value = message
  } else {
    infoMessage.value = ''
    errorMessage.value = message
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  errorMessage.value = ''
  infoMessage.value = ''
  try {
    allCount.value = listRows('relaytest').length
    const payload = listEntries('relaytest', filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护校验列表读取失败'
  }
}

function runAction(action: string, row: EntryRow) {
  const result = runRelayAction(Number(row.id), action)
  flash(result.message, result.ok)
  reload()
}

// ---- 导出：零条给空态说明；中途失败记录断点，修好后从失败条目接着走 ----

function exportRows(resume: boolean) {
  if (allCount.value === 0) {
    flash('当前没有校验记录，暂无可导出内容，请先登记', false)
    return
  }
  exporting.value = true
  try {
    const result = exportRelayCsv(resume)
    if (result.ok) {
      downloadCsv(result.filename, result.content)
      checkpoint.value = null
      flash(
        result.resumedFrom !== null
          ? `已从断点续导完成，本次补导 ${result.resumedFrom} 条，文件已生成`
          : '保护校验清单已导出',
        true,
      )
    } else {
      checkpoint.value = result.checkpoint
      flash(
        result.resumed
          ? `续导仍在该条目受阻：${result.checkpoint.failedMessage}，修正后可再次续导`
          : `导出在中途暂停：${result.checkpoint.failedMessage}，已导出 ${result.checkpoint.exportedIds.length} 条，可修正后续导`,
        false,
      )
    }
  } finally {
    exporting.value = false
    reload()
  }
}

function discardCheckpoint() {
  discardExportCheckpoint()
  checkpoint.value = null
  flash('已放弃上次导出进度，下次导出将从第一条开始', true)
}

// ---- 登记 ----

function emptyCreateForm() {
  return {
    装置编号: '',
    装置名称: '',
    校验项目: '',
    动作值: '',
    返回值: '',
    校验人: '',
    校验日期: new Date().toISOString().slice(0, 10),
  }
}

const createOpen = ref(false)
const createForm = ref(emptyCreateForm())
const createError = ref('')

const createRequirement = computed(() =>
  createForm.value.校验项目 ? specOf(createForm.value.校验项目)?.requirement ?? '' : '',
)

function openCreate() {
  createForm.value = emptyCreateForm()
  createError.value = ''
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function prefillDeviceName() {
  const hit = deviceOptions.value.find((device) => device.code === createForm.value.装置编号.trim())
  if (hit && !createForm.value.装置名称) {
    createForm.value.装置名称 = hit.name
  }
}

function submitCreate() {
  createError.value = ''
  const result = saveRelayEntry({ ...createForm.value })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  reload()
  flash(result.message, true)
}

// ---- 详情面板 ----

const selectedId = ref<number | null>(null)
const detailRow = ref<EntryRow | null>(null)
const detailForm = ref({ 校验项目: '', 动作值: '', 返回值: '', 校验人: '', 校验日期: '' })
const detailError = ref('')
const detailInfo = ref('')

const detailEval = computed<RelayRowEvaluation>(() =>
  evaluateRelayRow({
    校验项目: detailForm.value.校验项目,
    动作值: detailForm.value.动作值,
    返回值: detailForm.value.返回值,
  }),
)

const detailRequirement = computed(() =>
  detailForm.value.校验项目 ? specOf(detailForm.value.校验项目)?.requirement ?? '' : '',
)

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
  detailRow.value = row
  detailForm.value = {
    校验项目: String(row.校验项目 ?? ''),
    动作值: String(row.动作值 ?? ''),
    返回值: String(row.返回值 ?? ''),
    校验人: String(row.校验人 ?? ''),
    校验日期: String(row.校验日期 ?? ''),
  }
  detailError.value = ''
  detailInfo.value = ''
}

function closeDetail() {
  selectedId.value = null
  detailRow.value = null
}

function saveDetail() {
  if (selectedId.value === null) {
    return
  }
  detailError.value = ''
  detailInfo.value = ''
  const result = updateRelayEntry(selectedId.value, { ...detailForm.value })
  if (!result.ok) {
    detailError.value = result.message
    return
  }
  detailInfo.value = result.message
  reload()
  const latest = rows.value.find((row) => Number(row.id) === selectedId.value)
  if (latest) {
    detailRow.value = latest
  }
}

onMounted(reload)
</script>

<style scoped>
.cell-missing {
  color: #b54708;
  background: #fef0c7;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
}
.cell-abnormal {
  color: #b42318;
  background: #fee4e2;
  border-radius: 4px;
  padding: 1px 6px;
}
.cell-abnormal small {
  font-size: 11px;
}
td.is-missing,
td.is-abnormal {
  background: #fffaf0;
}
.note-missing {
  color: #b54708;
}
.note-abnormal {
  color: #b42318;
}
.cell-note {
  max-width: 240px;
}
.info-text {
  color: #175cd3;
}
.export-banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  background: #fef0c7;
  border: 1px solid #fedf89;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.export-banner-actions {
  display: flex;
  gap: 8px;
  white-space: nowrap;
}
.empty-panel {
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 40px 16px;
  text-align: center;
}
.empty-title {
  font-size: 15px;
  margin: 0 0 6px;
}
.empty-desc {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 14px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow: auto;
}
.modal-card h3 {
  margin: 0 0 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}
.form-item span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 3px;
}
.form-item input,
.form-item select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.spec-hint {
  font-size: 12px;
  color: #175cd3;
  background: #eff8ff;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 10px 0 0;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
  max-width: calc(100vw - 240px);
  background: #fff;
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(16, 24, 40, 0.12);
  padding: 18px 20px;
  overflow: auto;
  z-index: 15;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-head h3 {
  margin: 0;
}
.detail-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 12px 0;
  font-size: 13px;
}
.detail-meta dt {
  color: var(--muted);
  font-size: 12px;
}
.detail-meta dd {
  margin: 2px 0 0;
}
.detail-notes {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.detail-panel .form-grid {
  grid-template-columns: 1fr;
}
</style>
