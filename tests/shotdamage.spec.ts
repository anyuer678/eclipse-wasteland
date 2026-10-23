import { describe, it, expect } from 'vitest'
import { shotDamage } from '../src/play/shotDamage'
import type { ShotDamageInput } from '../src/play/shotDamage'

const input = (over: Partial<ShotDamageInput> = {}): ShotDamageInput => ({
  base: 10,
  suppression: 1,
  killStreak: 0,
  stealthMult: 1,
  attackMult: 1,
  critChance: 0,
  critMult: 1.5,
  runDamageMult: 1,
  highGround: false,
  ...over,
})

describe('shotDamage', () => {
  it('非暴击只走基础乘数链，暴击再乘 critMult', () => {
    expect(shotDamage(input(), () => 0.99)).toEqual({ damage: 10, isCrit: false })
    expect(shotDamage(input({ critChance: 0.5, critMult: 2.4 }), () => 0.1)).toEqual({ damage: 24, isCrit: true })
  })

  it('连杀最多叠 6 层（×1.3），高地额外 ×1.2', () => {
    expect(shotDamage(input({ killStreak: 9 }), () => 0.99).damage).toBeCloseTo(13)
    expect(shotDamage(input({ base: 10, highGround: true }), () => 0.99).damage).toBeCloseTo(12)
  })

  it('乘数叠加：压制 × 隐身 × 攻击 × 局内', () => {
    const r = shotDamage(input({ suppression: 1.2, stealthMult: 2.3, attackMult: 1.4, runDamageMult: 1.1 }), () => 0.99)
    expect(r.damage).toBeCloseTo(10 * 1.2 * 2.3 * 1.4 * 1.1)
  })

  it('非法结果回退基础伤害', () => {
    expect(shotDamage(input({ attackMult: Number.NaN }), () => 0.99).damage).toBe(10)
    expect(shotDamage(input({ suppression: 0 }), () => 0.99).damage).toBe(10)
  })
})
