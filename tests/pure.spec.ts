import { describe, expect, it } from 'vitest'
import { TAU, angleLerp, clamp, clampWithFlag, dist2, lerp } from '../src/core/math'
import { Rng } from '../src/core/rng'
import {
  chargeDamageMult,
  energyAfterShot,
  fireIntervalSeconds,
  magCapacity,
  reloadTimeFor,
  shotDamage,
  tableDps,
} from '../src/arsenal/combat'
import {
  ASCENSION_EFFECTS,
  MAX_ASCENSION,
  MAX_RUNE,
  RUNE_DAMAGE_STEP,
  ascensionEffectsFor,
} from '../src/growth/upgrade'

describe('core/math', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
  it('lerp', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(2, 2, 1)).toBe(2)
  })
  it('angleLerp shortest arc', () => {
    // result may sit near 0 or 2π; normalized delta to 0 must be the short way
    const a = angleLerp(TAU - 0.1, 0.1, 0.5)
    const norm = ((a % TAU) + TAU) % TAU
    const deltaToZero = Math.min(norm, TAU - norm)
    expect(deltaToZero).toBeLessThan(0.25)
  })
  it('dist2', () => {
    expect(dist2(0, 0, 3, 4)).toBe(25)
  })
  it('clampWithFlag', () => {
    expect(clampWithFlag(5, 0, 10)).toEqual({ value: 5, clamped: false })
    expect(clampWithFlag(-1, 0, 10)).toEqual({ value: 0, clamped: true })
    expect(clampWithFlag(11, 0, 10)).toEqual({ value: 10, clamped: true })
  })
})

describe('core/rng determinism', () => {
  it('same seed same sequence', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    const sa = Array.from({ length: 20 }, () => a.next())
    const sb = Array.from({ length: 20 }, () => b.next())
    expect(sa).toEqual(sb)
  })
  it('int in range', () => {
    const r = new Rng(7)
    for (let i = 0; i < 50; i++) {
      const v = r.int(2, 5)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThan(5)
    }
  })
  it('fork is deterministic per label', () => {
    const a = new Rng(1).fork('drop')
    const b = new Rng(1).fork('drop')
    expect(a.next()).toBe(b.next())
  })
})

describe('arsenal/combat formulas', () => {
  it('fireIntervalSeconds', () => {
    expect(fireIntervalSeconds(600)).toBeCloseTo(0.1)
    expect(fireIntervalSeconds(600, 2)).toBeCloseTo(0.05)
    expect(fireIntervalSeconds(0)).toBe(Number.POSITIVE_INFINITY)
  })
  it('shotDamage multiplies layers', () => {
    expect(shotDamage(10, 1.5, 2)).toBe(30)
    expect(shotDamage(10)).toBe(10)
  })
  it('magCapacity ceil and mult', () => {
    expect(magCapacity(30, 1)).toBe(30)
    expect(magCapacity(30, 1.1)).toBe(33)
    expect(magCapacity(30, 0)).toBe(0)
  })
  it('reloadTimeFor archetypes', () => {
    expect(reloadTimeFor('sniper')).toBe(2.4)
    expect(reloadTimeFor('rifle')).toBe(1.6)
    expect(reloadTimeFor('pistol' as never)).toBe(1.2)
  })
  it('chargeDamageMult interpolates 1..max', () => {
    expect(chargeDamageMult(0, 2, 1)).toBe(1)
    expect(chargeDamageMult(1, 2, 1)).toBe(2)
    expect(chargeDamageMult(0.5, 2, 1)).toBeCloseTo(1.5)
    expect(chargeDamageMult(99, 2, 0)).toBe(2)
  })
  it('tableDps', () => {
    const dps = tableDps({ damage: 10, pellets: 2, rpm: 600 })
    expect(dps).toBeCloseTo(10 * 2 / 0.1)
  })
  it('energyAfterShot clamps', () => {
    expect(energyAfterShot(0, 10, 1, 100)).toBe(10)
    expect(energyAfterShot(95, 10, 1, 100)).toBe(100)
    expect(energyAfterShot(5, 10, 0, 100)).toBe(5)
  })
})

describe('growth/upgrade tables', () => {
  it('ascension caps and effects', () => {
    expect(MAX_ASCENSION).toBe(3)
    expect(MAX_RUNE).toBe(10)
    expect(RUNE_DAMAGE_STEP).toBeGreaterThan(0)
    const at0 = ascensionEffectsFor('charge', 0)
    expect(at0.next).toBeTruthy()
    expect(at0.unlocked).toHaveLength(0)
    const atMax = ascensionEffectsFor('charge', 10)
    expect(atMax.next).toBeNull()
    expect(Object.keys(ASCENSION_EFFECTS).length).toBeGreaterThanOrEqual(8)
  })
})

describe('growth/stats', () => {
  it('baseStats layers growth bonuses', async () => {
    const { baseStats, fourStats, BUFF_DURATION } = await import('../src/growth/stats')
    const s = baseStats(0.5, 20, 0.25, { enchant: 10, pinnacle: 5 })
    expect(s.attackMult).toBeCloseTo(1 + 0.5 + 5 * 0.03)
    expect(s.critRate).toBeLessThanOrEqual(0.45)
    expect(s.critRate).toBeGreaterThan(0.06)
    expect(s.energyRegen).toBeCloseTo(1.25)
    expect(s.maxHpBonus).toBe(25 + 20)
    expect(s.fireRateMult).toBeCloseTo(1 + 0.2)
    const f = fourStats(s)
    expect(f.power).toBe(Math.round((s.attackMult - 1) * 100))
    expect(BUFF_DURATION.atk).toBe(20)
    expect(BUFF_DURATION.shield).toBe(10)
    expect(BUFF_DURATION.speed).toBe(12)
  })

  it('critRate hard-capped at 0.45', async () => {
    const { baseStats } = await import('../src/growth/stats')
    const s = baseStats(0, 0, 0, { enchant: 1000, pinnacle: 100 })
    expect(s.critRate).toBe(0.45)
  })
})

describe('growth/talent tables', () => {
  it('four nodes x 5 levels with positive perLevel', async () => {
    const { TALENT_NODES } = await import('../src/growth/talent')
    expect(TALENT_NODES).toHaveLength(4)
    for (const n of TALENT_NODES) {
      expect(n.maxLevel).toBe(5)
      expect(n.perLevel).toBeGreaterThan(0)
      expect(n.desc(1).length).toBeGreaterThan(0)
    }
    const ids = TALENT_NODES.map((n) => n.id)
    expect(new Set(ids).size).toBe(4)
  })
})
