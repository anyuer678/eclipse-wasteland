import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { findNearestVisible, resolvePierceTargets } from '../src/play/targeting'
import type { PierceDeps, TargetEnemy } from '../src/play/targeting'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const enemy = (x: number, y: number, z: number, alive = true): TargetEnemy => ({
  alive,
  center: () => v(x, y, z),
})

const deps = (over: Partial<PierceDeps> = {}): PierceDeps => ({
  enemies: () => [],
  hasLineOfSight3D: () => true,
  obstacles: [],
  terrainRayDistance: () => null,
  ...over,
})

describe('findNearestVisible', () => {
  it('取范围内最近的可见目标', () => {
    const d = deps({ enemies: () => [enemy(0, 0, 8), enemy(0, 0, 4), enemy(0, 0, 30)] })
    expect(findNearestVisible(v(0, 0, 0), 10, d)!.z).toBe(4)
  })

  it('无视线或超范围/死亡目标跳过', () => {
    const d = deps({
      enemies: () => [enemy(0, 0, 4, false), enemy(0, 0, 5), enemy(0, 0, 2)],
      hasLineOfSight3D: (_ax, _ay, _az, bx) => bx !== 0, // 只有 x≠0 的可见
    })
    expect(findNearestVisible(v(0, 0, 0), 10, d)).toBeNull()
    expect(findNearestVisible(v(0, 0, 0), 3, deps({ enemies: () => [enemy(0, 0, 4)] }))).toBeNull()
  })
})

describe('resolvePierceTargets', () => {
  it('按距离排序并限制数量', () => {
    const d = deps({ enemies: () => [enemy(0, 0, 9), enemy(0, 0, 3), enemy(0, 0, 6)] })
    expect(resolvePierceTargets(v(0, 0, 0), v(0, 0, 1), 2, d).map((p) => p.z)).toEqual([3, 6])
  })

  it('墙体/地形截断：更远的目标不进入列表', () => {
    const wall = { x: 0, z: 5, hw: 1, hd: 0.5, top: 3 }
    const behind = deps({ obstacles: [wall], enemies: () => [enemy(0, 1, 3), enemy(0, 1, 8)] })
    expect(resolvePierceTargets(v(0, 1, 0), v(0, 0, 1), 2, behind).map((p) => p.z)).toEqual([3])

    const terrain = deps({ terrainRayDistance: () => 4, enemies: () => [enemy(0, 1, 3), enemy(0, 1, 9)] })
    expect(resolvePierceTargets(v(0, 1, 0), v(0, 0, 1), 2, terrain).map((p) => p.z)).toEqual([3])
  })

  it('死亡目标跳过', () => {
    const d = deps({ enemies: () => [enemy(0, 0, 3, false), enemy(0, 0, 5)] })
    expect(resolvePierceTargets(v(0, 0, 0), v(0, 0, 1), 2, d).map((p) => p.z)).toEqual([5])
  })
})
