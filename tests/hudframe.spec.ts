import { describe, it, expect } from 'vitest'
import { hudFrame } from '../src/play/hudFrame'
import type { HudFrameDeps } from '../src/play/hudFrame'

const deps = (over: Partial<HudFrameDeps> = {}): HudFrameDeps => ({
  hp: 87, maxHp: 100, energy: 40, maxEnergy: 100,
  weaponName: '脉冲步枪', weaponLevel: 3, weaponAsc: 1, damageMult: 1.15,
  ammo: 17, mag: 24, reloading: false,
  phase: 'wave', wave: 1, totalWaves: 3, tower: false, missionName: '废弃设施',
  autoPick: '火力流', monsterLevel: 3, playerLevel: 4,
  runLevel: 4, runExp: 2, boosts: { dmg: 2, crit: 1 },
  weaponLines: [{ key: 'E', label: '过载射击', value: '消耗 40 能量' }],
  roleName: '影袭者', roleCooldown: 0, dashCooldown: 2.94, shieldCooldown: 0, shieldTimer: 5.04, killStreak: 4,
  slots: [{ name: '脉冲步枪', rarity: 'fine' }], slotIndex: 0,
  ...over,
})

describe('play/hudFrame', () => {
  it('passes through core fields and builds skill lines', () => {
    const f = hudFrame(deps())
    expect(f.hp).toBe(87)
    expect(f.weaponName).toBe('脉冲步枪')
    expect(f.autoPick).toBe('火力流')
    const keys = f.skillLines.map((l) => l.key)
    expect(keys).toEqual(['E', '局', 'X', 'F', 'G', '连杀'])
    const byKey = Object.fromEntries(f.skillLines.map((l) => [l.key, l]))
    expect(byKey['局'].value).toContain('经验 2/13')
    expect(byKey['局'].value).toContain('攻击强化×2 暴击强化×1')
    expect(byKey.X.value).toBe('就绪（大招）')
    expect(byKey.F.value).toBe('冷却 2.9s')
    expect(byKey.G.value).toBe('生效 5.0s')
    expect(byKey['连杀'].value).toBe('伤害+20%')
  })

  it('omits the streak line when idle and shows 无强化', () => {
    const f = hudFrame(deps({ killStreak: 0, boosts: {}, roleCooldown: 3.2 }))
    expect(f.skillLines.some((l) => l.key === '连杀')).toBe(false)
    expect(f.skillLines.find((l) => l.key === '局')?.value).toContain('无强化')
    expect(f.skillLines.find((l) => l.key === 'X')?.value).toBe('冷却 4s')
  })
})
