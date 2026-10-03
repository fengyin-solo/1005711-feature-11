import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}
;(globalThis as unknown as { window: unknown }).window = { localStorage: new MemoryStorage() }

const vite = await createServer({
  server: { middlewareMode: true },
  logLevel: 'error',
  appType: 'custom',
})

async function load(path: string) {
  return (await vite.ssrLoadModule(path)).default
}

const Relaytest = await load('/src/views/relaytest/index.vue')
const RelayList = await load('/src/views/relaytest/RelayList.vue')
const RelayFormModal = await load('/src/views/relaytest/RelayFormModal.vue')
const RelayDetailDrawer = await load('/src/views/relaytest/RelayDetailDrawer.vue')
const RelayExportModal = await load('/src/views/relaytest/RelayExportModal.vue')
const { listRows } = await vite.ssrLoadModule('/src/data/local-store.ts')

async function render(component: unknown, props: Record<string, unknown> = {}) {
  const app = createSSRApp(component, props)
  return renderToString(app)
}

let ok = 0
function check(name: string, cond: boolean) {
  if (cond) {
    ok += 1
    console.log(`ok: ${name}`)
  } else {
    console.error(`FAIL: ${name}`)
    process.exitCode = 1
  }
}

const mainHtml = await render(Relaytest)
check('main page renders title', mainHtml.includes('保护校验管理'))
check('main page has export button', mainHtml.includes('导出保护校验清单'))
check('main page empty state before mount', mainHtml.includes('暂无任何保护校验记录'))

const seedRows = listRows('relaytest')
const listHtml = await render(RelayList, {
  rows: seedRows,
  columns: ['校验编号', '装置编号', '装置名称', '校验项目', '动作值', '返回值', '校验人', '校验日期', '校验状态'],
  canEdit: true,
  processingId: null,
  emptyTitle: 'x',
  emptyTip: 'y',
  showReset: false,
})
check('list renders rows', listHtml.includes('RELA-2026-002'))
check('list marks missing retract cell', listHtml.includes('缺返回值'))
check('list marks both missing row', listHtml.includes('缺动作值'))
check('list shows over-spec tag', listHtml.includes('超技术要求'))
check('list has detail action', listHtml.includes('详情'))
check('list shows device code column', listHtml.includes('PROT-0001'))

const formHtml = await render(RelayFormModal)
check('form has device select', formHtml.includes('请选择保护装置'))
check('form has item options', formHtml.includes('过流Ⅰ段') && formHtml.includes('低电压保护'))

const drawerHtml = await render(RelayDetailDrawer, { row: seedRows[1] })
check('drawer shows spec ranges', drawerHtml.includes('允许范围'))
check('drawer shows missing warn', drawerHtml.includes('空缺'))

const exportHtml = await render(RelayExportModal, { filters: {} })
check('export modal renders', exportHtml.includes('开始导出'))
check('export modal shows rows', exportHtml.includes('RELA-2026'))

await vite.close()
console.log(`\n${ok} render checks done`)
