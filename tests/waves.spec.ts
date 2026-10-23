import { describe, it, expect } from 'vitest'
import { scaleWaveSpec } from '../src/campaign/waves'

describe('campaign/waves', () => {
  it('scales every kind and rounds to the nearest enemy', () => {
    const out = scaleWaveSpec({ chasers: 5, boomers: 2, spitters: 1, guards: 1, berserkers: 3, casters: 2 }, 1.3)
    expect(out).toEqual({ chasers: 7, boomers: 3, spitters: 1, guards: 1, berserkers: 4, casters: 3 })
  })

  it('keeps missing optional kinds at zero', () => {
    const out = scaleWaveSpec({ chasers: 4, boomers: 0, spitters: 0 }, 1.3)
    expect(out.guards).toBe(0)
    expect(out.berserkers).toBe(0)
    expect(out.casters).toBe(0)
    expect(out.chasers).toBe(5)
  })

  it('caps a single wave so the screen never floods', () => {
    const out = scaleWaveSpec({ chasers: 60, boomers: 0, spitters: 0 }, 1.3, 46)
    expect(out.chasers).toBe(46)
  })

  it('is a no-op for scale <= 1 or non-finite values', () => {
    const spec = { chasers: 5, boomers: 1, spitters: 0 }
    expect(scaleWaveSpec(spec, 1)).toEqual(spec)
    expect(scaleWaveSpec(spec, Number.NaN)).toEqual(spec)
  })
})
