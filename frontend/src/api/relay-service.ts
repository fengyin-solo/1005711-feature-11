import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

import {
  RELAY_ITEM_SPECS,
  evaluateRelayRow,
} from '@/data/relay-specs'

const RELAY_KEY = 'relaytest'
const DEVICE_KEY = 'protectiondevice'

const STATUS_PENDING = '待校验'
const STATUS_TESTING = '校验中'
const STATUS_PASS = '校验合格'
const STATUS_FAIL = '校验不合格'
const DEVICE_PENDING_STATUS = '待校验'

export type RelaySaveInput = {
  装置编号: string
  装置名称: string
  校验项目: string
  动作值: string
  返回值: string
  校验人: string
  校验日期: string
  existingId?: number
}

export type RelaySaveResult = ActionResult & { id?: number; deduped?: boolean; missing: string[] }

function getDeviceCode(row: EntryRow): string {
  return String(row.装置编号 ?? '').trim()
}

// 保存前统一走既有校验口径：缺格允许保存（列表照常列出并标明），超技术要求/无法识别一律挡回。
function validate(input: Pick<RelaySaveInput, '校验项目' | '动作值' | '返回值'>): {
  blockers: string[]
  missing: string[]
} {
  const verdict = evaluateRelayRow({
    校验项目: input.校验项目,
    动作值: input.动作值,
    返回值: input.返回值,
  })
  return { blockers: verdict.blockers, missing: verdict.missing }
}

