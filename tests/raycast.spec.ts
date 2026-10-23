import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { clipToObstacles, pointOnObstacleSurface, rayAabbT, raySphere } from '../src/play/raycast'
import type { NavObstacle } from '../src/horde/nav'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const noTerrain = () => null

const wall = (over: Partial<NavObstacle> = {}): NavObstacle => ({ x: 0, z: 5, hw: 1, hd: 0.5, top: 2, ...over })

describe('raySphere', () => {
  it('命中时返回近交点距离，且不返回负距离', () => {
    expect(raySphere(v(0, 0, 0), v(0, 0, 1), v(0, 0, 5), 1)).toBeCloseTo(4)
    // 起点在球内：近交点为负，视为不命中
    expect(raySphere(v(0, 0, 5), v(0, 0, 1), v(0, 0, 5), 1)).toBeNull()
  })

  it('偏离射线返回 null', () => {
    expect(raySphere(v(0, 0, 0), v(0, 0, 1), v(0, 3, 5), 1)).toBeNull()
  })
})

describe('rayAabbT', () => {
  it('命中盒体时返回进入距离', () => {
    const t = rayAabbT(v(0, 1, 0), v(0, 0, 1), -1, 1, 0, 2, 4, 6, 100)
    expect(t).toBeCloseTo(4)
  })

  it('平行于面且在外侧、或超出 maxT 返回 null', () => {
    expect(rayAabbT(v(5, 1, 0), v(0, 0, 1), -1, 1, 0, 2, 4, 6, 100)).toBeNull()
    expect(rayAabbT(v(0, 1, 0), v(0, 0, 1), -1, 1, 0, 2, 4, 6, 2)).toBeNull()
  })

  it('起点在盒内返回 0', () => {
    expect(rayAabbT(v(0, 1, 5), v(0, 0, 1), -1, 1, 0, 2, 4, 6, 100)).toBe(0)
  })
})

describe('pointOnObstacleSurface', () => {
  it('命中侧面、顶面算表面，盒外/盒内不算', () => {
    expect(pointOnObstacleSurface(v(1, 1, 5), [wall()])).toBe(true)
    expect(pointOnObstacleSurface(v(0, 2, 5), [wall()])).toBe(true)
    expect(pointOnObstacleSurface(v(0, 1, 5), [wall()])).toBe(false)
    expect(pointOnObstacleSurface(v(1.5, 1, 5), [wall()])).toBe(false)
  })

  it('木箱不吞伤害', () => {
    expect(pointOnObstacleSurface(v(1, 1, 5), [wall({ crate: true })])).toBe(false)
  })
})

describe('clipToObstacles', () => {
  it('被墙体截断时返回墙面点', () => {
    const from = v(0, 1, 0)
    const to = v(0, 1, 10)
    const hit = clipToObstacles(from, to, [wall()], noTerrain)
    expect(hit.z).toBeCloseTo(4.5)
  })

  it('无遮挡返回原点，地形更近时也截断', () => {
    const from = v(5, 1, 0)
    const to = v(5, 1, 10)
    expect(clipToObstacles(from, to, [wall()], noTerrain)).toBe(to)
    const groundHit = clipToObstacles(v(0, 1, 0), v(0, 1, 10), [], () => 3)
    expect(groundHit.z).toBeCloseTo(3)
  })
})
