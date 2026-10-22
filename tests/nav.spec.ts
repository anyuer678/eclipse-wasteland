import { describe, expect, it } from 'vitest'
import { NavField } from '../src/horde/nav'
import type { NavObstacle } from '../src/horde/nav'
import { overlapDepth, separationDelta, stepVertical } from '../src/horde/motion'

const field = (obstacles: NavObstacle[], heightAt: (x: number, z: number) => number = () => 0): NavField => {
  const nav = new NavField()
  nav.build(obstacles, heightAt, { minX: -12, maxX: 12, minZ: -12, maxZ: 12, cell: 0.5, agentRadius: 0.3, stepHeight: 0.45, walkRadius: 11.5 })
  return nav
}

/** 沿导航方向走直线，返回是否最终到达目标（不处理碰撞，只验证流场方向） */
const walkWithNav = (nav: NavField, startX: number, startZ: number, targetX: number, targetZ: number, steps = 800): { x: number; z: number; path: [number, number][] } => {
  let x = startX
  let z = startZ
  const out = { x: 0, z: 0 }
  const path: [number, number][] = [[x, z]]
  for (let i = 0; i < steps; i++) {
    nav.updateTarget(targetX, targetZ)
    if (!nav.steer(x, z, 0, out)) break
    x += out.x * 0.08
    z += out.z * 0.08
    path.push([x, z])
    if (Math.hypot(targetX - x, targetZ - z) < 0.2) break
  }
  return { x, z, path }
}

describe('horde/nav', () => {
  it('routes around a wall instead of pushing into it', () => {
    // 一堵 6m 长、2m 宽的墙横在 (0,0) 与目标之间
    const wall: NavObstacle = { x: 0, z: 0, hw: 1, hd: 3, top: 2 }
    const nav = field([wall])
    const { x, z, path } = walkWithNav(nav, -5, 0, 5, 0)
    expect(Math.hypot(x - 5, z - 0)).toBeLessThan(0.5)
    // 路径必须绕过 z ±(3+agentRadius)，不能穿墙
    for (const [px, pz] of path) {
      const inside = Math.abs(px - wall.x) < wall.hw && Math.abs(pz - wall.z) < wall.hd
      expect(inside).toBe(false)
    }
    expect(Math.max(...path.map(([, pz]) => Math.abs(pz)))).toBeGreaterThan(3)
  })

  it('walks up a platform via a ramp but not through the platform side', () => {
    // 平台 x∈[2,4], z∈[-2,2]，高 1.2；斜坡 x∈[0,2]，从 0 线性抬到 1.2
    const heightAt = (x: number, z: number): number => {
      if (x >= 2 && x <= 4 && z >= -2 && z <= 2) return 1.2
      if (x >= 0 && x < 2 && z >= -2 && z <= 2) return x * 0.6
      return 0
    }
    const platform: NavObstacle = { x: 3, z: 0, hw: 1, hd: 2, top: 1.26 }
    const nav = field([platform], heightAt)
    nav.updateTarget(3, 0)
    // 有斜坡时可达
    expect(nav.reachable(0, 0)).toBe(true)
    expect(nav.steer(0, 0, 0, { x: 0, z: 0 })).toBe(true)
    const withRamp = walkWithNav(nav, 0, 0, 3, 0, 1200)
    expect(Math.hypot(withRamp.x - 3, withRamp.z)).toBeLessThan(0.5)

    // 去掉斜坡后，平台侧面不可攀爬，目标不可达
    const noRamp = field([platform], (x, z) => (x >= 2 && x <= 4 && z >= -2 && z <= 2 ? 1.2 : 0))
    noRamp.updateTarget(3, 0)
    expect(noRamp.reachable(0, 0)).toBe(false)
  })

  it('a crate fills a wall gap; removing it opens the line', () => {
    // 两道墙留出 1.2m 缺口，木箱正好堵住缺口
    const walls: NavObstacle[] = [
      { x: 0, z: -3.3, hw: 0.2, hd: 2.7, top: 2 },
      { x: 0, z: 3.3, hw: 0.2, hd: 2.7, top: 2 },
    ]
    const crate: NavObstacle = { x: 0, z: 0, hw: 0.6, hd: 0.6, top: 0.8, crate: true }
    const blocked = field([...walls, crate])
    expect(blocked.lineClear(-5, 0, 5, 0, 0, 0)).toBe(false)
    const opened = field(walls)
    expect(opened.lineClear(-5, 0, 5, 0, 0, 0)).toBe(true)
  })

  it('does not connect a 1.2m cliff when there is no ramp', () => {
    // 无碰撞体，但东侧地面整体抬高 1.2m：流场不能把单位导上悬崖
    const nav = field([], (x) => (x >= 2 ? 1.2 : 0))
    nav.updateTarget(3, 0)
    expect(nav.isWalkable(1.5, 0)).toBe(true)
    expect(nav.reachable(1.5, 0)).toBe(false)
    expect(nav.reachable(2.5, 0)).toBe(true)
  })

  it('blocks a thin wall on a long ray (no sampling gaps)', () => {
    // 0.1m 薄墙，位于固定 14 步采样的空档上；精确求交必须挡住
    const thin: NavObstacle = { x: 0.7, z: 0, hw: 0.05, hd: 2, top: 2.5 }
    const nav = field([thin])
    expect(nav.hasLineOfSight3D(-10, 1.2, 0, 10, 1.2, 0)).toBe(false)
    // 从墙的侧面绕过去则可见
    expect(nav.hasLineOfSight3D(-10, 1.2, 3, 10, 1.2, 3)).toBe(true)
  })

  it('uses 3D line of sight so low cover does not block chest-height shots', () => {
    const lowWall: NavObstacle = { x: 0, z: 0, hw: 0.5, hd: 2, top: 0.9 }
    const tallWall: NavObstacle = { x: 0, z: 0, hw: 0.5, hd: 2, top: 2.5 }
    const low = field([lowWall])
    const tall = field([tallWall])
    // 胸口高度射线越过 0.9m 掩体
    expect(low.hasLineOfSight3D(-3, 1.3, 0, 3, 1.3, 0)).toBe(true)
    // 蹲下高度射线被挡住
    expect(low.hasLineOfSight3D(-3, 0.5, 0, 3, 0.5, 0)).toBe(false)
    // 高墙挡胸口高度
    expect(tall.hasLineOfSight3D(-3, 1.3, 0, 3, 1.3, 0)).toBe(false)
  })

  it('terrain hills block line of sight and rays (no shooting through slopes)', () => {
    // 半径 4m、高 3m 的圆锥土丘，其余为平地
    const hill = (x: number, z: number): number => Math.max(0, 3 * (1 - Math.hypot(x, z) / 4))
    const nav = field([], hill)
    // 两侧地面的人互相看不见（旧实现只看 AABB，会隔山对射）
    expect(nav.hasLineOfSight3D(-6, 1.2, 0, 6, 1.2, 0)).toBe(false)
    // 从山脚看山顶可见（视线贴着坡面往上）
    expect(nav.hasLineOfSight3D(6, 1.2, 0, 0, 4.2, 0)).toBe(true)
    // 绕开土丘、从足够高处越过则不遮挡
    expect(nav.hasLineOfSight3D(-6, 1.2, 6, 6, 1.2, 6)).toBe(true)
    expect(nav.hasLineOfSight3D(-6, 5.2, 0, 6, 5.2, 0)).toBe(true)
    // 射线截断：从一侧射向另一侧，命中点落在土丘表面而不是穿过去
    const t = nav.terrainRayDistance(-6, 1.2, 0, 6, 1.2, 0)
    expect(t).not.toBeNull()
    expect(t as number).toBeGreaterThan(2)
    expect(t as number).toBeLessThan(5)
  })

  it('spawn points are walkable and stay in the requested ring', () => {
    const nav = field([{ x: 0, z: 0, hw: 3, hd: 3, top: 3 }], (x, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 ? 3 : 0))
    let seed = 12345
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const placed: { x: number; z: number; r: number }[] = []
    for (let i = 0; i < 8; i++) {
      const p = nav.findSpawnPoint(random, 0, 6, 4, 9, placed, 1)
      expect(p).not.toBeNull()
      if (!p) continue
      expect(nav.isWalkable(p.x, p.z)).toBe(true)
      expect(Math.hypot(p.x - 0, p.z - 6)).toBeGreaterThanOrEqual(4 - 1e-6)
      expect(Math.hypot(p.x - 0, p.z - 6)).toBeLessThanOrEqual(9 + 1e-6)
      placed.push({ x: p.x, z: p.z, r: 0.5 })
    }
  })
})

