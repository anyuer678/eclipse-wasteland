import { describe, it, expect } from 'vitest'
import { eliteFor } from '../src/horde/spawner'
import { ELITE_AFFIXES } from '../src/horde/enemy'

describe('horde/spawner elite rolls', () => {
  it('forces the first N enemies to be elite regardless of chance', () => {
    for (let i = 0; i < 2; i++) {
      expect(eliteFor(i, 2, 0, 0.99, 0.1)).toBeDefined()
    }
    expect(eliteFor(2, 2, 0, 0.99, 0.1)).toBeUndefined()
  })

  it('falls back to probability after the guaranteed slots', () => {
    expect(eliteFor(1, 1, 0.2, 0.1, 0.5)).toBeDefined()
    expect(eliteFor(1, 1, 0.2, 0.9, 0.5)).toBeUndefined()
  })

  it('picks a valid affix deterministically from the roll', () => {
    const kind = eliteFor(0, 1, 0, 0, 0)
    expect(ELITE_AFFIXES.map((a) => a.kind)).toContain(kind)
    expect(eliteFor(0, 1, 0, 0, 0.99)).toBe('regenerating')
  })
})
