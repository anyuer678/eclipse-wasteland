import { describe, it, expect } from 'vitest'
import { SpatialHash } from '../src/horde/spatialHash'
import { separateCrowd } from '../src/play/crowdStep'
import type { CrowdEnemy } from '../src/play/crowdStep'

const body = (x: number, z: number, y = 0, radius = 0.5, alive = true): CrowdEnemy => ({
  alive,
  def: { radius },
  root: { position: { x, y, z } },
})

describe('play/crowdStep', () => {
  it('pushes overlapping enemies apart', () => {
    const a = body(0, 0)
    const b = body(0.1, 0)
    const crowd = [a, b]
    const hash = new SpatialHash(1.5)
    separateCrowd(crowd, hash, { x: 0, z: 0 })
    const d = Math.hypot(a.root.position.x - b.root.position.x, a.root.position.z - b.root.position.z)
    expect(d).toBeGreaterThan(0.3)
  })

  it('leaves separated enemies untouched and ignores the dead', () => {
    const a = body(0, 0)
    const b = body(5, 0)
    const dead = body(0, 0, 0, 0.5, false)
    separateCrowd([a, b, dead], new SpatialHash(1.5), { x: 0, z: 0 })
    expect(a.root.position.x).toBe(0)
    expect(b.root.position.x).toBe(5)
    expect(dead.root.position.x).toBe(0)
  })

  it('does not separate enemies on different levels', () => {
    const a = body(0, 0, 0)
    const b = body(0.1, 0, 3)
    separateCrowd([a, b], new SpatialHash(1.5), { x: 0, z: 0 })
    expect(a.root.position.x).toBe(0)
    expect(b.root.position.x).toBe(0.1)
  })
})
