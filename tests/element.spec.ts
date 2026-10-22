import { describe, expect, it } from 'vitest'
import { Enemy, ENEMY_DEFS } from '../src/horde'

const rng = { range: (a: number, _b: number) => a }

describe('horde/elemental damage', () => {
  it('applies elemental resistance to direct damage', () => {
    const chaser = new Enemy(ENEMY_DEFS.chaser, rng)
    const chaserHp = chaser.hp
    chaser.takeDamage(100, 'fire')
    expect(chaser.hp).toBeCloseTo(chaserHp - 100)

    // 爆虫火抗 2（-35%）
    const boomer = new Enemy(ENEMY_DEFS.boomer, rng)
    const boomerHp = boomer.hp
    boomer.takeDamage(100, 'fire')
    expect(boomer.hp).toBeCloseTo(boomerHp - 65)
  })

  it('burn ticks are fire damage', () => {
    const boomer = new Enemy(ENEMY_DEFS.boomer, rng)
    const hp = boomer.hp
    boomer.applyBurn(1, 100)
    boomer.tickBurn(0.1)
    expect(boomer.hp).toBeCloseTo(hp - 10 * 0.65)
  })
})
