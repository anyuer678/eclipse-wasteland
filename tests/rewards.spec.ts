import { describe, it, expect } from 'vitest'
import { clearRewards, difficultyRewardMult, towerFailureRewards, towerFloorClearRewards } from '../src/campaign/rewards'
import type { SettleInput } from '../src/campaign/rewards'

const input = (over: Partial<SettleInput> = {}): SettleInput => ({
  tower: false,
  towerFloor: 0,
  rewardMaterial: '合金碎片',
  rewardAmount: 10,
  kills: 31,
  missionLevel: 3,
  difficulty: 1,
  luckyGold: 0,
  goldBonus: 0,
  ...over,
})

describe('campaign/rewards', () => {
  it('applies difficulty and lucky-gold multipliers', () => {
    expect(difficultyRewardMult(1)).toBe(1)
    expect(difficultyRewardMult(1.5)).toBe(1.8)
    expect(difficultyRewardMult(2.2)).toBe(3)
    expect(difficultyRewardMult(0.7)).toBe(0.8)
    expect(difficultyRewardMult(1, 0.6)).toBeCloseTo(1.6)
  })

  it('computes normal clear rewards and talent points', () => {
    const r = clearRewards(input({ difficulty: 1.5, goldBonus: 0.2 }))
    expect(r.materialAmount).toBe(18)
    expect(r.gold).toBe(Math.round((30 + 3 * 5) * 1.2 * 1.8))
    expect(r.talentGain).toBe(2)
  })

  it('scales tower-floor rewards with the floor', () => {
    const r = clearRewards(input({ tower: true, towerFloor: 6, rewardMaterial: '核心晶体', rewardAmount: 40 }))
    expect(r.materialAmount).toBe(Math.round(40 * (1 + 6 * 0.25)))
    expect(r.gold).toBe(Math.round(30 * (1 + 6 * 0.3)))
  })

  it('gives partial rewards for tower failure with a floor of at least 1', () => {
    const r = towerFailureRewards(input({ tower: true, towerFloor: 0, rewardAmount: 1 }))
    expect(r.material).toBe('合金碎片')
    expect(r.materialAmount).toBe(2)
    expect(r.gold).toBe(Math.round(20 * 1.2))
    expect(r.talentGain).toBe(0)
  })

  it('computes per-floor tower clear rewards with difficulty and lucky gold', () => {
    const r = towerFloorClearRewards(3, 2, 0.2)
    expect(r.material).toBe('合金碎片')
    expect(r.materialAmount).toBe(Math.round(2 + 3 * 0.5))
    expect(r.gold).toBe(Math.round(20 * (1 + 3 * 0.15) * 3 * 1.2))
  })
})
