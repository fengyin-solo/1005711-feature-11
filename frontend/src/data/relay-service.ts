/**
 * 保护校验（relaytest）专用业务服务：
 * - 登记时同一台装置去重，只留一条；
 * - 动作值/返回值超技术要求或非数值一律挡回保存，缺项不挡、照常列出；
 * - 判定不合格回写到保护装置台账的待校验清单；
 * - 导出按条核，失败条目可定位、可续导。
 */
import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import {
  checkRelayValues,
  rangeText,
  relayIssueText,
  type RelayCheckResult,
} from '@/data/relay-spec'
import type { ActionResult, EntryRow } from '@/data/types'

export const RELAY_KEY = 'relaytest'
export const DEVICE_KEY = 'protectiondevice'

const RELAY_FIELDS = [
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

export type RelayDraft = {
  装置编号: string
  装置名称: string
  校验项目: string
  动作值: string
  返回值: string
  校验人: string
  校验日期: string
}

export type RelayValidation = {
  ok: boolean
  itemError: string
  actionError: string
  retractError: string
  gaps: string[]
  message: string
}

function errorFor(result: RelayCheckResult, kind: 'action' | 'retract'): string {
  const badIssue = kind === 'action' ? 'bad-action' : 'bad-retract'
  const specIssue = kind === 'action' ? 'spec-action' : 'spec-retract'
  const label = kind === 'action' ? '动作值' : '返回值'
  const field = kind === 'action' ? result.action : result.retract
  if (result.issues.includes(badIssue)) {
    return `${label}「${field.text}」无法识别为数值，请录入数值（可带单位）`
  }
  if (result.issues.includes(specIssue) && result.spec) {
    const range = kind === 'action' ? result.spec.action : result.spec.retract
    return `${label}超出技术要求：${result.spec.item}允许范围 ${rangeText(range, result.spec.unit)}，当前 ${field.text}`
  }
  return ''
}

// 保存前校验：非数值、超技术要求、项目无技术依据 → 挡回；缺项只进 gaps，不挡保存。
export function validateRelayDraft(input: RelayDraft): RelayValidation {
  const itemError = input['校验项目'].trim() === '' ? '请选择校验项目' : ''
  const result = checkRelayValues(input)
  const actionError = errorFor(result, 'action')
  const retractError = errorFor(result, 'retract')
  if (!itemError && result.issues.includes('unknown-item')) {
    return {
      ok: false,
      itemError: `校验项目「${result.item}」未登记技术要求，无法核对`,
      actionError: '',
      retractError: '',
      gaps: [],
      message: `校验项目「${result.item}」未登记技术要求，无法核对`,
    }
  }
  const gaps: string[] = []
  if (result.action.missing) {
    gaps.push('动作值')
  }
  if (result.retract.missing) {
    gaps.push('返回值')
  }
  const errors = [itemError, actionError, retractError].filter(Boolean)
  return {
    ok: errors.length === 0,
    itemError,
    actionError,
    retractError,
    gaps,
    message: errors.join('；'),
  }
}

function nextRelayNo(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = String(row['校验编号'] ?? '').match(/RELA-\d{4}-(\d+)/)
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  const year = new Date().getFullYear()
  return `RELA-${year}-${String(max + 1).padStart(3, '0')}`
}

function findSameDevice(rows: EntryRow[], input: RelayDraft): EntryRow | undefined {
  const code = input['装置编号'].trim()
  const name = input['装置名称'].trim()
  return rows.find((row) => {
    const sameCode = code !== '' && String(row['装置编号'] ?? '').trim() === code
    const sameName = name !== '' && String(row['装置名称'] ?? '').trim() === name
    return sameCode || sameName
  })
}

// 登记（或同一台装置再次提交）：按装置编号优先、装置名称兜底去重，命中则更新原记录。
export function saveRelayEntry(input: RelayDraft): ActionResult & { id?: number } {
  const code = input['装置编号'].trim()
  if (code === '') {
    return { ok: false, message: '装置编号不能为空，需要与保护装置台账对应' }
  }
  const validation = validateRelayDraft(input)
  if (!validation.ok) {
    return { ok: false, message: validation.message }
  }

  const rows = listRows(RELAY_KEY)
  const existing = findSameDevice(rows, input)
  const now = new Date().toISOString().slice(0, 10)
  const base: EntryRow = existing
    ? { ...existing }
    : {
        id: rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1,
        status: '待校验',
        pending: true,
        abnormal: false,
      }
  base['校验编号'] = existing ? base['校验编号'] : nextRelayNo(rows)
  base['装置编号'] = code
  base['装置名称'] = input['装置名称'].trim()
  base['校验项目'] = input['校验项目'].trim()
  base['动作值'] = input['动作值'].trim()
  base['返回值'] = input['返回值'].trim()
  base['校验人'] = input['校验人'].trim()
  base['校验日期'] = input['校验日期'].trim() || now
  base['校验状态'] = '校验中'
  base.status = '校验中'
  base.pending = true
  // 缺项不标异常（照常列出待补）；这里校验已通过保存关口，理论上不会有超范围值。
  base.abnormal = checkRelayValues(base).abnormal

  const next = existing ? rows.map((row) => (row.id === existing.id ? base : row)) : [...rows, base]
  saveRows(RELAY_KEY, next)
  return {
    ok: true,
    id: Number(base.id),
    message: existing
      ? `装置「${code}」已有校验记录（${String(base['校验编号'])}），已按本次提交更新，只保留一条`
      : `校验记录 ${String(base['校验编号'])} 已登记${
          validation.gaps.length ? `，${validation.gaps.join('、')}暂缺，已标出待补` : ''
        }`,
  }
}

// 列表格内 / 详情面板共用：动作值、返回值就地保存，沿用同一校验口径。
export function updateRelayValues(
  id: number,
  patch: { 动作值: string; 返回值: string },
): ActionResult {
  const rows = listRows(RELAY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的校验记录` }
  }
  const current = rows[index]
  const result = checkRelayValues({
    校验项目: current['校验项目'],
    动作值: patch['动作值'],
    返回值: patch['返回值'],
  })
  const errors = [errorFor(result, 'action'), errorFor(result, 'retract')].filter(Boolean)
  if (errors.length > 0) {
    return { ok: false, message: errors.join('；') }
  }
  const updated: EntryRow = {
    ...current,
    动作值: patch['动作值'].trim(),
    返回值: patch['返回值'].trim(),
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(RELAY_KEY, next)
  return {
    ok: true,
    message:
      result.missing
        ? `已保存，${result.action.missing ? '动作值' : '返回值'}仍空缺，请补录后再判定`
        : '动作值、返回值已保存',
  }
}

export function submitRelay(id: number): ActionResult {
  const rows = listRows(RELAY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的校验记录` }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: '校验中',
    pending: true,
    abnormal: checkRelayValues(rows[index]).abnormal,
  }
  updated['校验状态'] = '校验中'
  const next = [...rows]
  next[index] = updated
  saveRows(RELAY_KEY, next)
  return { ok: true, message: '校验记录已提交，当前状态「校验中」' }
}

