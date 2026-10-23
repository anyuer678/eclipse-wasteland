import { describe, it, expect } from 'vitest'
import { SAVE_KEYS, resetAllProgress } from '../src/growth/reset'
import type { RemovableStorage } from '../src/growth/reset'

const fakeStorage = (initial: Record<string, string>): RemovableStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

describe('growth/reset', () => {
  it('removes every game key and counts only existing ones', () => {
    const s = fakeStorage({ 'ss-rebuild-save-v1': '{}', 'ss-daily-v1': '{}', other: 'keep' })
    const removed = resetAllProgress(s)
    expect(removed).toBe(2)
    for (const k of SAVE_KEYS) expect(s.map.has(k)).toBe(false)
    expect(s.map.get('other')).toBe('keep')
  })

  it('is a no-op on empty storage', () => {
    const s = fakeStorage({})
    expect(resetAllProgress(s)).toBe(0)
  })
})
