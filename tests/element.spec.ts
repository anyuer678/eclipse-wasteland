import { describe, it, expect } from 'vitest'
import { elementSynergyMult } from '../src/growth/run'

describe('growth/run — 元素联动', () => {
  it('adds 15% crit damage against slowed targets', () => {
    expect(elementSynergyMult(true, true, false)).toBeCloseTo(1.15)
    expect(elementSynergyMult(true, false, false)).toBe(1)
    expect(elementSynergyMult(false, true, false)).toBe(1)
  })

  it('adds 8% damage against burning targets', () => {
    expect(elementSynergyMult(false, false, true)).toBeCloseTo(1.08)
    expect(elementSynergyMult(true, false, true)).toBeCloseTo(1.08)
  })

  it('stacks both multipliers', () => {
    expect(elementSynergyMult(true, true, true)).toBeCloseTo(1.15 * 1.08)
  })
})
