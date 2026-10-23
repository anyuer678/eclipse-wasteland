import { describe, it, expect } from 'vitest'
import { buffState, combatState, runDump, uiState, weaponState } from '../src/debug/stateQueries'
import type { StateDeps } from '../src/debug/stateQueries'

const deps = (): StateDeps => ({
  paused: () => true,
  shopOpen: () => false,
  settingsVisible: () => false,
  menu: () => true,
  phase: () => 'wave',
  wave: () => 2,
  enemiesRemaining: () => 7,
  ticks: () => 1234,
  lockTries: () => 2,
  unlockCalls: () => 1,
  pointerLocked: () => false,
  hp: () => 87,
  maxHp: () => 100,
  weapon: () => ({
    id: 'arc-pistol',
    name: '电弧手枪',
    index: 2,
    count: 5,
    viewmodelId: 'arc-pistol',
    kills: 21,
    growthDamage: 1.234567,
    magMult: 1,
    magCap: 24,
    ammo: 17,
  }),
  shortBuffs: () => ({ fireSpd: 0, crit: 3, move: 0 }),
  buffs: () => ({ atk: 1, shield: 0, speed: 2 }),
  shield: () => 3.4567,
  shieldCooldown: () => 1,
  fury: () => 0,
  stealth: () => 2.2,
  roleCooldown: () => 4,
  meleeCooldown: () => 0.5,
  dashCooldown: () => 2,
  summonActive: () => true,
  infernoActive: () => false,
  healActive: () => false,
  killStreak: () => 5,
  run: () => ({ level: 4, exp: 3, boosts: { dmg: 2 } }),
})

describe('debug/stateQueries', () => {
  it('maps ui and weapon state', () => {
    const d = deps()
    expect(uiState(d)).toEqual({
      paused: true, shopOpen: false, settings: false, menu: true, phase: 'wave',
      wave: 2, enemies: 7, ticks: 1234, lockTries: 2, unlockCalls: 1, pointerLocked: false,
    })
    expect(weaponState(d)).toMatchObject({ id: 'arc-pistol', kills: 21, growthDamage: 1.2346, ammo: 17 })
  })

  it('maps combat state with rounding and copies', () => {
    const d = deps()
    const c = combatState(d)
    expect(c.shield).toBe(3.46)
    expect(c.killStreak).toBe(5)
    expect(c.summon).toBe(true)
    expect(c.maxHp).toBe(100)
    expect(c.hp).toBe(87)
    c.shortBuffs.crit = 99
    expect(d.shortBuffs().crit).toBe(3)
  })

  it('copies buffs and run state', () => {
    const d = deps()
    expect(buffState(d)).toEqual({ atk: 1, shield: 0, speed: 2 })
    const run = runDump(d)
    expect(run.level).toBe(4)
    run.boosts.dmg = 9
    expect(d.run().boosts.dmg).toBe(2)
  })
})
