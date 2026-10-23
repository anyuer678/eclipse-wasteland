import { describe, it, expect } from 'vitest'
import { COMBAT_GOODS, canAfford, combatGood } from '../src/play/combatShop'

describe('play/combatShop', () => {
  it('has unique ids and positive prices', () => {
    const ids = COMBAT_GOODS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of COMBAT_GOODS) {
      expect(g.price).toBeGreaterThan(0)
      expect(g.name.length).toBeGreaterThan(0)
    }
  })

  it('exposes ammo and crit goods alongside the original four', () => {
    expect(combatGood('ammo')?.price).toBe(15)
    expect(combatGood('crit')?.price).toBe(30)
    expect(COMBAT_GOODS.length).toBe(6)
  })

  it('checks affordability against the shared price', () => {
    expect(canAfford(40, 'dmg')).toBe(true)
    expect(canAfford(39, 'dmg')).toBe(false)
    expect(canAfford(999, 'nope')).toBe(false)
  })
})
