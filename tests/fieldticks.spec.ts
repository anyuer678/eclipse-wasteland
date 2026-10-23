import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { emitStatusFx, tickOrbPickups, tickShortBuffs } from '../src/play/fieldTicks'
import type { StatusEnemy } from '../src/play/fieldTicks'

describe('tickOrbPickups', () => {
  it('悬浮/旋转并拾取半径内的球，倒序删除', () => {
    const removed: THREE.Object3D[] = []
    const picked: string[] = []
    const mk = (x: number) => {
      const g = new THREE.Group()
      g.add(new THREE.Object3D())
      g.position.set(x, 0, 0)
      return g
    }
    const near = mk(0.5)
    const far = mk(10)
    const orbs = [
      { mesh: far, kind: 'crit' as const },
      { mesh: near, kind: 'heal' as const },
    ]
    tickOrbPickups({
      orbs,
      scene: { remove: (o) => removed.push(o) },
      playerPos: new THREE.Vector3(0, 0, 0),
      dt: 0.1,
      time: 0,
      canPickup: () => true,
      pick: (k) => picked.push(k),
      onPickup: () => {},
    })
    expect(picked).toEqual(['heal'])
    expect(removed).toEqual([near])
    expect(orbs.map((o) => o.kind)).toEqual(['crit'])
    expect(near.rotation.y).toBeCloseTo(0.22)
  })

  it('拾取被遮挡/不同层时保留', () => {
    const g = new THREE.Group()
    g.add(new THREE.Object3D())
    g.position.set(1, 0, 0)
    const orbs = [{ mesh: g, kind: 'move' as const }]
    tickOrbPickups({
      orbs,
      scene: { remove: () => {} },
      playerPos: new THREE.Vector3(0, 0, 0),
      dt: 0.016,
      time: 1,
      canPickup: () => false,
      pick: () => {},
      onPickup: () => {},
    })
    expect(orbs).toHaveLength(1)
  })
})

const statusEnemy = (over: Partial<StatusEnemy> = {}): StatusEnemy => ({
  alive: true,
  centerInto: (v) => v.set(0, 0, 0),
  isBurning: () => false,
  isSlowed: () => false,
  isStunned: () => false,
  ...over,
})

describe('emitStatusFx', () => {
  it('燃烧/减速/眩晕各发一次，死亡跳过', () => {
    const out: { color: number; y: number }[] = []
    const scratch = new THREE.Vector3()
    emitStatusFx(
      [
        statusEnemy({ isBurning: () => true, isSlowed: () => true, isStunned: () => true }),
        statusEnemy({ alive: false, isBurning: () => true }),
      ],
      { emit: (_p, color, _c, _s, _sc) => out.push({ color, y: 0 }) },
      scratch,
      () => 0
    )
    expect(out.map((o) => o.color)).toEqual([0xff7a33, 0x66c8ff, 0xffd24a])
  })

  it('特效高度叠加在敌人中心之上', () => {
    const ys: number[] = []
    const scratch = new THREE.Vector3()
    emitStatusFx(
      [statusEnemy({ centerInto: (v) => v.set(0, 1, 0), isStunned: () => true })],
      { emit: (p) => ys.push(p.y) },
      scratch,
      () => 0
    )
    expect(ys[0]).toBeCloseTo(2.35)
  })
})

describe('tickShortBuffs', () => {
  it('递减并仅在归零时返回 true', () => {
    const b = { fireSpd: 0.2, crit: 0, move: 1 }
    expect(tickShortBuffs(b, 0.1)).toBe(false)
    expect(b.fireSpd).toBeCloseTo(0.1)
    expect(tickShortBuffs(b, 1.2)).toBe(true)
    expect(b.fireSpd).toBe(0)
    expect(b.move).toBe(0)
    expect(tickShortBuffs(b, 0.1)).toBe(false)
  })
})
