import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ARSENAL } from '../src/arsenal'
import { Weapon } from '../src/arsenal/weapon'
import type { FireContext } from '../src/arsenal/weapon'

const makeCtx = (hits: number[]): FireContext => ({
  origin: new THREE.Vector3(0, 1, 0),
  direction: new THREE.Vector3(0, 0, -1),
  tracer: { fire: () => {} } as unknown as FireContext['tracer'],
  resolveHit: () => new THREE.Vector3(0, 1, -5),
  resolvePierce: () => [new THREE.Vector3(0, 1, -5), new THREE.Vector3(0, 1, -8)],
  onHitEnemy: (_pos, damage) => {
    hits.push(damage)
    return true
  },
  onChain: () => {},
  onHeal: () => {},
  onShot: () => {},
})

describe('arsenal/weapon firing', () => {
  it('every weapon can fire and deal damage', () => {
    for (const def of ARSENAL) {
      const w = new Weapon(def)
      w.state.energy = def.energyMax
      const hits: number[] = []
      const ctx = makeCtx(hits)
      const fired = w.fire(ctx)
      if (!fired && w.state.charging) w.releaseFire(ctx)
      expect(hits.length, `${def.id} 应当造成伤害`).toBeGreaterThan(0)
      expect(w.state.ammo, `${def.id} 应当消耗弹药`).toBeLessThan(def.mag)
      for (const d of hits) expect(d, `${def.id} 伤害应为正`).toBeGreaterThan(0)
    }
  })

  it('run pierce adds extra targets for a single-pellet weapon', () => {
    const def = ARSENAL[0]
    const w = new Weapon(def)
    const hits: number[] = []
    const ctx = { ...makeCtx(hits), runPierce: { targets: 2, falloff: 0.6 } }
    w.fire(ctx)
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits[1]).toBeCloseTo(hits[0] * 0.6, 5)
  })
})
