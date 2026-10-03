import {
  buildRelayExport,
  inspectRelayExport,
  saveRelayEntry,
  setRelayVerdict,
  submitRelay,
  updateRelayValues,
} from '../src/data/relay-service'
import { checkRelayValues, parseRelayNumber } from '../src/data/relay-spec'
import { listRows } from '../src/data/local-store'

let passed = 0
let failed = 0
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL: ${name} ${detail}`)
  }
}

// 1. 数值解析
assert('parse 6.00A', parseRelayNumber('6.00A') === 6)
assert('parse 5.10 A', parseRelayNumber('5.10 A') === 5.1)
assert('parse 120V', parseRelayNumber('120V') === 120)
assert('parse abc null', parseRelayNumber('abc') === null)
assert('parse 12A text keeps numeric only', parseRelayNumber('12A') === 12)
assert('parse 保护校验样例 null', parseRelayNumber('保护校验样例1') === null)

// 2. 缺值照常识别、缺格明确
const missingOne = checkRelayValues({ 校验项目: '过流Ⅱ段', 动作值: '4.00A', 返回值: '' })
assert('missing retract flagged', missingOne.issues.includes('missing-retract'))
assert('missing not abnormal', missingOne.abnormal === false)
assert('missing reported', missingOne.missing === true)

const missingBoth = checkRelayValues({ 校验项目: '过流速断', 动作值: '', 返回值: '' })
assert('missing both', missingBoth.issues.includes('missing-action') && missingBoth.issues.includes('missing-retract'))

// 3. 超技术要求算异常
const over = checkRelayValues({ 校验项目: '低电压保护', 动作值: '55V', 返回值: '70V' })
assert('over spec action', over.issues.includes('spec-action'))
assert('over spec abnormal', over.abnormal === true)

// 4. 非数值算异常
const badNum = checkRelayValues({ 校验项目: '过流Ⅰ段', 动作值: 'abc', 返回值: '5.00A' })
assert('bad number abnormal', badNum.abnormal === true && badNum.issues.includes('bad-action'))

// 5. 正常值无问题
const good = checkRelayValues({ 校验项目: '零序过流', 动作值: '1.20A', 返回值: '1.05A' })
assert('good row clean', good.issues.length === 0 && !good.abnormal && !good.missing)

// 6. 种子数据包含缺值、异常条目且照常列出
const seeded = listRows('relaytest')
assert('seed has 5 rows', seeded.length === 5, `got ${seeded.length}`)
assert('seed row2 missing retract', checkRelayValues(seeded[1]).missing === true)
assert('seed row4 abnormal', checkRelayValues(seeded[3]).abnormal === true)
assert('rows with missing values still listed', seeded.length === 5)

// 7. 登记：超技术要求被挡回
const blocked = saveRelayEntry({
  装置编号: 'PROT-9999',
  装置名称: '测试装置',
  校验项目: '过流Ⅰ段',
  动作值: '100A',
  返回值: '90A',
  校验人: '张三',
  校验日期: '2026-10-01',
})
assert('out-of-spec save blocked', blocked.ok === false, blocked.message)

// 8. 登记：缺值不挡，照常保存
const withGap = saveRelayEntry({
  装置编号: 'PROT-9998',
  装置名称: '缺值装置',
  校验项目: '过流Ⅰ段',
  动作值: '6.00A',
  返回值: '',
  校验人: '张三',
  校验日期: '2026-10-01',
})
assert('gap save allowed', withGap.ok === true, withGap.message)
assert('gap save id', typeof withGap.id === 'number')

// 9. 同一台装置重复提交只留一条（装置编号相同 → 更新）
const dup = saveRelayEntry({
  装置编号: 'PROT-9998',
  装置名称: '缺值装置-改名',
  校验项目: '过流Ⅰ段',
  动作值: '6.20A',
  返回值: '5.30A',
  校验人: '李四',
  校验日期: '2026-10-02',
})
assert('duplicate update ok', dup.ok === true, dup.message)
const dupRows = listRows('relaytest').filter((r) => String(r['装置编号']) === 'PROT-9998')
assert('duplicate leaves one row', dupRows.length === 1)
assert('duplicate updated value', String(dupRows[0]['动作值']) === '6.20A')

// 同装置名称也判重
const dupByName = saveRelayEntry({
  装置编号: 'PROT-7777',
  装置名称: '缺值装置-改名',
  校验项目: '过流Ⅱ段',
  动作值: '4.00A',
  返回值: '3.50A',
  校验人: '王五',
  校验日期: '',
})
assert('duplicate by name merges', dupByName.ok === true && dupByName.id === dup.id)

// 10. 缺值不能判定
const gapRow = listRows('relaytest').find((r) => String(r['装置编号']) === 'PROT-0002')
assert('gap row exists', Boolean(gapRow))
if (gapRow) {
  const verdictPass = setRelayVerdict(Number(gapRow.id), '合格')
  assert('verdict blocked when gap', verdictPass.ok === false, verdictPass.message)
}

// 11. 缺值补录后可判定
if (gapRow) {
  const fixed = updateRelayValues(Number(gapRow.id), { 动作值: '4.00A', 返回值: '3.50A' })
  assert('gap fill save ok', fixed.ok === true, fixed.message)
  const verdictPass = setRelayVerdict(Number(gapRow.id), '合格')
  assert('verdict pass after fill', verdictPass.ok === true, verdictPass.message)
}

// 12. 判定不合格回写保护装置台账待校验清单
const failSeed = listRows('relaytest').find((r) => String(r['装置编号']) === 'PROT-0005')
assert('fail seed exists', Boolean(failSeed))
if (failSeed) {
  const verdictFail = setRelayVerdict(Number(failSeed.id), '不合格')
  assert('verdict fail ok', verdictFail.ok === true, verdictFail.message)
  assert(
    'writeback mentioned',
    verdictFail.message.includes('待校验'),
    verdictFail.message,
  )
  const device = listRows('protectiondevice').find((d) => String(d['装置编号']) === 'PROT-0005')
  assert('device ledger updated to pending', Boolean(device) && String(device!.status) === '待校验')
}

// 13. 合格判定挡异常值
const abnormalRow = listRows('relaytest').find((r) => String(r['装置编号']) === 'PROT-0004')
if (abnormalRow) {
  const r = setRelayVerdict(Number(abnormalRow.id), '合格')
  assert('abnormal cannot pass', r.ok === false, r.message)
}

// 14. 超技术要求就地保存被挡
if (abnormalRow) {
  const r = updateRelayValues(Number(abnormalRow.id), { 动作值: '55V', 返回值: '70V' })
  assert('inline abnormal blocked', r.ok === false, r.message)
  const r2 = updateRelayValues(Number(abnormalRow.id), { 动作值: '70V', 返回值: '72V' })
  assert('inline valid saved', r2.ok === true, r2.message)
}

// 15. 导出检查：失败条目含具体格信息
const inspected = inspectRelayExport({})
assert('inspect returns all rows', inspected.rows.length === listRows('relaytest').length)
const failRow4 = inspected.failures.find((f) => f.id === 4)
// row4 已被上面修正为 70/72（合格范围），确认 failures 不再包含修正后的异常原因
const stillFail = inspected.failures.map((f) => f.id)
assert('fixed row leaves failure list', !stillFail.includes(4))
const missingRowFail = inspected.failures.find((f) => f.id === 3)
assert('row3 failure reported', Boolean(missingRowFail))
assert(
  'row3 says both cells missing',
  Boolean(missingRowFail) && missingRowFail!.reasons.join('、').includes('动作值') && missingRowFail!.reasons.join('、').includes('返回值'),
  JSON.stringify(missingRowFail),
)

// 16. 导出文件包含未导出条目说明
const passedRows = inspected.rows.filter((r) => !inspected.failures.some((f) => f.id === Number(r.id)))
const { filename, content } = buildRelayExport(passedRows, inspected.failures)
assert('csv filename', filename.includes('保护校验'))
assert('csv has failure appendix', content.includes('未导出条目'))
assert('csv names missing cell', content.includes('动作值空缺') || content.includes('返回值空缺'))

// 17. 提交校验动作
const someRow = listRows('relaytest')[0]
const submitResult = submitRelay(Number(someRow.id))
assert('submit ok', submitResult.ok === true)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