// 同一台装置重复提交校验只留一条：命中同装置编号的旧记录就原地更新，不再新增。
export function saveRelayEntry(input: RelaySaveInput): RelaySaveResult {
  const missing = ['装置编号', '装置名称', '校验项目', '校验人', '校验日期']
    .filter((field) => String(input[field as keyof RelaySaveInput] ?? '').trim() === '')
  if (missing.length > 0) {
    return { ok: false, message: `请先补全必填项：${missing.join('、')}`, missing: [] }
  }

  const rows = listRows(RELAY_KEY)
  const existing =
    input.existingId !== undefined
      ? rows.find((row) => Number(row.id) === Number(input.existingId))
      : rows.find((row) => getDeviceCode(row) === input.装置编号.trim())

  // 动作值、返回值按校验项目的技术要求核；缺一项先放行，超技术要求挡回保存。
  const checked = validate(input)
  if (checked.blockers.length > 0) {
    return { ok: false, message: checked.blockers.join('；'), missing: checked.missing }
  }

  if (existing) {
    const updated: EntryRow = {
      ...existing,
      装置编号: input.装置编号.trim(),
      装置名称: input.装置名称.trim(),
      校验项目: input.校验项目,
      动作值: input.动作值.trim(),
      返回值: input.返回值.trim(),
      校验人: input.校验人.trim(),
      校验日期: input.校验日期,
      校验状态: STATUS_PENDING,
      status: STATUS_PENDING,
      pending: true,
      abnormal: checked.blockers.length > 0,
    }
    saveRows(RELAY_KEY, rows.map((row) => (row === existing ? updated : row)))
    return {
      ok: true,
      id: Number(existing.id),
      deduped: true,
      missing: checked.missing,
      message:
        checked.missing.length > 0
          ? `已并入该装置原有的校验记录（只保留一条），当前缺${checked.missing.join('、')}，已在列表标明`
          : '该装置已有校验记录，重复提交已并入原记录（只保留一条）',
    }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const record: EntryRow = {
    id: nextId,
    status: STATUS_PENDING,
    pending: true,
    abnormal: checked.blockers.length > 0,
    校验编号: `RELA-${String(nextId).padStart(4, '0')}`,
    装置编号: input.装置编号.trim(),
    装置名称: input.装置名称.trim(),
    校验项目: input.校验项目,
    动作值: input.动作值.trim(),
    返回值: input.返回值.trim(),
    校验人: input.校验人.trim(),
    校验日期: input.校验日期,
    校验状态: STATUS_PENDING,
  }
  saveRows(RELAY_KEY, [...rows, record])
  return {
    ok: true,
    id: nextId,
    missing: checked.missing,
    message:
      checked.missing.length > 0
        ? `校验记录已登记，当前缺${checked.missing.join('、')}，已在列表标明`
        : '校验记录已登记',
  }
}

export type RelayRowUpdate = Pick<
  RelaySaveInput,
  '校验项目' | '动作值' | '返回值' | '校验人' | '校验日期'
>

// 详情面板保存：与列表同一套技术要求口径，保存成功后列表动作值随之同步。
export function updateRelayEntry(id: number, patch: RelayRowUpdate): RelaySaveResult {
  const rows = listRows(RELAY_KEY)
  const current = rows.find((row) => Number(row.id) === Number(id))
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的校验记录`, missing: [] }
  }
  const merged: RelaySaveInput = {
    装置编号: getDeviceCode(current),
    装置名称: String(current.装置名称 ?? ''),
    校验项目: patch.校验项目,
    动作值: patch.动作值,
    返回值: patch.返回值,
    校验人: patch.校验人,
    校验日期: patch.校验日期,
    existingId: id,
  }
  for (const field of ['校验人', '校验日期'] as const) {
    if (String(merged[field] ?? '').trim() === '') {
      return { ok: false, message: `请先补全必填项：${field}`, missing: [] }
    }
  }
  const checked = validate(merged)
  if (checked.blockers.length > 0) {
    return { ok: false, message: checked.blockers.join('；'), missing: checked.missing }
  }
  const updated: EntryRow = {
    ...current,
    校验项目: merged.校验项目,
    动作值: merged.动作值.trim(),
    返回值: merged.返回值.trim(),
    校验人: merged.校验人.trim(),
    校验日期: merged.校验日期,
    abnormal: false,
  }
  saveRows(RELAY_KEY, rows.map((row) => (row === current ? updated : row)))
  return {
    ok: true,
    id,
    missing: checked.missing,
    message: checked.missing.length > 0 ? `已保存，当前缺${checked.missing.join('、')}，已在列表标明` : '校验数据已保存，列表已同步',
  }
}

// 判定不合格的结论回写到保护装置台账：同装置编号的记录回到「待校验」清单。
function writeBackUnqualified(deviceCode: string): boolean {
  const devices = listRows(DEVICE_KEY)
  const target = devices.find((row) => String(row.装置编号 ?? '').trim() === deviceCode)
  if (!target) {
    return false
  }
  const updated: EntryRow = {
    ...target,
    status: DEVICE_PENDING_STATUS,
    pending: true,
    abnormal: false,
  }
  saveRows(DEVICE_KEY, devices.map((row) => (row === target ? updated : row)))
  return true
}

export type RelayActionResult = ActionResult & { writtenBack?: boolean }

export function runRelayAction(id: number, action: string): RelayActionResult {
  const rows = listRows(RELAY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的校验记录` }
  }
  const current = rows[index]
  const verdict = evaluateRelayRow(current)
  const target =
    action === '提交校验'
      ? STATUS_TESTING
      : action === '判定合格'
        ? STATUS_PASS
        : action === '标记不合格'
          ? STATUS_FAIL
          : ''
  if (!target) {
    return { ok: false, message: `校验记录没有登记「${action}」这个动作` }
  }
  if (String(current.status) === target) {
    return { ok: false, message: `校验记录已经是「${target}」，不用重复操作` }
  }
  // 提交校验、判定合格之前：缺格与超技术要求都挡住，说明缺在哪一格/超在哪一格。
  if (target === STATUS_TESTING || target === STATUS_PASS) {
    if (verdict.blockers.length > 0) {
      return { ok: false, message: `无法${action}：${verdict.blockers.join('；')}` }
    }
    if (verdict.missing.length > 0) {
      return { ok: false, message: `无法${action}：缺${verdict.missing.join('、')}，请在详情面板补齐后再提交` }
    }
  }

  const updated: EntryRow = {
    ...current,
    status: target,
    校验状态: target,
    pending: target !== STATUS_PASS && target !== STATUS_FAIL,
    abnormal: target === STATUS_FAIL ? true : verdict.abnormal,
  }
  saveRows(RELAY_KEY, rows.map((row, i) => (i === index ? updated : row)))

  if (target === STATUS_FAIL) {
    const writtenBack = writeBackUnqualified(getDeviceCode(current))
    return {
      ok: true,
      writtenBack,
      message: writtenBack
        ? '已标记为校验不合格，结论已回写到保护装置台账（该装置重新进入待校验清单）'
        : '已标记为校验不合格；保护装置台账中未找到同装置编号的记录，未能回写待校验清单',
    }
  }
  return { ok: true, message: `校验记录已${action}，当前状态「${target}」` }
}

