export function createLocalStorage() {
  const map = new Map()
  return {
    getItem(key) {
      return map.has(String(key)) ? map.get(String(key)) : null
    },
    setItem(key, value) {
      map.set(String(key), String(value))
    },
    removeItem(key) {
      map.delete(String(key))
    },
    clear() {
      map.clear()
    },
  }
}
