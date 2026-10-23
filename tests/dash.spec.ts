import { describe, it, expect } from 'vitest'
import { dashStep } from '../src/play/dash'
import type { DashPoint } from '../src/play/dash'

const flat = () => 0
const body = (x = 0, z = 0): { position: DashPoint; collide: (p: DashPoint) => void } => ({
  position: { x, y: 0, z },
  collide: () => {},
})

describe('dashStep', () => {
  it('平地向前冲 6m（yaw=0 朝 -z）', () => {
    const b = body()
    const moved = dashStep(b, 0, { arenaRadius: 52, terrainHeightAt: flat })
    expect(moved).toBeCloseTo(6)
    expect(b.position.x).toBeCloseTo(0)
    expect(b.position.z).toBeCloseTo(-6)
  })

  it('撞墙立即停：collide 把 x 推回起点', () => {
    const b = body()
    b.collide = (p) => {
      p.x = 0
    }
    const moved = dashStep(b, -Math.PI / 2, { arenaRadius: 52, terrainHeightAt: flat })
    expect(moved).toBeLessThan(0.25)
  })

  it('高台阶不上去，低台阶自动抬升', () => {
    const high = body()
    const m1 = dashStep(high, 0, { arenaRadius: 52, terrainHeightAt: (x, z) => (z < -0.5 ? 1 : 0) })
    expect(m1).toBeLessThanOrEqual(0.5)

    const low = body()
    dashStep(low, 0, { arenaRadius: 52, terrainHeightAt: (x, z) => (z < -1 ? 0.3 : 0) })
    expect(low.position.y).toBeCloseTo(0.3)
  })

  it('不越过竞技场边界', () => {
    const b = body(50, 0)
    const moved = dashStep(b, -Math.PI / 2, { arenaRadius: 52, terrainHeightAt: flat })
    expect(moved).toBeLessThanOrEqual(1.5 + 1e-6)
    expect(Math.hypot(b.position.x, b.position.z)).toBeLessThanOrEqual(51.5)
  })
})
