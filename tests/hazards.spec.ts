import { describe, it, expect } from 'vitest'
import { POISON_DPS, inPoisonPool } from '../src/play/hazards'

const pool = { x: 10, z: -4, r: 3 }

describe('inPoisonPool', () => {
  it('圆内且与池面高差小于 0.7m 才生效', () => {
    expect(inPoisonPool({ x: 10, y: 0, z: -4 }, pool, 0)).toBe(true)
    expect(inPoisonPool({ x: 12.9, y: 0.5, z: -4 }, pool, 0)).toBe(true)
    expect(inPoisonPool({ x: 13.1, y: 0, z: -4 }, pool, 0)).toBe(false)
  })

  it('边界严格小于半径，垂直方向按池子所在地面计算', () => {
    expect(inPoisonPool({ x: 13, y: 0, z: -4 }, pool, 0)).toBe(false)
    expect(inPoisonPool({ x: 10, y: 0.69, z: -4 }, pool, 0)).toBe(true)
    expect(inPoisonPool({ x: 10, y: 0.71, z: -4 }, pool, 0)).toBe(false)
    // 池子在高地（地面 1.2）：站在下面平台不会被隔空毒到
    expect(inPoisonPool({ x: 10, y: 0.2, z: -4 }, pool, 1.2)).toBe(false)
    expect(inPoisonPool({ x: 10, y: 1.4, z: -4 }, pool, 1.2)).toBe(true)
  })

  it('毒伤共用 8/s', () => {
    expect(POISON_DPS).toBe(8)
  })
})
