import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { chainLightning } from '../src/play/chain'
import type { TargetEnemy } from '../src/play/targeting'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

interface Fake extends TargetEnemy {
  hp: number
  name: string
}

const fake = (name: string, z: number, hp = 100): Fake => ({
  name,
  hp,
  alive: true,
  center: () => v(0, 1, z),
})

describe('chainLightning', () => {
  it('按最近可见目标逐跳，伤害按 falloff 衰减', () => {
    const e1 = fake('a', 3)
    const e2 = fake('b', 6)
    const damages: number[] = []
    const fires: string[] = []
    chainLightning(v(0, 1, 0), 100, 3, 0.6, {
      enemies: () => [e1, e2],
      hasLineOfSight3D: () => true,
      fire: (from, to) => fires.push(`${from.z}->${to.z}`),
      damage: (e, n) => {
        damages.push(n)
        e.hp -= n
        if (e.hp <= 0) e.alive = false
        return !e.alive
      },
      onKill: () => false,
    })
    expect(fires).toEqual(['0->3', '3->6', '6->3'])
    expect(damages[0]).toBeCloseTo(60)
    expect(damages[1]).toBeCloseTo(36)
    expect(damages[2]).toBeCloseTo(21.6)
  })

  it('视线被挡/距离超过 10m 的目标跳过', () => {
    const near = fake('near', 3)
    const far = fake('far', 20)
    const blocked = fake('blocked', 5)
    const hit: string[] = []
    chainLightning(v(0, 1, 0), 50, 2, 0.6, {
      enemies: () => [near, blocked, far],
      hasLineOfSight3D: (_a, _b, _c, _d, _e, bz) => bz !== 5,
      fire: () => {},
      damage: (e) => {
        hit.push(e.name)
        return false
      },
      onKill: () => false,
    })
    expect(hit).toEqual(['near'])
  })

  it('击杀触发升级暂停时立即停止后续跳', () => {
    const a = fake('a', 3)
    const b = fake('b', 6)
    const hit: string[] = []
    chainLightning(v(0, 1, 0), 100, 4, 0.6, {
      enemies: () => [a, b],
      hasLineOfSight3D: () => true,
      fire: () => {},
      damage: (e) => {
        hit.push(e.name)
        return e.name === 'a'
      },
      onKill: () => true,
    })
    expect(hit).toEqual(['a'])
  })

  it('无目标时不发跳', () => {
    let fires = 0
    chainLightning(v(0, 1, 0), 10, 3, 0.6, {
      enemies: () => [],
      hasLineOfSight3D: () => true,
      fire: () => fires++,
      damage: () => false,
      onKill: () => false,
    })
    expect(fires).toBe(0)
  })
})
