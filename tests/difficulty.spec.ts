import { describe, it, expect } from 'vitest'
import { DIFFICULTY_OPTIONS, difficultyLabel, normalizeDifficulty } from '../src/campaign/difficulty'

describe('campaign/difficulty', () => {
  it('accepts every configured option', () => {
    for (const d of DIFFICULTY_OPTIONS) expect(normalizeDifficulty(d)).toBe(d)
  })

  it('falls back to standard for unknown values', () => {
    expect(normalizeDifficulty(0)).toBe(1)
    expect(normalizeDifficulty(3)).toBe(1)
    expect(normalizeDifficulty(Number.NaN)).toBe(1)
  })

  it('labels every option', () => {
    expect(difficultyLabel(0.7)).toBe('轻松')
    expect(difficultyLabel(1)).toBe('标准')
    expect(difficultyLabel(1.5)).toBe('困难')
    expect(difficultyLabel(2.2)).toBe('噩梦')
    expect(difficultyLabel(9)).toBe('标准')
  })
})
