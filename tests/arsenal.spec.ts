import { describe, it, expect } from 'vitest'
import { ARSENAL } from '../src/arsenal'

describe('arsenal/defs', () => {
  it('has unique ids and complete numeric fields', () => {
    const ids = ARSENAL.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const w of ARSENAL) {
      expect(w.damage).toBeGreaterThan(0)
      expect(w.rpm).toBeGreaterThan(0)
      expect(w.mag).toBeGreaterThan(0)
      expect(w.pellets).toBeGreaterThan(0)
      expect(w.critMult).toBeGreaterThan(1)
    }
  })

  it('keeps 12 weapons across the 10 mechanics', () => {
    expect(ARSENAL.length).toBe(12)
    const kinds = new Set(ARSENAL.map((w) => w.mech.kind))
    expect(kinds.size).toBe(10)
  })

  it('new weapons reuse existing mechanics', () => {
    const frost = ARSENAL.find((w) => w.id === 'frost-scatter')
    const rail = ARSENAL.find((w) => w.id === 'rail-lance')
    expect(frost?.mech.kind).toBe('slow')
    expect(rail?.mech.kind).toBe('pierce')
  })
})
