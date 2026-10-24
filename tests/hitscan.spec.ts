import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { castHitscan } from '../src/play/hitscan'
import type { HitscanUnit } from '../src/play/hitscan'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const noTerrain = () => null

const unit = (x: number, y: number, z: number, alive = true): HitscanUnit => ({
  alive,
  centerInto: (out) => out.set(x, y, z),
})

const base = (over: Partial<Parameters<typeof castHitscan>[0]> = {}) => ({
  origin: v(0, 1, 0),
  dir: v(0, 0, 1),
  obstacles: [],
  terrainRay: noTerrain,
  crates: [],
  barrels: [],
  enemies: [],
  boss: null,
  ...over,
})

describe('castHitscan', () => {
  it('命中最近敌人，空中无遮挡时返回敌人交点', () => {
    const r = castHitscan(base({ enemies: [unit(0, 1, 5), unit(0, 1, 9)] }))
    expect(r.point.z).toBeCloseTo(3.9)
    expect(r.terrainSurface).toBe(false)
  })

  it('墙体先于敌人命中：不穿墙打人', () => {
    const wall = { x: 0, z: 3, hw: 1, hd: 0.5, top: 2 }
    const r = castHitscan(base({ obstacles: [wall], enemies: [unit(0, 1, 9)] }))
    expect(r.point.z).toBeCloseTo(2.5)
    expect(r.terrainSurface).toBe(false)
  })

  it('地形比敌人更近时标记 terrainSurface', () => {
    const r = castHitscan(base({ terrainRay: () => 2, enemies: [unit(0, 1, 9)] }))
    expect(r.point.z).toBeCloseTo(2)
    expect(r.terrainSurface).toBe(true)
  })

  it('无单位时沿地面求交并标记 terrainSurface', () => {
    const r = castHitscan(base({ origin: v(0, 1, 0), dir: v(0, -0.5, 1).normalize() }))
    expect(r.point.y).toBeCloseTo(0)
    expect(r.point.z).toBeCloseTo(2)
    expect(r.terrainSurface).toBe(true)
  })

  it('死亡的木箱/敌人跳过，BOSS 半径更大', () => {
    const crate = { x: 0, z: 4, alive: false }
    const dead = unit(0, 1, 4, false)
    const r = castHitscan(base({ crates: [crate], enemies: [dead], boss: unit(0, 1, 20) }))
    expect(r.point.z).toBeCloseTo(16.8) // 20 - 3.2
    expect(r.terrainSurface).toBe(false)
  })

  it('爆炸桶可被命中，死桶跳过', () => {
    const barrel = { x: 0, z: 5, alive: true }
    const r = castHitscan(base({ barrels: [barrel] }))
    expect(r.point.z).toBeGreaterThan(4) // 命中桶前表面（圆心 z=5, r=0.9 → ≥4.1）
    expect(r.point.z).toBeLessThan(5)
    const dead = { x: 0, z: 5, alive: false }
    const r2 = castHitscan(base({ barrels: [dead] }))
    expect(r2.point.z).toBeCloseTo(60) // 射程尽头
  })

  it('前方无命中且不朝下时返回射程点', () => {
    const dir = v(0, 0.1, 1).normalize()
    const r = castHitscan(base({ dir }))
    expect(r.point.z).toBeCloseTo(dir.z * 60)
    expect(r.terrainSurface).toBe(false)
  })
})
