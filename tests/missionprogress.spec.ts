import { describe, it, expect } from 'vitest'
import { MISSION_CLEARS_KEY, loadMissionClears, recordMissionClear, sanitizeClears } from '../src/campaign/missionProgress'
import type { ClearStorage } from '../src/campaign/missionProgress'

const fakeStorage = (initial: Record<string, string> = {}): ClearStorage => {
  const map = new Map<string, string>(Object.entries(initial))
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

describe('campaign/missionProgress', () => {
  it('sanitizes garbage counts', () => {
    expect(sanitizeClears({ a: 2, b: -1, c: 'x', d: 1.9 })).toEqual({ a: 2, d: 1 })
    expect(sanitizeClears(null)).toEqual({})
  })

  it('records and accumulates per-mission clears', () => {
    const s = fakeStorage()
    expect(recordMissionClear('m1-facility', s)).toBe(1)
    expect(recordMissionClear('m1-facility', s)).toBe(2)
    expect(recordMissionClear('m2-quarry', s)).toBe(1)
    const clears = loadMissionClears(s)
    expect(clears['m1-facility']).toBe(2)
    expect(clears['m2-quarry']).toBe(1)
  })

  it('ignores a corrupt stored payload', () => {
    const s = fakeStorage({ [MISSION_CLEARS_KEY]: 'not-json' })
    expect(loadMissionClears(s)).toEqual({})
    expect(recordMissionClear('m1-facility', s)).toBe(1)
  })
})
