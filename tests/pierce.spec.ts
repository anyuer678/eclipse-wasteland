import { describe, it, expect } from 'vitest'
import { newRun, runBonuses } from '../src/growth/run'
import type { BoostId, RunState } from '../src/growth/run'

const runWith = (boosts: Partial<Record<BoostId, number>>): RunState => {
  const r = newRun()
  for (const [id, v] of Object.entries(boosts)) r.boosts[id as BoostId] = v as number
  return r
}

describe('growth/run — 穿透弹', () => {
  it('is no longer a flat damage boost', () => {
    const base = runBonuses(newRun()).dmgMult
    const withPierce = runBonuses(runWith({ pierce: 3 })).dmgMult
    expect(withPierce).toBe(base)
  })

  it('grants extra pierce targets, capped at 2', () => {
    expect(runBonuses(runWith({ pierce: 1 })).pierceStacks).toBe(1)
    expect(runBonuses(runWith({ pierce: 2 })).pierceStacks).toBe(2)
    expect(runBonuses(runWith({ pierce: 3 })).pierceStacks).toBe(2)
    expect(runBonuses(newRun()).pierceStacks).toBe(0)
  })

  it('keeps the 60% falloff', () => {
    expect(runBonuses(runWith({ pierce: 1 })).pierceFalloff).toBe(0.6)
  })
})
