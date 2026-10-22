import { describe, expect, it } from 'vitest'
import { ARSENAL } from '../src/arsenal'
import { Inventory } from '../src/growth'
import { damageMultiplier } from '../src/growth/upgrade'

describe('growth/weapon mastery', () => {
  it('grants +2% damage per 20 kills, capped at 10 levels', () => {
    const def = ARSENAL[0]
    const inv = new Inventory()
    const g = inv.getWeapon(def.id)

    g.kills = 19
    expect(damageMultiplier(def, inv)).toBeCloseTo(1)
    g.kills = 20
    expect(damageMultiplier(def, inv)).toBeCloseTo(1.02)
    g.kills = 200
    expect(damageMultiplier(def, inv)).toBeCloseTo(1.2)
    g.kills = 400
    expect(damageMultiplier(def, inv)).toBeCloseTo(1.2)
  })
})
