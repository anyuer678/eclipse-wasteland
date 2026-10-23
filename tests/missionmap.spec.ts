import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { CRATE_HP, rebuildMissionMap } from '../src/campaign/missionMap'
import type { World } from '../src/render/world'

const fakeWorld = () => {
  const removed: THREE.Object3D[] = []
  const built: { mapId: string; variant: number }[] = []
  const mapRoot = new THREE.Group()
  mapRoot.userData.spawnAnchors = [{ x: 3, z: 4 }]
  const crateGroup = new THREE.Group()
  crateGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  crateGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  mapRoot.userData.crateGroup = crateGroup
  const obstacle = { x: 1, z: 2, hw: 0.5, hd: 0.5, top: 0.6 }
  mapRoot.userData.crates = [
    { x: 1, z: 2, obstacle },
    { x: 5, z: 6 },
  ]
  const world = {
    scene: { remove: (o: THREE.Object3D) => removed.push(o) },
    buildMap: (mapId: string, variant: number) => {
      built.push({ mapId, variant })
      return mapRoot
    },
  } as unknown as World
  return { world, removed, built, mapRoot }
}

describe('rebuildMissionMap', () => {
  it('使用任务变体建图并读取锚点/木箱配置', () => {
    const f = fakeWorld()
    const r = rebuildMissionMap(f.world, 'canyon', 7, null)
    expect(f.built).toEqual([{ mapId: 'canyon', variant: 7 }])
    expect(r.mapRoot).toBe(f.mapRoot)
    expect(r.spawnAnchors).toEqual([{ x: 3, z: 4 }])
    expect(r.crates).toHaveLength(2)
    expect(r.crates[0]).toMatchObject({ x: 1, z: 2, hp: CRATE_HP, alive: true, obstacle: { top: 0.6 } })
    expect(r.crates[0]!.mesh?.isMesh).toBe(true)
    expect(r.crates[1]!.obstacle).toBeUndefined()
  })

  it('有上一张地图时先从场景移除并释放', () => {
    const f = fakeWorld()
    const prev = new THREE.Group()
    rebuildMissionMap(f.world, 'lab', 0, prev)
    expect(f.removed).toEqual([prev])
  })
})
