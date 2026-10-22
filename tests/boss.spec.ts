import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Boss } from '../src/campaign/boss'

describe('campaign/boss elemental resistance', () => {
  it('reduces fire damage by resistance level while physical stays full', () => {
    const boss = new Boss({
      id: 'res-boss',
      name: '抗性测试',
      hp: 100,
      color: 0xffffff,
      skillInterval: 99,
      resistance: { physical: 0, fire: 3, ice: 0, energy: 0 },
    })
    boss.takeDamage(20, 'fire')
    expect(boss.hp).toBeCloseTo(91)
    boss.takeDamage(20, 'physical')
    expect(boss.hp).toBeCloseTo(71)
  })
})

describe('campaign/boss charge contact', () => {
  it('emits one contact hit while charging past the player', () => {
    const boss = new Boss({ id: 'test-boss', name: '测试巨兽', hp: 100, color: 0xffffff, skillInterval: 3.2 })
    boss.root.position.set(0, 0, -8)
    const player = new THREE.Vector3(0, 0, 0)
    let contact = 0
    for (let i = 0; i < 240; i++) {
      const evt = boss.update(1 / 60, player)
      if (evt?.melee !== undefined) {
        contact += 1
        break
      }
    }
    expect(contact).toBe(1)
    expect(boss.isCharging()).toBe(true)
  })
})
