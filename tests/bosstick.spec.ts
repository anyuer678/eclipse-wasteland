import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { tickBoss } from '../src/play/bossTick'
import type { BossEvent, BossTickDeps } from '../src/play/bossTick'

const makeBoss = (over: Partial<{ phase: number; event: BossEvent | null; alive: boolean }> = {}) => {
  const boss = {
    alive: over.alive ?? true,
    phase: over.phase ?? 0,
    root: { position: new THREE.Vector3(0, 0, 0) },
    centerInto: (v: THREE.Vector3) => v.set(0, 1, 0),
    update: () => {
      boss.rec.updated += 1
      return over.event ?? null
    },
    applyGround: (y: number) => {
      boss.rec.grounds.push(y)
      boss.root.position.y = y
    },
    rec: { updated: 0, grounds: [] as number[] },
  }
  return boss
}

const deps = (over: Partial<BossTickDeps> = {}) => {
  const rec = {
    dmg: [] as number[],
    hits: 0,
    shakes: [] as number[],
    roars: 0,
    announces: [] as string[],
    bursts: 0,
    emits: 0,
    summons: [] as number[],
    los: true,
  }
  const d: BossTickDeps = {
    nav: { updateTarget: () => {}, hasLineOfSight3D: () => rec.los, steer: () => {} },
    playerPos: new THREE.Vector3(0, 0, 5),
    dt: 0.016,
    phaseSeen: 0,
    terrainHeightAt: () => 0.5,
    clampArena: () => {},
    resolveObstacles: () => {},
    damagePlayer: (n) => {
      rec.dmg.push(n)
      return true
    },
    hudHit: () => rec.hits++,
    shake: (a) => rec.shakes.push(a),
    roar: () => rec.roars++,
    announce: (t) => rec.announces.push(t),
    burst: () => rec.bursts++,
    emit: () => rec.emits++,
    summon: (n) => rec.summons.push(n),
    scratch: new THREE.Vector3(),
    ...over,
  }
  return { d, rec }
}

describe('tickBoss', () => {
  it('首次记录阶段不演出，后续阶段变化才吼叫/公告', () => {
    const b = makeBoss({ phase: 1 })
    const { d, rec } = deps({ phaseSeen: -1 })
    const seen = tickBoss(b, d)
    expect(seen).toBe(1)
    expect(rec.roars).toBe(0)

    b.phase = 2
    const r2 = deps({ phaseSeen: 1 })
    tickBoss(b, r2.d)
    expect(r2.rec.roars).toBe(1)
    expect(r2.rec.announces[0]).toContain('狂暴化')
    expect(r2.rec.bursts).toBe(1)
    expect(r2.rec.emits).toBe(1)
  })

  it('追击后贴地两次（更新前后各注入一次地形高度）', () => {
    const b = makeBoss()
    const { d } = deps()
    tickBoss(b, d)
    expect(b.rec.updated).toBe(1)
    expect(b.rec.grounds).toEqual([0.5, 0.5])
  })

  it('melee 有视线才结算；无视线不掉血', () => {
    const hit = makeBoss({ event: { melee: 18 } })
    const a = deps()
    tickBoss(hit, a.d)
    expect(a.rec.dmg).toEqual([18])
    expect(a.rec.hits).toBe(1)

    const blocked = makeBoss({ event: { melee: 18 } })
    const b = deps()
    b.rec.los = false
    tickBoss(blocked, b.d)
    expect(b.rec.dmg).toHaveLength(0)
  })

  it('冲锋只预警；践踏按半径结算；召唤传给生成回调', () => {
    const charge = makeBoss({ event: { chargeDir: new THREE.Vector3(1, 0, 0) } })
    const c = deps()
    tickBoss(charge, c.d)
    expect(c.rec.shakes).toEqual([0.1])

    const near = makeBoss({ event: { stompRadius: 8 } })
    const n = deps()
    tickBoss(near, n.d)
    expect(n.rec.shakes).toEqual([0.2])
    expect(n.rec.dmg).toEqual([8])

    const far = makeBoss({ event: { stompRadius: 2 } })
    const f = deps()
    tickBoss(far, f.d)
    expect(f.rec.dmg).toHaveLength(0)

    const sum = makeBoss({ event: { summon: 3 } })
    const s = deps()
    tickBoss(sum, s.d)
    expect(s.rec.summons).toEqual([3])
  })
})
