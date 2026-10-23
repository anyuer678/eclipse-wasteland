import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { mountEnvModels } from '../src/render/envMount'
import { ENV_MODELS, ENV_TINT } from '../src/render/envConfig'
import type { EnvPlacement } from '../src/render/envMount'

const harness = () => {
  const mapRoot = new THREE.Group()
  mapRoot.userData.heightfield = () => 5
  const loaded: { name: string; done: (src: THREE.Group) => void }[] = []
  const calls: { placements: EnvPlacement[]; tint: number }[] = []
  const ref = { current: null as THREE.Group | null }
  return {
    mapRoot,
    loaded,
    calls,
    ref,
    assets: { load: (name: string, done: (src: THREE.Group) => void) => loaded.push({ name, done }) },
    addProps: (_parent: THREE.Object3D, _src: THREE.Object3D, placements: EnvPlacement[], tint: number) => {
      calls.push({ placements, tint })
    },
  }
}

describe('mountEnvModels', () => {
  it('无环境配置的地图返回 null 且不加载素材', () => {
    const h = harness()
    const g = mountEnvModels({ mapRoot: h.mapRoot, mapId: 'nope', assets: h.assets, addProps: h.addProps, ref: h.ref })
    expect(g).toBeNull()
    expect(h.loaded).toHaveLength(0)
  })

  it('按高度场落点、使用地图色，所有大件都在外圈', () => {
    const h = harness()
    const g = mountEnvModels({ mapRoot: h.mapRoot, mapId: 'facility', assets: h.assets, addProps: h.addProps, ref: h.ref })
    expect(g).not.toBeNull()
    const specs = ENV_MODELS['facility']!
    expect(h.loaded.map((l) => l.name)).toEqual(specs.map((s) => s.name))
    h.loaded.forEach((l, i) => {
      l.done(new THREE.Group())
      const spec = specs[i]!
      const call = h.calls[i]!
      expect(call.tint).toBe(ENV_TINT['facility'])
      for (const p of call.placements) {
        expect(p.y).toBeCloseTo(5 + spec.y)
        if (spec.scale[1] > 1.6) expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(17)
      }
    })
  })

  it('切图后过期的异步回调被丢弃', () => {
    const h = harness()
    mountEnvModels({ mapRoot: h.mapRoot, mapId: 'facility', assets: h.assets, addProps: h.addProps, ref: h.ref })
    h.ref.current = new THREE.Group() // 模拟已切到新关卡
    h.loaded.forEach((l) => l.done(new THREE.Group()))
    expect(h.calls).toHaveLength(0)
  })
})
