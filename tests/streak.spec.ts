import { describe, it, expect } from 'vitest'
import { streakEvent } from '../src/play/streak'

describe('streakEvent', () => {
  it('3 连杀起播报，5/10 连杀叠加回血', () => {
    expect(streakEvent(2)).toBeNull()
    expect(streakEvent(3)).toMatchObject({ color: '#ff9944', heal: 0 })
    expect(streakEvent(5)).toMatchObject({ text: '⚡ 五连杀!', color: '#ff6644', heal: 5 })
    expect(streakEvent(10)).toMatchObject({ text: '🌟 十连杀!!', color: '#ffd700', heal: 15 })
  })

  it('档位外的连杀使用动态文案，20 档为最高称谓', () => {
    expect(streakEvent(4)?.text).toBe('🔥 4连杀!')
    expect(streakEvent(20)?.text).toBe('🏆 无敌!!!')
    expect(streakEvent(21)?.text).toBe('🔥 21连杀!')
    expect(streakEvent(21)?.heal).toBe(15)
  })
})