export function relayItemOptions(): string[] {
  return RELAY_ITEM_SPECS.map((spec) => spec.item)
}

// ---- 导出：逐行构建，失败在哪一条就把进度记下来，修好后从这一条接着走，不必重录 ----

const EXPORT_KEY = 'substation-protection:relay-export-checkpoint'
const EXPORT_FIELDS = [
  '校验编号',
  '装置编号',
  '装置名称',
  '校验项目',
  '动作值',
  '返回值',
  '校验人',
  '校验日期',
  '校验状态',
]
const EXPORT_HEADER = ['编号', ...EXPORT_FIELDS, '数据核查', '当前状态'].join(',')

export type ExportCheckpoint = {
  at: string
  // 已成功导出的记录 id，续导时跳过（记录顺序变化也不会重导）。
  exportedIds: number[]
  // 已生成的 CSV 数据行，续导成功后与后续行拼成完整清单，已导出部分不必重录。
  exportedLines: string[]
  failedId: number
  failedMessage: string
}

export function getExportCheckpoint(): ExportCheckpoint | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(EXPORT_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as ExportCheckpoint
  } catch {
    return null
  }
}

function clearExportCheckpoint(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(EXPORT_KEY)
  }
}

function saveCheckpoint(checkpoint: ExportCheckpoint): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(EXPORT_KEY, JSON.stringify(checkpoint))
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildLine(row: EntryRow): string {
  const verdict = evaluateRelayRow(row)
  const checkNotes: string[] = []
  if (verdict.missing.length > 0) {
    checkNotes.push(`缺${verdict.missing.join('、')}`)
  }
  checkNotes.push(...verdict.notes.filter((note) => !note.startsWith('缺')))
  return [
    row.id,
    ...EXPORT_FIELDS.map((field) => {
      if (field === '动作值' || field === '返回值') {
        const cellVerdict = field === '动作值' ? verdict.action : verdict.ret
        if (cellVerdict.status === 'empty') {
          return `缺${field}`
        }
        if (cellVerdict.status === 'bad' || cellVerdict.status === 'out') {
          // 导出中途就失败在这一条，便于定位后从该条续导。
          throw new Error(`第 ${row.id} 条（${String(row.校验编号 ?? '')}）${cellVerdict.message}`)
        }
      }
      return row[field] ?? ''
    }),
    checkNotes.join('；'),
    row.status,
  ]
    .map(csvCell)
    .join(',')
}

export type RelayExportResult =
  | { ok: true; filename: string; content: string; resumedFrom: number | null }
  | { ok: false; resumed: boolean; checkpoint: ExportCheckpoint }

export function exportRelayCsv(resume = false): RelayExportResult {
  const rows = listRows(RELAY_KEY)
  const previous = resume ? getExportCheckpoint() : null
  if (resume && !previous) {
    return {
      ok: false,
      resumed: false,
      checkpoint: {
        at: new Date().toISOString(),
        exportedIds: [],
        exportedLines: [],
        failedId: -1,
        failedMessage: '没有找到上次导出失败的进度，无法续导，请直接重新导出',
      },
    }
  }
  const exportedIds = previous?.exportedIds ?? []
  const exportedLines = previous?.exportedLines ?? []
  const pending = rows.filter((row) => !exportedIds.includes(Number(row.id)))
  const lines: string[] = [...exportedLines]
  const newLines: string[] = []
  for (const row of pending) {
    try {
      const line = buildLine(row)
      lines.push(line)
      newLines.push(line)
      exportedIds.push(Number(row.id))
    } catch (error) {
      const checkpoint: ExportCheckpoint = {
        at: new Date().toISOString(),
        exportedIds: [...exportedIds],
        exportedLines: lines,
        failedId: Number(row.id),
        failedMessage: error instanceof Error ? error.message : '该条数据无法导出',
      }
      saveCheckpoint(checkpoint)
      return { ok: false, resumed: resume, checkpoint }
    }
  }
  clearExportCheckpoint()
  const content = `\uFEFF${[EXPORT_HEADER, ...lines].join('\n')}`
  return {
    ok: true,
    filename: '保护校验-清单.csv',
    content,
    resumedFrom: previous ? newLines.length : null,
  }
}

export function discardExportCheckpoint(): void {
  clearExportCheckpoint()
}
