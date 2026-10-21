import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { Weapon } from '../src/arsenal'
import type { FireContext, WeaponDef } from '../src/arsenal'

const lockonDef: WeaponDef = {
  id: 'test-lockon',
  name: '测试电弧',
  archetype: 'pistol',
  rarity: 'common',
  damage: 10,
  rpm: 600,
  mag: 10,
  pellets: 1,
  spreadDeg: 0,
  critMult: 1,
  energyGain: 0,
  energyMax: 100,
  color: 0xffffff,
  mech: { kind: 'lockon', range: 10, damageFactor: 1, cooldown: 1.2 },
}

const make = (): { weapon: Weapon; ctx: FireContext; hits: () => number } => {
  let hits = 0
  const weapon = new Weapon(lockonDef)
  const ctx: FireContext = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(0, 0, -1),
    tracer: { fire: () => {} } as unknown as FireContext['tracer'],
    resolveHit: () => new THREE.Vector3(),
    findTarget: () => new THREE.Vector3(0, 0, -5),
    onHitEnemy: () => {
      hits += 1
      return true
    },
  }
  return { weapon, ctx, hits: () => hits }
}

describe('arsenal/lockon cooldown', () => {
  it('blocks repeated E casts inside the cooldown window', () => {
    const { weapon, ctx, hits } = make()
    weapon.skill(ctx)
    expect(hits()).toBe(1)
    weapon.update(0.2, ctx)
    weapon.skill(ctx)
    expect(hits()).toBe(1)
    weapon.update(1.1, ctx)
    weapon.skill(ctx)
    expect(hits()).toBe(2)
  })
})
