import { describe, it, expect } from 'vitest'
import { chestsInfo, cratesInfo, enemyHealths, enemyMotion, navInfo, obstaclesDump, playerPos, poolsInfo } from '../src/debug/queries'
import type { QueryDeps, QueryEnemy } from '../src/debug/queries'

const enemy = (over: Partial<QueryEnemy> = {}): QueryEnemy => ({
  def: { kind: 'chaser', radius: 0.45, hp: 40 },
  root: { position: { x: 3.004, y: 0, z: -4.006 } },
  hp: 12.2,
  alive: true,
  elite: null,
  slowTimer: 0,
  burnTimer: 0,
  isStunned: () => false,
  ...over,
})

const deps = (over: Partial<QueryDeps> = {}): QueryDeps => ({
  enemies: () => [enemy(), enemy({ hp: -3, alive: false, elite: { kind: 'armored' }, slowTimer: 0.5, burnTimer: 1 })],
  player: { position: { x: 0, y: 1, z: 0 }, onGround: true, terrainHeight: (x, z) => 0.5 + x * 0.01 + z * 0.01 },
  mapRoot: () => ({ userData: { poisonPools: [{ x: 2, z: -3, r: 2.2 }] } }),
  chests: () => [{ mesh: { position: { x: 1.234, y: 0.5, z: 2.345 } }, reward: '金币', amount: 12 }],
  crates: () => [{ x: -1, z: 2, alive: true }],
  nav: () => ({ ready: true, cell: 0.7, obstacles: [{ x: 1, z: 2, hw: 1, hd: 0.5, top: 1.2, crate: true }] }),
  ...over,
})

describe('debug/queries', () => {
  it('maps enemy health with ceil and clamps negative hp', () => {
    const hs = enemyHealths(deps())
    expect(hs[0]).toEqual({ hp: 13, max: 40, alive: true })
    expect(hs[1].hp).toBe(0)
    expect(hs[1].alive).toBe(false)
  })

  it('maps enemy motion fields (position rounding, ground, distance, status)', () => {
    const m = enemyMotion(deps())
    expect(m[0].x).toBe(3)
    expect(m[0].z).toBe(-4.01)
    expect(m[0].ground).toBe(0.49)
    expect(m[0].dist).toBe(5.01)
    expect(m[0].elite).toBe(false)
    expect(m[1].elite).toBe(true)
    expect(m[1].slow).toBe(true)
    expect(m[1].burn).toBe(true)
  })

  it('maps player, pools, chests, crates and nav', () => {
    const d = deps()
    expect(playerPos(d)).toEqual({ x: 0, y: 1, z: 0, ground: 0.5, onGround: true })
    expect(poolsInfo(d)[0]).toEqual({ x: 2, z: -3, r: 2.2, ground: 0.49 })
    expect(chestsInfo(d)[0]).toEqual({ x: 1.23, y: 0.5, z: 2.35, ground: 0.54, reward: '金币', amount: 12 })
    expect(cratesInfo(d)[0]).toEqual({ x: -1, z: 2, alive: true, ground: 0.51 })
    expect(navInfo(d)).toEqual({ ready: true, obstacles: 1, cell: 0.7 })
    expect(obstaclesDump(d)[0]).toEqual({ x: 1, z: 2, hw: 1, hd: 0.5, top: 1.2, crate: true })
  })
})
