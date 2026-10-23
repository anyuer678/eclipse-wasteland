import { describe, it, expect } from 'vitest'
import { resolveCrowdObstacles, settleCrowd } from '../src/play/enemyPhysics'
import type { EnemyPhysicsCtx, PhysicsEnemy } from '../src/play/enemyPhysics'

const makeEnemy = (x: number, z: number, y = 0): PhysicsEnemy & { climb: number[]; ground: number[] } => {
  const climb: number[] = []
  const ground: number[] = []
  return {
    alive: true,
    def: { radius: 0.5 },
    root: { position: { x, y, z } },
    refuseClimb: (g) => {
      climb.push(g)
      return false
    },
    applyGroundMotion: (g) => {
      ground.push(g)
    },
    climb,
    ground,
  }
}

const ctx = (over: Partial<EnemyPhysicsCtx> = {}): EnemyPhysicsCtx => ({
  player: { x: 0, y: 0, z: 0 },
  terrainHeight: () => 0.5,
  clampArena: () => {},
  resolveObstacles: () => {},
  ...over,
})

describe('play/enemyPhysics', () => {
  it('resolves obstacles and grounds every living enemy', () => {
    const a = makeEnemy(1, 0)
    const dead = makeEnemy(2, 0)
    dead.alive = false
    resolveCrowdObstacles([a, dead], ctx())
    settleCrowd([a, dead], 1 / 60, ctx())
    expect(a.climb.length).toBe(2)
    expect(a.ground).toEqual([0.5])
    expect(dead.climb.length).toBe(0)
  })

  it('pushes enemies out of the player body', () => {
    const a = makeEnemy(0.1, 0)
    settleCrowd([a], 1 / 60, ctx())
    const d = Math.hypot(a.root.position.x, a.root.position.z)
    expect(d).toBeCloseTo(0.8)
  })

  it('skips the player push when on a different level', () => {
    const a = makeEnemy(0.1, 0, 3)
    settleCrowd([a], 1 / 60, ctx())
    expect(a.root.position.x).toBe(0.1)
  })
})
