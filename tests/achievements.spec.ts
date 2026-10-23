import { describe, it, expect } from 'vitest'
import { ACHIEVEMENTS, addProgress } from '../src/growth/achievements'
import type { AchievementState } from '../src/growth/achievements'

const fresh = (): AchievementState => ({
  counters: { kills: 0, clears: 0, upgrades: 0, ascensions: 0, autoPicks: 0, autoClears: 0 },
  claimed: [],
})

describe('growth/achievements — 自动选择', () => {
  it('has unique achievement ids and the two auto-pick goals', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ACHIEVEMENTS.some((a) => a.cond === 'autoPicks')).toBe(true)
    expect(ACHIEVEMENTS.some((a) => a.cond === 'autoClears')).toBe(true)
  })

  it('unlocks 流派大师 after 60 auto picks', () => {
    const state = fresh()
    const first = addProgress(state, 'autoPicks', 59)
    expect(first.find((a) => a.id === 'p2')).toBeUndefined()
    const second = addProgress(state, 'autoPicks', 1)
    expect(second.map((a) => a.id)).toContain('p2')
    expect(state.counters.autoPicks).toBe(60)
  })

  it('unlocks 自动指挥官 after 5 auto clears', () => {
    const state = fresh()
    const newly = addProgress(state, 'autoClears', 5)
    expect(newly.map((a) => a.id)).toContain('p1')
    expect(addProgress(state, 'autoClears', 1).map((a) => a.id)).not.toContain('p1')
  })
})
