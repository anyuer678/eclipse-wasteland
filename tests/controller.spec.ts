import { describe, expect, it } from 'vitest'
import { PlayerController } from '../src/play/controller'
import type { InputSnapshot } from '../src/play/input'

const makeInput = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  fire: false,
  altFire: false,
  skill: false,
  key: () => false,
  ...over,
})

const make = (terrainHeight: (x: number, z: number) => number): PlayerController => {
  const c = new PlayerController({
    speed: 5.2,
    jumpSpeed: 6.6,
    gravity: 16,
    eyeHeight: 1.6,
    boundRadius: 38,
    terrainHeight,
  })
  c.yaw = Math.PI / 2 // 面朝 -x
  c.position.set(0, 0, 0)
  c.onGround = true
  return c
}

describe('play/controller movement', () => {
  it('does not walk up a 1.2m ledge from the side', () => {
    const c = make((x) => (x < -2 ? 1.2 : 0))
    const input = makeInput({ forward: true })
    for (let i = 0; i < 180; i++) c.update(input, 1 / 60)
    expect(c.position.x).toBeGreaterThan(-2.05)
    expect(Math.abs(c.position.y)).toBeLessThan(0.02)
  })

  it('walks up a gentle 0.6 slope', () => {
    const height = (x: number): number => (x >= 0 ? 0 : x <= -2 ? 1.2 : -x * 0.6)
    const c = make((x) => height(x))
    const input = makeInput({ forward: true })
    for (let i = 0; i < 90; i++) c.update(input, 1 / 60)
    expect(c.position.x).toBeLessThan(-2)
    expect(c.position.y).toBeGreaterThan(1.15)
  })

  it('can jump onto a 1.2m ledge', () => {
    const c = make((x) => (x < -2 ? 1.2 : 0))
    for (let i = 0; i < 180; i++) {
      c.update(makeInput({ forward: true, jump: i < 5 }), 1 / 60)
    }
    expect(c.position.x).toBeLessThan(-2)
    expect(c.position.y).toBeCloseTo(1.2)
    expect(c.onGround).toBe(true)
  })
})
