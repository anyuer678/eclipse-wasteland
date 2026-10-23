import { describe, it, expect } from 'vitest'
import { ALL_BOOST_IDS, activePreset, defaultAutoPick, pickBoost, sanitizeAutoPick } from '../src/growth/autopick'
import type { AutoPickConfig } from '../src/growth/autopick'
import type { BoostId } from '../src/growth/run'

describe('growth/autopick', () => {
  it('defaults to disabled with presets covering every boost exactly once', () => {
    const cfg = defaultAutoPick()
    expect(cfg.enabled).toBe(false)
    expect(cfg.presets.length).toBeGreaterThanOrEqual(3)
    for (const p of cfg.presets) {
      expect(p.order.length).toBe(ALL_BOOST_IDS.length)
      expect(new Set(p.order).size).toBe(ALL_BOOST_IDS.length)
    }
  })

  it('sanitizes stored orders: dedupes, drops unknown ids, appends missing ones', () => {
    const raw = {
      enabled: true,
      active: 0,
      presets: [{ name: '  我的流派  ', order: ['crit', 'crit', 'nope' as BoostId, 'dmg'] }],
    }
    const cfg = sanitizeAutoPick(raw as unknown as Partial<AutoPickConfig>)
    const order = cfg.presets[0].order
    expect(cfg.enabled).toBe(true)
    expect(cfg.presets[0].name).toBe('我的流派')
    expect(order.slice(0, 2)).toEqual(['crit', 'dmg'])
    expect(order.length).toBe(ALL_BOOST_IDS.length)
    expect(new Set(order).size).toBe(ALL_BOOST_IDS.length)
  })

  it('falls back to default presets and clamps an out-of-range active index', () => {
    const cfg = sanitizeAutoPick({ enabled: true, active: 99, presets: [] })
    expect(cfg.presets.length).toBeGreaterThan(0)
    expect(cfg.active).toBe(cfg.presets.length - 1)
  })

  it('picks the highest-priority boost among the rolled choices', () => {
    const preset = { name: 't', order: ['crit', 'spd', 'dmg', ...ALL_BOOST_IDS.filter((id) => !['crit', 'spd', 'dmg'].includes(id))] }
    expect(pickBoost(['dmg', 'spd'], preset)).toBe('spd')
    expect(pickBoost(['dmg', 'crit', 'spd'], preset)).toBe('crit')
    expect(pickBoost(['hp', 'dmg'], preset)).toBe('dmg')
  })

  it('returns the first rolled choice when the preset covers none of them', () => {
    const preset = { name: 't', order: [] }
    expect(pickBoost(['hp', 'armor'], preset)).toBe('hp')
    expect(pickBoost([], preset)).toBeNull()
    expect(pickBoost(['hp'], null)).toBe('hp')
  })

  it('only exposes a preset when auto-pick is enabled', () => {
    const cfg = defaultAutoPick()
    expect(activePreset(cfg)).toBeNull()
    cfg.enabled = true
    expect(activePreset(cfg)).toBe(cfg.presets[cfg.active])
  })
})
