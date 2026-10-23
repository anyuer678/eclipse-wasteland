import { describe, it, expect } from 'vitest'
import { mitigatedDamage } from '../src/play/damageTaken'

describe('mitigatedDamage', () => {
  it('三类减伤相加后直接乘算', () => {
    expect(mitigatedDamage(100, 0.2, 0.1, 0.1, false)).toBeCloseTo(60)
    expect(mitigatedDamage(100, 0, 0, 0, false)).toBe(100)
  })

  it('总减伤封顶 85%', () => {
    expect(mitigatedDamage(100, 0.6, 0.4, 0.3, false)).toBeCloseTo(15)
    expect(mitigatedDamage(100, 1, 1, 1, false)).toBeCloseTo(15)
  })

  it('护盾生效再乘 0.3', () => {
    expect(mitigatedDamage(100, 0.2, 0, 0, true)).toBeCloseTo(24)
    expect(mitigatedDamage(100, 1, 1, 1, true)).toBeCloseTo(4.5)
  })
})
