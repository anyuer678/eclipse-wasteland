import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildChestMesh, buildOrbMesh, buildRoleRing, buildSummonMesh } from '../src/render/lootModels'

describe('lootModels', () => {
  it('BUFF 球核心悬浮在 y=0.9', () => {
    const g = buildOrbMesh(0xffd24a)
    expect(g.children).toHaveLength(1)
    expect(g.children[0]!.position.y).toBe(0.9)
  })

  it('宝箱由箱体/盖/亮点组成，大箱使用金色材质', () => {
    const small = buildChestMesh(false)
    const big = buildChestMesh(true)
    expect(small.children).toHaveLength(3)
    const smallMat = (small.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    const bigMat = (big.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(smallMat.color.getHex()).toBe(0x8a7a5a)
    expect(bigMat.color.getHex()).toBe(0xd9a44a)
  })

  it('召唤物标记 userData.summon，角色环放平且半透明', () => {
    const summon = buildSummonMesh(0x66e0ff)
    expect(summon.userData.summon).toBe(true)
    const ring = buildRoleRing(0xff5522, 0.2, 2.4)
    expect(ring.rotation.x).toBeCloseTo(-Math.PI / 2)
    const mat = ring.material as THREE.MeshBasicMaterial
    expect(mat.opacity).toBeCloseTo(0.35)
    expect(mat.depthWrite).toBe(false)
  })
})
