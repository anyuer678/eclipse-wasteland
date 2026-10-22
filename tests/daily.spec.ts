import { describe, expect, it } from 'vitest'
import { ensureDaily, genDailyTasks } from '../src/growth/daily'
import type { DailyState } from '../src/growth/daily'

describe('growth/daily', () => {
  it('resets progress and claims when the date rolls over', () => {
    const state: DailyState = { date: '2000-1-1', progress: { old: 9 }, claimed: ['old'] }
    expect(ensureDaily(state, '2026-10-21')).toBe(true)
    expect(state.date).toBe('2026-10-21')
    expect(state.progress).toEqual({})
    expect(state.claimed).toEqual([])
    expect(ensureDaily(state, '2026-10-21')).toBe(false)
  })

  it('describes the chest task as pickup (the counter is on pickup)', () => {
    const names: string[] = []
    for (let day = 1; day <= 31; day++) {
      names.push(...genDailyTasks(`2026-10-${day}`).filter((t) => t.kind === 'chests').map((t) => t.name))
    }
    expect(names.length).toBeGreaterThan(0)
    expect(names.every((n) => n.startsWith('拾取补给箱'))).toBe(true)
  })
})
