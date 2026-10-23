import { describe, it, expect } from 'vitest'
import { SAVE_VERSION, migrateSave, serializeSave } from '../src/growth/save'

describe('growth/save', () => {
  it('migrates a legacy flat save and preserves fields', () => {
    const legacy = {
      materials: { 合金碎片: 12 },
      weapons: { 'pulse-rifle': { level: 3, ascension: 1, rune: 2, enchant: 4, pinnacle: 5, kills: 21, affixes: [{ kind: 'atk', value: 0.12 }] } },
      loadout: ['pulse-rifle', 'pulse-rifle', 'arc-pistol'],
      gold: 120,
      consumables: { medkit: 2 },
      talentPoints: 7,
      roleLevels: { assassin: 2 },
    }
    const { data, migrated } = migrateSave(legacy)
    expect(migrated).toBe(true)
    expect(data.materials['合金碎片']).toBe(12)
    expect(data.weapons['pulse-rifle']).toMatchObject({ level: 3, ascension: 1, rune: 2, enchant: 4, pinnacle: 5, kills: 21 })
    expect(data.weapons['pulse-rifle'].affixes).toEqual([{ kind: 'atk', value: 0.12 }])
    expect(data.loadout).toEqual(['pulse-rifle', 'arc-pistol'])
    expect(data.gold).toBe(120)
    expect(data.talentPoints).toBe(7)
  })

  it('round-trips a current save without marking it migrated', () => {
    const { data } = migrateSave({ materials: {}, weapons: {}, loadout: [], gold: 5, consumables: {}, talentPoints: 0, roleLevels: {} })
    const parsed = JSON.parse(serializeSave(data))
    expect(parsed.version).toBe(SAVE_VERSION)
    const again = migrateSave(parsed)
    expect(again.migrated).toBe(false)
    expect(again.data.gold).toBe(5)
  })

  it('sanitizes corrupt values instead of throwing', () => {
    const { data } = migrateSave({
      version: 2,
      data: {
        materials: { 合金碎片: -3, 金币: 'x' },
        weapons: { broken: { level: -5, ascension: 99, rune: -1, affixes: [{ kind: 'hack', value: 9 }, null] } },
        loadout: ['a', 'a', 'b', 'c', 'd', 'e'],
        gold: -10,
      },
    })
    expect(data.materials['合金碎片']).toBeUndefined()
    expect(data.materials['金币']).toBeUndefined()
    expect(data.weapons.broken.level).toBe(0)
    expect(data.weapons.broken.ascension).toBeLessThanOrEqual(3)
    expect(data.weapons.broken.rune).toBe(0)
    expect(data.weapons.broken.affixes).toEqual([])
    expect(data.loadout).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(data.gold).toBe(0)
  })

  it('returns an empty default save for garbage input', () => {
    for (const raw of [null, undefined, 42, 'nope', []]) {
      const { data } = migrateSave(raw)
      expect(data.gold).toBe(0)
      expect(Object.keys(data.weapons)).toHaveLength(0)
    }
  })
})