// 判定结论回写：不合格的装置进保护装置台账的待校验清单。
function writeBackToDeviceLedger(row: EntryRow): string {
  const code = String(row['装置编号'] ?? '').trim()
  const devices = listRows(DEVICE_KEY)
  const index = devices.findIndex((device) => String(device['装置编号'] ?? '').trim() === code)
  if (index < 0) {
    return `；台账中未找到装置 ${code}，请先在保护装置台账登记`
  }
  const device = devices[index]
  const updated: EntryRow = {
    ...device,
    status: '待校验',
    pending: true,
    abnormal: Boolean(device.abnormal),
  }
  updated['装置状态'] = '待校验'
  const next = [...devices]
  next[index] = updated
  saveRows(DEVICE_KEY, next)
  return `；装置 ${code} 已回写为「待校验」，进入待校验清单`
}

export function setRelayVerdict(id: number, verdict: '合格' | '不合格'): ActionResult {
  const rows = listRows(RELAY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的校验记录` }
  }
  const current = rows[index]
  const result = checkRelayValues(current)
  const gaps: string[] = []
  if (result.action.missing) {
    gaps.push('动作值')
  }
  if (result.retract.missing) {
    gaps.push('返回值')
  }
  if (gaps.length > 0) {
    return { ok: false, message: `${gaps.join('、')}空缺，请补齐缺的格后再判定` }
  }
  if (verdict === '合格' && result.abnormal) {
    return {
      ok: false,
      message: `不能判定合格：${result.issues.map(relayIssueText).join('、')}，请修正后重录`,
    }
  }

  const status = verdict === '合格' ? '校验合格' : '校验不合格'
  const updated: EntryRow = {
    ...current,
    status,
    pending: false,
    abnormal: verdict === '不合格' ? result.abnormal : false,
  }
  updated['校验状态'] = status
  const next = [...rows]
  next[index] = updated
  saveRows(RELAY_KEY, next)

  const note = verdict === '不合格' ? writeBackToDeviceLedger(updated) : ''
  return { ok: true, message: `已判定${verdict}，当前状态「${status}」${note}` }
}

export type RelayExportFailure = {
  id: number
  code: string
  item: string
  reasons: string[]
}

// 导出前按条核：返回失败条目及具体原因（含缺在哪一格），成功条目才进导出文件。
export function inspectRelayExport(filters: Record<string, string> = {}): {
  rows: EntryRow[]
  failures: RelayExportFailure[]
} {
  const rows = filterRows(listRows(RELAY_KEY), filters)
  const failures: RelayExportFailure[] = []
  for (const row of rows) {
    const result = checkRelayValues(row)
    if (result.issues.length > 0) {
      failures.push({
        id: Number(row.id),
        code: String(row['校验编号'] ?? row.id),
        item: result.item,
        reasons: result.issues.map(relayIssueText),
      })
    }
  }
  return { rows, failures }
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

// 生成导出文件：已通过条目正常导出；被跳过的失败条目在文末列明编号与原因，拿到文件就知道缺哪格。
export function buildRelayExport(
  rows: EntryRow[],
  skipped: RelayExportFailure[],
): { filename: string; content: string } {
  const header = ['编号', ...RELAY_FIELDS, '当前状态']
  const passedIds = new Set(rows.map((row) => Number(row.id)))
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [row.id, ...RELAY_FIELDS.map((field) => row[field] ?? ''), row.status]
        .map(csvCell)
        .join(','),
    )
  }
  if (skipped.length > 0) {
    lines.push('')
    lines.push([`未导出条目（${skipped.length} 条，修正后可从该条续导）`].map(csvCell).join(','))
    lines.push(['编号', '校验编号', '校验项目', '未通过原因'].map(csvCell).join(','))
    for (const failure of skipped) {
      lines.push(
        [failure.id, failure.code, failure.item, failure.reasons.join('、')].map(csvCell).join(','),
      )
    }
  }
  return {
    filename: `保护校验-清单-${new Date().toISOString().slice(0, 10)}.csv`,
    content: `﻿${lines.join('\n')}`,
  }
}

export { RELAY_FIELDS }
