import { describe, it, expect } from 'vitest'
import { nextBest } from '../src/growth/towerRecord'

describe('growth/towerRecord', () => {
  it('keeps the larger of stored and reached', () => {
    expect(nextBest(3, 5)).toBe(5)
    expect(nextBest(7, 2)).toBe(7)
  })

  it('floors values and clamps garbage to zero', () => {
    expect(nextBest(2.9, 3.7)).toBe(3)
    expect(nextBest(Number.NaN, -4)).toBe(0)
    expect(nextBest(-2, -1)).toBe(0)
  })
})
