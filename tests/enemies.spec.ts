import { describe, it, expect } from 'vitest'
import { ENEMY_DEFS } from '../src/horde/enemy'
import { MISSIONS } from '../src/campaign/missions'
import { scaleWaveSpec } from '../src/campaign/waves'

describe('horde/enemy — 支援兵种', () => {
  it('has 8 enemy kinds with sane stats', () => {
    const kinds = Object.keys(ENEMY_DEFS)
    expect(kinds).toHaveLength(8)
    for (const k of kinds) {
      const d = ENEMY_DEFS[k as keyof typeof ENEMY_DEFS]
      expect(d.hp).toBeGreaterThan(0)
      expect(d.radius).toBeGreaterThan(0)
    }
  })

  it('healer deals no damage and turret never moves', () => {
    expect(ENEMY_DEFS.healer.damage).toBe(0)
    expect(ENEMY_DEFS.turret.speed).toBe(0)
    expect(ENEMY_DEFS.turret.damage).toBeGreaterThan(ENEMY_DEFS.spitter.damage)
  })

  it('late missions and tower waves include the support kinds', () => {
    const late = MISSIONS.filter((m) => m.waves.some((w) => (w.healers ?? 0) + (w.turrets ?? 0) > 0))
    expect(late.length).toBeGreaterThanOrEqual(2)
    const scaled = scaleWaveSpec({ chasers: 1, boomers: 0, spitters: 0, healers: 1, turrets: 2 }, 1.3)
    expect(scaled.healers).toBe(1)
    expect(scaled.turrets).toBe(3)
  })
})
