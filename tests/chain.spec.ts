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
  it('按最近可见目标逐跳且不重复命中，伤害按 falloff 衰减', () => {
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
    // 3 跳只有 2 个目标：跳数 = 不同目标数上限，不回弹重复命中
    expect(fires).toEqual(['0->3', '3->6'])
    expect(damages[0]).toBeCloseTo(60)
    expect(damages[1]).toBeCloseTo(36)
  })

  it('等距直线靶不回弹：逐个新目标被命中', () => {
    const targets = [fake('a', 3), fake('b', 6), fake('c', 9), fake('d', 12)]
    const hit: string[] = []
    chainLightning(v(0, 1, 0), 100, 4, 0.6, {
      enemies: () => targets,
      hasLineOfSight3D: () => true,
      fire: () => {},
      damage: (e) => {
        hit.push(e.name)
        return false
      },
      onKill: () => false,
    })
    // 旧算法会在 a/b 间来回 ping-pong；现在 4 跳命中 4 个不同目标
    expect(hit).toEqual(['a', 'b', 'c', 'd'])
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

  it('exclude 的主命中目标不参与弹跳，跳数全部花在新目标上', () => {
    const main = fake('main', 3)
    const b = fake('b', 6)
    const c = fake('c', 9)
    const damages: string[] = []
    const fires: string[] = []
    chainLightning(v(0.3, 1, 3.2), 100, 3, 0.6, {
      enemies: () => [main, b, c],
      hasLineOfSight3D: () => true,
      fire: (from, to) => fires.push(`${from.z.toFixed(1)}->${to.z}`),
      damage: (e, n) => {
        damages.push(`${e.name}:${n}`)
        return false
      },
      onKill: () => false,
      exclude: main,
    })
    expect(fires).toEqual(['3.2->6', '6.0->9'])
    expect(damages).toEqual(['b:60', 'c:36'])
  })
})
