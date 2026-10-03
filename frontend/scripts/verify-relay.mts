// 用本地内存版 localStorage 端到端验证保护校验数据层行为。
import { createLocalStorage } from './local-storage-shim.ts'

globalThis.window = { localStorage: createLocalStorage() }
globalThis.Blob = class Blob {}

await import('../src/data/local-store.ts')
const relay = await import('../src/api/relay-service.ts')
const store = await import('../src/data/local-store.ts')
const specs = await import('../src/data/relay-specs.ts')

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log('PASS', name)
  } else {
    fail += 1
    console.error('FAIL', name, extra)
  }
}

// 0. 种子数据：三条都在；id=3 缺返回值；id=2 动作值超技术要求
let rows = store.listRows('relaytest')
check('种子三条全列出（缺返回值也在列表）', rows.length === 3, `实际 ${rows.length}`)
const seedMissing = specs.evaluateRelayRow(rows[2])
check('缺格标明缺返回值', seedMissing.missing.join() === '返回值', JSON.stringify(seedMissing.missing))
const seedAbnormal = specs.evaluateRelayRow(rows[1])
check('超技术要求动作值判异常', seedAbnormal.abnormal && seedAbnormal.action.status === 'out')
check('返回值 30.0 在 23.8~30.4 区间内不异常', seedAbnormal.ret.status === 'ok')

// 1. 缺一项允许登记
let r = relay.saveRelayEntry({
  装置编号: 'PROT-0009',
  装置名称: '测试装置',
  校验项目: '过电流保护',
  动作值: '5.0A',
  返回值: '',
  校验人: '测试',
  校验日期: '2026-10-03',
})
check('缺返回值允许登记', r.ok && r.missing.join() === '返回值', r.message)
check('登记后共 4 条', store.listRows('relaytest').length === 4)

// 2. 超技术要求挡回保存
r = relay.saveRelayEntry({
  装置编号: 'PROT-0010',
  装置名称: '超差装置',
  校验项目: '过电流保护',
  动作值: '9.0A',
  返回值: '4.5A',
  校验人: '测试',
  校验日期: '2026-10-03',
})
check('动作值超技术要求挡回', !r.ok && r.message.includes('超出技术要求'), r.message)

// 3. 无法识别挡回
r = relay.saveRelayEntry({
  装置编号: 'PROT-0011',
  装置名称: '乱填装置',
  校验项目: '过电流保护',
  动作值: 'abc',
  返回值: '4.5A',
  校验人: '测试',
  校验日期: '2026-10-03',
})
check('非数值动作值挡回', !r.ok && r.message.includes('无法识别'), r.message)

// 4. 缺格挡提交、挡判合格
const missingId = Number(store.listRows('relaytest').find((x) => x.装置编号 === 'PROT-0009').id)
r = relay.runRelayAction(missingId, '提交校验')
check('缺返回值不能提交校验', !r.ok && r.message.includes('缺返回值'), r.message)
r = relay.runRelayAction(missingId, '判定合格')
check('缺返回值不能判合格', !r.ok && r.message.includes('缺返回值'), r.message)

// 详情补齐后再提交，沿用同一口径
r = relay.updateRelayEntry(missingId, {
  校验项目: '过电流保护',
  动作值: '5.0A',
  返回值: '4.45A',
  校验人: '测试',
  校验日期: '2026-10-03',
})
check('详情补齐保存成功', r.ok, r.message)
r = relay.runRelayAction(missingId, '提交校验')
check('补齐后可提交校验', r.ok, r.message)

// 5. 同一台装置重复提交只留一条
const before = store.listRows('relaytest').length
r = relay.saveRelayEntry({
  装置编号: 'PROT-0009',
  装置名称: '测试装置改名',
  校验项目: '差动保护',
  动作值: '2.0A',
  返回值: '1.7A',
  校验人: '测试2',
  校验日期: '2026-10-03',
})
check('重复装置返回去重标记', r.ok && r.deduped === true, r.message)
check('去重后条数不增加', store.listRows('relaytest').length === before, `before=${before} now=${store.listRows('relaytest').length}`)
const dup = store.listRows('relaytest').filter((x) => x.装置编号 === 'PROT-0009')
check('同装置只剩一条且已更新', dup.length === 1 && dup[0].校验项目 === '差动保护' && String(dup[0].status) === '待校验')

// 6. 判定不合格回写台账（种子 PROT-0001 是待校验，先置为运行正常再验）
const devices = store.listRows('protectiondevice')
store.saveRows('protectiondevice', devices.map((d) => d.装置编号 === 'PROT-0001' ? { ...d, status: '运行正常' } : d))
r = relay.runRelayAction(1, '标记不合格')
check('判不合格成功', r.ok, r.message)
check('结论回写待校验清单', r.writtenBack === true)
const back = store.listRows('protectiondevice').find((d) => d.装置编号 === 'PROT-0001')
check('台账装置回到待校验', String(back.status) === '待校验' && back.pending === true, String(back.status))
// 未知装置不回写但校验记录仍判定成功
const orphanId = Number(store.listRows('relaytest').find((x) => x.装置编号 === 'PROT-0009').id)
r = relay.runRelayAction(orphanId, '标记不合格')
check('台账无对应装置时明确提示未回写', r.ok && r.writtenBack === false, r.message)

// 7. 导出：首次在超差条目（id=2）失败，记录断点
relay.discardExportCheckpoint()
let ex = relay.exportRelayCsv(false)
check('导出在异常条目中断', !ex.ok && ex.checkpoint.failedId === 2, JSON.stringify(ex))
check('断点已记录已导出 1 条', ex.checkpoint.exportedIds.join() === '1')

// 修好 id=2（详情保存口径），续导：从 id=2 接着走
r = relay.updateRelayEntry(2, {
  校验项目: '电流速断保护',
  动作值: '30.0A',
  返回值: '27.0A',
  校验人: '王工',
  校验日期: '2026-09-02',
})
check('修正异常条目成功', r.ok, r.message)
ex = relay.exportRelayCsv(true)
check('续导成功生成文件', ex.ok, JSON.stringify(ex).slice(0, 200))
const lines = ex.ok ? ex.content.split('\n') : []
check('续导包含表头+全部 4 条', ex.ok && lines.length === 5, `行数 ${lines.length}`)
const missingLine = lines.find((l) => l.startsWith('3,'))
check('缺格行导出标明缺返回值', Boolean(missingLine && missingLine.includes('缺返回值')), missingLine)
check('成功后断点清除', relay.getExportCheckpoint() === null)

// 8. 空态：零条记录导出被页面层拦截（服务层导出仅表头），getExportCheckpoint 不报错
store.saveRows('relaytest', [])
check('清空后列表为空', store.listRows('relaytest').length === 0)
ex = relay.exportRelayCsv(false)
check('空数据导出不报错（仅表头）', ex.ok && ex.content.split('\n').length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
