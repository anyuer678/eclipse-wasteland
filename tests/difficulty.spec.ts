import { describe, it, expect } from 'vitest'
import { DIFFICULTY_OPTIONS, normalizeDifficulty } from '../src/campaign/difficulty'

describe('campaign/difficulty', () => {
  it('accepts every configured option', () => {
    for (const d of DIFFICULTY_OPTIONS) expect(normalizeDifficulty(d)).toBe(d)
  })

  it('falls back to standard for unknown values', () => {
    expect(normalizeDifficulty(0)).toBe(1)
    expect(normalizeDifficulty(3)).toBe(1)
    expect(normalizeDifficulty(Number.NaN)).toBe(1)
  })
})