describe('horde/motion', () => {
  it('follows ramps up and down but never teleports onto a high ledge', () => {
    const body = { y: 0, vy: 0, grounded: true }
    stepVertical(body, 0.2, 1 / 60)
    expect(body.y).toBeCloseTo(0.2)
    expect(body.grounded).toBe(true)

    // 高台侧壁（从脚下 0.2 到 1.4）：不抬升
    stepVertical(body, 1.4, 1 / 60)
    expect(body.y).toBeCloseTo(0.2)
    expect(body.grounded).toBe(true)

    // 站上 1.2m 平台后从边缘走空：进入下落
    body.y = 1.2
    stepVertical(body, 0, 1 / 60)
    expect(body.grounded).toBe(false)
    for (let i = 0; i < 300 && !body.grounded; i++) stepVertical(body, 0, 1 / 60)
    expect(body.grounded).toBe(true)
    expect(body.y).toBeCloseTo(0)
  })

  it('separates overlapping enemies symmetrically', () => {
    const out = { x: 0, z: 0 }
    expect(separationDelta(0, 0, 0.5, 0.2, 0, 0.5, out, 0)).toBe(true)
    expect(out.x).toBeLessThan(-0.2)
    expect(Math.abs(out.z)).toBeLessThan(1e-9)
    expect(overlapDepth(0, 0, 0.5, 0.2, 0, 0.5)).toBeCloseTo(0.8)
    // 完全重合也要给出确定方向，避免 NaN
    const same = { x: 0, z: 0 }
    expect(separationDelta(1, 1, 0.5, 1, 1, 0.5, same, 1.2)).toBe(true)
    expect(Number.isFinite(same.x)).toBe(true)
    expect(Number.isFinite(same.z)).toBe(true)
  })
})
