// Node 冒烟测试入口：先垫一个 window/localStorage，再加载数据层。
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

;(globalThis as unknown as { window: unknown }).window = {
  localStorage: new MemoryStorage(),
}

await import('./smoke-relay.ts')
