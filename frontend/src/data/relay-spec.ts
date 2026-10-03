/**
 * 保护校验（relaytest）专用口径：
 * 动作值、返回值按校验项目的技术要求核；列表就地编辑与详情面板共用这一份，口径不分裂。
 */

// 单项校验项目的技术要求：动作值、返回值各自允许的数值区间（含端点），单位用于提示。
export type RelayItemSpec = {
  item: string
  unit: string
  action: { min: number; max: number }
  retract: { min: number; max: number }
}

// 校验项目的技术要求，口径与《继电保护和电网安全自动装置检验规程》中常见整定范围对齐。
export const RELAY_ITEM_SPECS: RelayItemSpec[] = [
  {
    item: '过流Ⅰ段',
    unit: 'A',
    action: { min: 4, max: 8 },
    retract: { min: 3.4, max: 7.6 },
  },
  {
    item: '过流Ⅱ段',
    unit: 'A',
    action: { min: 2, max: 6 },
    retract: { min: 1.7, max: 5.7 },
  },
  {
    item: '过流速断',
    unit: 'A',
    action: { min: 10, max: 20 },
    retract: { min: 8.5, max: 19 },
  },
  {
    item: '零序过流',
    unit: 'A',
    action: { min: 0.5, max: 3 },
    retract: { min: 0.4, max: 2.85 },
  },
  {
    item: '低电压保护',
    unit: 'V',
    action: { min: 60, max: 80 },
    retract: { min: 65, max: 88 },
  },
  {
    item: '过电压保护',
    unit: 'V',
    action: { min: 110, max: 130 },
    retract: { min: 95, max: 124 },
  },
]

export const RELAY_SPEC_ITEMS = RELAY_ITEM_SPECS.map((spec) => spec.item)

export function findRelaySpec(item: string): RelayItemSpec | undefined {
  const trimmed = item.trim()
  return RELAY_ITEM_SPECS.find((spec) => spec.item === trimmed)
}

export type RelayValueIssue =
  | 'missing-action'
  | 'missing-retract'
  | 'bad-action'
  | 'bad-retract'
  | 'spec-action'
  | 'spec-retract'
  | 'unknown-item'

export type RelayFieldResult = {
  text: string
  missing: boolean
  invalid: boolean
  value: number | null
}

const ISSUE_TEXT: Record<RelayValueIssue, string> = {
  'missing-action': '动作值空缺',
  'missing-retract': '返回值空缺',
  'bad-action': '动作值无法识别为数值',
  'bad-retract': '返回值无法识别为数值',
  'spec-action': '动作值超出技术要求',
  'spec-retract': '返回值超出技术要求',
  'unknown-item': '校验项目未登记技术要求',
}

// 格内空判定沿用列表口径：null、undefined、去掉空白后为空串都算空。
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

// 录入口径放得宽：数字前后允许带工程单位（A、V、kA、kV…），但去掉单位后必须是数值。
const UNIT_SUFFIX = /\s*(?:kA|KA|kV|KV|m[AV]|A|V)$/u
export function parseRelayNumber(raw: string): number | null {
  const text = raw.trim().replace(UNIT_SUFFIX, '').trim()
  const matched = text.match(/^-?\d+(\.\d+)?$/)
  if (!matched) {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function readRelayField(value: unknown): RelayFieldResult {
  const text = fieldText(value)
  if (text === '') {
    return { text, missing: true, invalid: false, value: null }
  }
  const parsed = parseRelayNumber(text)
  if (parsed === null) {
    return { text, missing: false, invalid: true, value: null }
  }
  return { text, missing: false, invalid: false, value: parsed }
}

export type RelayCheckResult = {
  item: string
  spec: RelayItemSpec | undefined
  action: RelayFieldResult
  retract: RelayFieldResult
  // 缺口按「动作值 / 返回值」两格分别报，导出与列表都能直接指出缺在哪一格。
  issues: RelayValueIssue[]
  missing: boolean
  abnormal: boolean
}

export type RelayValueInput = Record<string, unknown>

function inRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max
}

// 统一校验口径：缺项只登记缺口（照常列出、导出时拦下并指明格子）；
// 无法识别的数值、超出技术要求区间才算异常，保存时挡回。
export function checkRelayValues(row: RelayValueInput): RelayCheckResult {
  const item = fieldText(row['校验项目'])
  const spec = findRelaySpec(item)
  const action = readRelayField(row['动作值'])
  const retract = readRelayField(row['返回值'])
  const issues: RelayValueIssue[] = []

  if (!spec) {
    issues.push('unknown-item')
  }
  if (action.missing) {
    issues.push('missing-action')
  } else if (action.invalid) {
    issues.push('bad-action')
  } else if (spec && action.value !== null && !inRange(action.value, spec.action)) {
    issues.push('spec-action')
  }
  if (retract.missing) {
    issues.push('missing-retract')
  } else if (retract.invalid) {
    issues.push('bad-retract')
  } else if (spec && retract.value !== null && !inRange(retract.value, spec.retract)) {
    issues.push('spec-retract')
  }

  const blocking = new Set<RelayValueIssue>([
    'unknown-item',
    'bad-action',
    'bad-retract',
    'spec-action',
    'spec-retract',
  ])
  return {
    item,
    spec,
    action,
    retract,
    issues,
    missing: action.missing || retract.missing,
    abnormal: issues.some((issue) => blocking.has(issue)),
  }
}

export function relayIssueText(issue: RelayValueIssue): string {
  return ISSUE_TEXT[issue]
}

// 列表格内与详情面板共用的短语提示。
export function relayIssueSummary(result: RelayCheckResult): string {
  return result.issues.map(relayIssueText).join('、')
}

export function rangeText(range: { min: number; max: number }, unit: string): string {
  return `${range.min}${unit} ~ ${range.max}${unit}`
}
