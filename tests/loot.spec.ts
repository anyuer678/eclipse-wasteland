import { describe, it, expect } from 'vitest'
import { ORB_KINDS, rollChestReward, rollOrbKind } from '../src/play/loot'

const seq = (...xs: number[]) => {
  let i = 0
  return () => xs[i++] ?? 0
}

describe('loot', () => {
  it('大宝箱 50/50 分核心晶体与金币', () => {
    expect(rollChestReward(true, seq(0.1))).toEqual({ reward: '核心晶体', amount: 3 })
    expect(rollChestReward(true, seq(0.9))).toEqual({ reward: '金币', amount: 40 })
  })

  it('小宝箱按 45/30/25 分支给材料/金币/医疗包', () => {
    expect(rollChestReward(false, seq(0.1, 0.5))).toEqual({ reward: '合金碎片', amount: 3 })
    expect(rollChestReward(false, seq(0.6, 0.5))).toEqual({ reward: '金币', amount: 17 })
    expect(rollChestReward(false, seq(0.9))).toEqual({ reward: 'medkit', amount: 1 })
  })

  it('BUFF 球覆盖 5 种且按随机数取整', () => {
    expect(ORB_KINDS).toHaveLength(5)
    expect(rollOrbKind(seq(0)).kind).toBe('fireSpd')
    expect(rollOrbKind(seq(0.999)).kind).toBe('move')
    expect(rollOrbKind(seq(0.25)).kind).toBe('crit')
  })
})
