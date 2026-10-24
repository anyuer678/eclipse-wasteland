import { describe, it, expect } from 'vitest'
import { WEAKPOINT_MULT, weakpointFromAim, weakpointMultiplier } from '../src/play/weakpoint'

describe('weakpointMultiplier', () => {
  it('瞄准高度高于中心 0.35m 起算弱点，倍率 1.5', () => {
    expect(weakpointMultiplier(2.6, 2.2)).toBe(WEAKPOINT_MULT)
    expect(weakpointMultiplier(2.5, 2.2)).toBe(1)
    expect(weakpointMultiplier(0.9, 0.9)).toBe(1)
  })
})

describe('weakpointFromAim', () => {
  const origin = { x: 0, y: 1.6, z: 0 }
  const center = { x: 0, y: 2.2, z: 4 }

  it('朝上瞄准中心平面时判定弱点', () => {
    // 方向：4m 处抬高到 2.9m
    const dir = { x: 0, y: 1.3, z: 4 }
    const len = Math.hypot(dir.x, dir.y, dir.z)
    expect(weakpointFromAim(origin, { x: 0, y: dir.y / len, z: dir.z / len }, center)).toBe(WEAKPOINT_MULT)
  })

  it('平瞄/下压不判定；背向目标也不误判', () => {
    expect(weakpointFromAim(origin, { x: 0, y: 0, z: 1 }, center)).toBe(1)
    expect(weakpointFromAim(origin, { x: 0, y: -0.3, z: 0.95 }, center)).toBe(1)
    expect(weakpointFromAim(origin, { x: 0, y: 1, z: 0 }, center)).toBe(1)
  })
})
