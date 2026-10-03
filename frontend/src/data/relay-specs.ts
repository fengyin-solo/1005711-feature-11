// 校验项目的技术要求：动作值、返回值各自的允许区间，列表标记与详情/登记保存都按这一份口径核。
export type ValueBand = {
  min: number
  max: number
  unit: string
}

export type ItemSpec = {
  item: string
  action: ValueBand
  return: ValueBand
  // 技术要求原文，详情面板直接展示给校验人。
  requirement: string
}

export const RELAY_ITEM_SPECS: ItemSpec[] = [
  {
    item: '过电流保护',
    action: { min: 4.5, max: 5.5, unit: 'A' },
    return: { min: 3.83, max: 5.23, unit: 'A' },
    requirement: '动作电流 4.50～5.50 A；返回系数 0.85～0.95（返回值 3.83～5.23 A）。',
  },
  {
    item: '电流速断保护',
    action: { min: 28.0, max: 32.0, unit: 'A' },
    return: { min: 23.8, max: 30.4, unit: 'A' },
    requirement: '动作电流 28.0～32.0 A；返回系数 0.85～0.95（返回值 23.80～30.40 A）。',
  },
  {
    item: '差动保护',
    action: { min: 1.8, max: 2.2, unit: 'A' },
    return: { min: 1.44, max: 2.09, unit: 'A' },
    requirement: '差动启动电流 1.80～2.20 A；返回系数 0.80～0.95（返回值 1.44～2.09 A）。',
  },
  {
    item: '零序过流保护',
    action: { min: 0.9, max: 1.1, unit: 'A' },
    return: { min: 0.77, max: 1.05, unit: 'A' },
    requirement: '零序动作电流 0.90～1.10 A；返回系数 0.85～0.95（返回值 0.77～1.05 A）。',
  },
  {
    item: '过电压保护',
    action: { min: 95.0, max: 105.0, unit: 'V' },
    return: { min: 85.5, max: 102.9, unit: 'V' },
    requirement: '动作电压 95.0～105.0 V；返回系数 0.90～0.98（返回值 85.5～102.9 V）。',
  },
]

export const SPEC_BY_ITEM: Map<string, ItemSpec> = new Map(
  RELAY_ITEM_SPECS.map((spec) => [spec.item, spec]),
)

export function formatBand(band: ValueBand): string {
  return `${band.min}～${band.max} ${band.unit}`
}

type ParsedCell =
  | { kind: 'empty' }
  | { kind: 'bad'; raw: string }
  | { kind: 'ok'; value: number; raw: string }

// 允许录入 "5.02A"、"5.02 A"、"100V" 这类带单位写法；空字符串按缺格处理；其余按无法识别处理。
export function parseNumericCell(raw: unknown): ParsedCell {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return { kind: 'empty' }
  }
  const normalized = text.replace(/\s+/g, '').replace(/(A|V|安|伏)$/i, '')
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) {
    return { kind: 'bad', raw: text }
  }
  return { kind: 'ok', value: Number(normalized), raw: text }
}

export type CellVerdict =
  | { status: 'empty'; label: string; message: string }
  | { status: 'ok'; label: string }
  | { status: 'bad'; label: string; raw: string; message: string }
  | { status: 'out'; label: string; raw: string; value: number; band: ValueBand; message: string }

function judgeCell(label: string, raw: unknown, band: ValueBand | undefined): CellVerdict {
  const parsed = parseNumericCell(raw)
  if (parsed.kind === 'empty') {
    return { status: 'empty', label, message: `缺${label}` }
  }
  if (!band) {
    return {
      status: 'bad',
      label,
      raw: parsed.kind === 'bad' ? parsed.raw : parsed.raw,
      message: `该项目未配置技术要求，${label}「${parsed.raw}」无法核查`,
    }
  }
  if (parsed.kind === 'bad') {
    return {
      status: 'bad',
      label,
      raw: parsed.raw,
      message: `${label}「${parsed.raw}」无法识别为数值，应在 ${formatBand(band)} 范围内`,
    }
  }
  if (parsed.value < band.min || parsed.value > band.max) {
    return {
      status: 'out',
      label,
      raw: parsed.raw,
      value: parsed.value,
      band,
      message: `${label} ${parsed.raw} 超出技术要求（${formatBand(band)}）`,
    }
  }
  return { status: 'ok', label }
}

export type RelayRowEvaluation = {
  spec: ItemSpec | undefined
  action: CellVerdict
  ret: CellVerdict
  // 缺了哪几格，如 ["返回值"]。
  missing: string[]
  // 无法识别或超技术要求，需要挡回保存/判不合格的硬性问题。
  abnormal: boolean
  // 保存、判定合格等动作前给出的拦截原因。
  blockers: string[]
  // 列表与导出里展示的核查备注。
  notes: string[]
}

export function evaluateRelayRow(row: Record<string, unknown>): RelayRowEvaluation {
  const spec = SPEC_BY_ITEM.get(String(row.校验项目 ?? ''))
  const action = judgeCell('动作值', row.动作值, spec?.action)
  const ret = judgeCell('返回值', row.返回值, spec?.return)
  const verdicts = [action, ret]
  const missing = verdicts.filter((v) => v.status === 'empty').map((v) => v.label)
  const blockers: string[] = []
  const notes: string[] = []
  for (const verdict of verdicts) {
    if (verdict.status === 'bad' || verdict.status === 'out') {
      blockers.push(verdict.message)
      notes.push(`${verdict.label}异常：${verdict.message}`)
    } else if (verdict.status === 'empty') {
      notes.push(verdict.message)
    }
  }
  if (!spec) {
    const message = `校验项目「${String(row.校验项目 ?? '')}」未配置技术要求，无法核查`
    blockers.push(message)
    notes.push(message)
  }
  return {
    spec,
    action,
    ret,
    missing,
    abnormal: blockers.length > 0,
    blockers,
    notes,
  }
}
