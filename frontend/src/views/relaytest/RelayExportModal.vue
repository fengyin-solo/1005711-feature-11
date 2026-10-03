<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal wide" role="dialog" aria-label="导出保护校验清单">
      <header class="modal-head">
        <h3>导出保护校验清单</h3>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="modal-body">
        <div class="export-progress">
          <div class="progress-line">
            <span>共 {{ totalRows }} 条，已通过 {{ doneCount }} 条，待处理 {{ pendingCount }} 条，未通过 {{ failCount }} 条</span>
          </div>
          <div class="progress-bar">
            <span class="seg done" :style="{ width: `${totalRows ? (doneCount / totalRows) * 100 : 0}%` }"></span>
            <span class="seg fail" :style="{ width: `${totalRows ? (failCount / totalRows) * 100 : 0}%` }"></span>
          </div>
        </div>

        <table v-if="rows.length" class="data-table export-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>校验编号</th>
              <th>装置名称</th>
              <th>校验项目</th>
              <th>动作值</th>
              <th>返回值</th>
              <th>核对结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="String(row.id)" :class="rowStateClass(row)">
              <td>{{ index + 1 }}</td>
              <td>{{ row['校验编号'] }}</td>
              <td>{{ row['装置名称'] }}</td>
              <td>{{ row['校验项目'] }}</td>
              <td>
                <span v-if="isMissing(row, '动作值')" class="missing-tag">缺动作值</span>
                <template v-else>{{ row['动作值'] }}</template>
              </td>
              <td>
                <span v-if="isMissing(row, '返回值')" class="missing-tag">缺返回值</span>
                <template v-else>{{ row['返回值'] }}</template>
              </td>
              <td>
                <template v-if="stateOf(row) === 'passed'">
                  <span class="pass-text">通过</span>
                </template>
                <template v-else-if="stateOf(row) === 'failed'">
                  <span class="error-text">{{ reasonsOf(row) }}</span>
                  <button class="link" type="button" @click="emit('fill', row)">去补录/修正</button>
                </template>
                <template v-else-if="stateOf(row) === 'skipped'">
                  <span class="skip-text">已跳过</span>
                </template>
                <template v-else>
                  <span class="muted-text">待处理</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-block">
          <p class="empty-title">当前筛选条件下没有可导出的校验记录</p>
          <p class="empty-tip">请调整筛选条件或先登记校验记录</p>
        </div>

        <p v-if="phase === 'paused'" class="pause-tip">
          导出于第 {{ cursor + 1 }} 条停下：该条未通过。修正后点「从失败条续导」，已通过的条目不重走；也可跳过本条继续。
        </p>
        <p v-if="phase === 'done'" class="done-tip">
          导出完成：{{ doneCount }} 条已写入文件<template v-if="failCount">，{{ failCount }} 条未导出，文件末尾附有明细</template>。
        </p>
      </div>

      <footer class="modal-foot">
        <button
          v-if="phase === 'idle' && totalRows > 0"
          class="btn primary"
          type="button"
          :disabled="running"
          @click="runFrom(0)"
        >
          {{ running ? '核对中…' : '开始导出' }}
        </button>
        <button
          v-if="phase === 'paused'"
          class="btn primary"
          type="button"
          :disabled="running"
          @click="runFrom(cursor)"
        >
          从失败条续导
        </button>
        <button
          v-if="phase === 'paused'"
          class="btn"
          type="button"
          :disabled="running"
          @click="skipAndContinue"
        >
          跳过本条继续
        </button>
        <button
          v-if="phase === 'done' || (phase === 'paused' && doneCount > 0)"
          class="btn primary"
          type="button"
          @click="downloadFile"
        >
          下载已通过的清单（{{ doneCount }} 条）
        </button>
        <button class="btn ghost" type="button" @click="emit('close')">
          {{ phase === 'done' ? '关闭' : '取消导出' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { checkRelayValues, relayIssueText } from '@/data/relay-spec'
import { buildRelayExport, inspectRelayExport } from '@/data/relay-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  filters: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  // 导出卡在某条时直接打开该条详情补录，保存后续导，不必从头重录。
  (e: 'fill', row: EntryRow): void
}>()

type RowPhase = 'pending' | 'passed' | 'failed' | 'skipped'

const rows = ref<EntryRow[]>([])
const stateById = ref(new Map<number, RowPhase>())
const reasonById = ref(new Map<number, string>())
const cursor = ref(0)
const phase = ref<'idle' | 'running' | 'paused' | 'done'>('idle')
const running = ref(false)

const totalRows = computed(() => rows.value.length)
const doneCount = computed(() => countState('passed'))
const failCount = computed(
  () => countState('failed') + countState('skipped'),
)
const pendingCount = computed(() => countState('pending'))

function countState(state: RowPhase): number {
  let count = 0
  for (const value of stateById.value.values()) {
    if (value === state) {
      count += 1
    }
  }
  return count
}

function stateOf(row: EntryRow): RowPhase {
  return stateById.value.get(Number(row.id)) ?? 'pending'
}

function reasonsOf(row: EntryRow): string {
  return reasonById.value.get(Number(row.id)) ?? ''
}

function rowStateClass(row: EntryRow): Record<string, boolean> {
  const state = stateOf(row)
  return {
    'row-passed': state === 'passed',
    'row-failed': state === 'failed',
    'row-skipped': state === 'skipped',
  }
}

function isMissing(row: EntryRow, field: '动作值' | '返回值'): boolean {
  const text = String(row[field] ?? '').trim()
  return text === ''
}

function loadRows() {
  const inspected = inspectRelayExport(props.filters)
  rows.value = inspected.rows
  stateById.value = new Map(inspected.rows.map((row) => [Number(row.id), 'pending']))
  reasonById.value = new Map()
  cursor.value = 0
  phase.value = 'idle'
}

// 逐条核：从指定序号开始；只把还没通过的条目重走，已通过的不再重复处理。
async function runFrom(start: number) {
  if (running.value) {
    return
  }
  running.value = true
  phase.value = 'running'
  try {
    for (let index = start; index < rows.value.length; index += 1) {
      const row = rows.value[index]
      const existing = stateOf(row)
      if (existing === 'passed' || existing === 'skipped') {
        continue
      }
      // 让出一帧，进度条与行状态能刷出来，入口不会表现成“卡住”。
      await new Promise((resolve) => window.setTimeout(resolve, 30))
      const result = checkRelayValues(row)
      if (result.issues.length === 0) {
        stateById.value.set(Number(row.id), 'passed')
        reasonById.value.delete(Number(row.id))
        stateById.value = new Map(stateById.value)
      } else {
        stateById.value.set(Number(row.id), 'failed')
        reasonById.value.set(
          Number(row.id),
          result.issues.map(relayIssueText).join('、'),
        )
        stateById.value = new Map(stateById.value)
        cursor.value = index
        phase.value = 'paused'
        running.value = false
        return
      }
    }
    phase.value = 'done'
  } finally {
    running.value = false
  }
}

function skipAndContinue() {
  const row = rows.value[cursor.value]
  if (row) {
    stateById.value.set(Number(row.id), 'skipped')
    stateById.value = new Map(stateById.value)
  }
  void runFrom(cursor.value + 1)
}

function downloadFile() {
  const passed: EntryRow[] = []
  const skipped = rows.value
    .filter((row) => {
      const state = stateOf(row)
      return state === 'failed' || state === 'skipped'
    })
    .map((row) => {
      const result = checkRelayValues(row)
      return {
        id: Number(row.id),
        code: String(row['校验编号'] ?? row.id),
        item: String(row['校验项目'] ?? ''),
        reasons: result.issues.map(relayIssueText),
      }
    })
  for (const row of rows.value) {
    if (stateOf(row) === 'passed') {
      passed.push(row)
    }
  }
  const { filename, content } = buildRelayExport(passed, skipped)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 详情补录保存后调用：重取最新数据，已通过条目沿用文件结果，只从失败处接着核，不必重录。
function resumeAfterFix() {
  const inspected = inspectRelayExport(props.filters)
  const next = new Map<number, RowPhase>()
  for (const row of inspected.rows) {
    const previous = stateById.value.get(Number(row.id))
    next.set(Number(row.id), previous === 'skipped' ? 'pending' : previous ?? 'pending')
  }
  reasonById.value = new Map()
  rows.value = inspected.rows
  stateById.value = next
  const firstOpen = inspected.rows.findIndex((row) => {
    const state = next.get(Number(row.id))
    return state === 'failed' || state === 'pending'
  })
  void runFrom(firstOpen < 0 ? inspected.rows.length : firstOpen)
}

defineExpose({ resumeAfterFix, loadRows })

// 打开向导即核当前筛选下的数据；浏览器端与 SSR 首屏都能拿到行。
loadRows()
</script>
