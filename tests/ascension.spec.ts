import { describe, it, expect } from 'vitest'
import {
  ASCENSION_EFFECTS,
  ascensionEffectsFor,
  chainAscensionMods,
  beamAscensionMods,
  slowAscensionMods,
} from '../src/growth/upgrade'

describe('growth/ascension mods（文案与数值同表）', () => {
  it('每系 3 阶都有文案；实装系每阶都有数值载荷', () => {
    for (const [kind, rows] of Object.entries(ASCENSION_EFFECTS)) {
      expect(rows.length).toBe(3)
      for (const r of rows) expect(r.text.length).toBeGreaterThan(0)
      if (kind === 'chain' || kind === 'beam' || kind === 'slow') {
        for (const r of rows) expect(typeof r.num).toBe('number')
      }
    }
  })

  it('ascensionEffectsFor 返回文案（阶数切片）', () => {
    const eff = ascensionEffectsFor('chain', 2)
    expect(eff.unlocked).toEqual(['弹跳次数 +1', '弹跳衰减降低'])
    expect(eff.next).toBe('首跳伤害 +20%')
    expect(ascensionEffectsFor('chain', 3).next).toBeNull()
    expect(ascensionEffectsFor('unknown', 1)).toEqual({ unlocked: [], next: null })
  })

  it('chain：阶0 无加成，阶1 弹跳 +1，阶2 衰减 0.75，阶3 首跳 ×1.2', () => {
    expect(chainAscensionMods(0)).toEqual({ jumpsBonus: 0, falloffOverride: null, firstHitMult: 1 })
    expect(chainAscensionMods(1)).toEqual({ jumpsBonus: 1, falloffOverride: null, firstHitMult: 1 })
    expect(chainAscensionMods(2)).toEqual({ jumpsBonus: 1, falloffOverride: 0.75, firstHitMult: 1 })
    expect(chainAscensionMods(3)).toEqual({ jumpsBonus: 1, falloffOverride: 0.75, firstHitMult: 1.2 })
    // 越界夹取
    expect(chainAscensionMods(9)).toEqual(chainAscensionMods(3))
    expect(chainAscensionMods(-1)).toEqual(chainAscensionMods(0))
  })

  it('beam：阶0 无加成，阶1 射程 ×1.3，阶2 伤害 ×1.12，阶3 能耗 ×0.75', () => {
    expect(beamAscensionMods(0)).toEqual({ rangeMult: 1, damageMult: 1, energyMult: 1 })
    expect(beamAscensionMods(1)).toEqual({ rangeMult: 1.3, damageMult: 1, energyMult: 1 })
    expect(beamAscensionMods(2)).toEqual({ rangeMult: 1.3, damageMult: 1.12, energyMult: 1 })
    expect(beamAscensionMods(3)).toEqual({ rangeMult: 1.3, damageMult: 1.12, energyMult: 0.75 })
  })

  it('slow：阶0 无加成，阶1 时长 ×1.4，阶2 附加 5 伤害，阶3 系数改 0.4', () => {
    expect(slowAscensionMods(0)).toEqual({ durationMult: 1, hitBonus: 0, factorOverride: null })
    expect(slowAscensionMods(1)).toEqual({ durationMult: 1.4, hitBonus: 0, factorOverride: null })
    expect(slowAscensionMods(2)).toEqual({ durationMult: 1.4, hitBonus: 5, factorOverride: null })
    expect(slowAscensionMods(3)).toEqual({ durationMult: 1.4, hitBonus: 5, factorOverride: 0.4 })
  })
})
