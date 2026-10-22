import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ProjectilePool } from '../src/horde/projectiles'
import type { Fx } from '../src/render/fx'

const fx = { emit: () => {} } as unknown as Fx

const fly = (p: ProjectilePool, from: THREE.Vector3, to: THREE.Vector3, player: THREE.Vector3): number => {
  p.spawn(from, to, 0xffffff, 13, 7)
  for (let i = 0; i < 180; i++) {
    const dmg = p.update(1 / 60, player)
    if (dmg > 0) return dmg
  }
  return 0
}

describe('horde/projectiles', () => {
  it('hits a grounded target at range (gravity compensation matches update)', () => {
    // 旧实现把重力补偿写成负号，8m 外全部砸地；这里锁定 3/8/12m 都能命中
    for (const dist of [3, 8, 12]) {
      const p = new ProjectilePool(new THREE.Scene(), fx)
      const target = new THREE.Vector3(0, 1.2, dist)
      const player = new THREE.Vector3(0, 0, dist)
      expect(fly(p, new THREE.Vector3(0, 1.6, 0), target, player)).toBe(7)
    }
  })

  it('fizzles on terrain instead of flying underground', () => {
    const scene = new THREE.Scene()
    const p = new ProjectilePool(scene, fx)
    p.spawn(new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 0.2, 6), 0xffffff, 13, 5)
    expect(scene.children.length).toBe(1)
    const player = new THREE.Vector3(100, 0, 100)
    for (let i = 0; i < 120 && scene.children.length > 0; i++) p.update(1 / 60, player, () => 0.5)
    expect(scene.children.length).toBe(0)
  })
})
