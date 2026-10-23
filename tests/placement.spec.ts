import { describe, it, expect } from 'vitest'
import { createPlacement } from '../src/campaign/placement'

const anchors = [
  { x: 20, z: 0 },
  { x: 0, z: 20 },
  { x: -20, z: 0 },
]

const make = (over: Partial<Parameters<typeof createPlacement>[0]> = {}) => {
  const calls: { cx: number; cz: number; minR: number; maxR: number; minGap: number }[] = []
  const dec = createPlacement({
    nav: {
      findSpawnPoint: (_r, cx, cz, minR, maxR, _placed, minGap = 1.4) => {
        calls.push({ cx, cz, minR, maxR, minGap })
        return { x: cx, y: 0, z: cz }
      },
    },
    anchors: () => anchors,
    rng: () => 0.5,
    player: () => ({ x: 0, z: 0 }),
    ...over,
  })
  return { dec, calls }
}

describe('createPlacement', () => {
  it('每 3 只轮换一个锚点，回退时用玩家位置', () => {
    const { dec, calls } = make()
    const a = dec.place('chaser', 0, 3, [])
    dec.place('chaser', 1, 3, [])
    dec.place('chaser', 2, 3, [])
    const b = dec.place('chaser', 3, 3, [])
    expect(a).toMatchObject({ x: 20, z: 0 })
    expect(b).toMatchObject({ x: 0, z: 20 })
    expect(calls[0]).toMatchObject({ cx: 20, cz: 0, minR: 0.6, maxR: 4.5 })
  })

  it('锚点落点距玩家过近时回退到常规环（14–26m）', () => {
    const { dec, calls } = make({
      nav: {
        findSpawnPoint: (_r, cx, cz, minR, maxR, _p, minGap = 1.4) => {
          calls.push({ cx, cz, minR, maxR, minGap })
          if (cx !== 0 || cz !== 0) return { x: 1, y: 0, z: 0 } // 距玩家 1m，被拒
          return { x: 0, y: 0, z: 20 }
        },
      },
    })
    const spot = dec.place('chaser', 0, 3, [])
    expect(spot).toMatchObject({ x: 0, z: 20 })
    expect(calls.map((c) => [c.cx, c.cz])).toEqual([
      [20, 0],
      [0, 0],
    ])
    expect(calls[1]).toMatchObject({ minR: 14, maxR: 26 })
  })

  it('显式 center（BOSS/宝箱等）跳过锚点，并沿用自定义 min/max', () => {
    const { dec, calls } = make()
    dec.place('spitter', 0, 1, [], { center: { x: 5, z: -5 }, placeMin: 9, placeMax: 16 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ cx: 5, cz: -5, minR: 9, maxR: 16 })
  })

  it('自爆虫使用更大的落点间距，reset 后锚点从头轮换', () => {
    const { dec, calls } = make()
    dec.place('boomer', 0, 1, [])
    expect(calls[0]!.minGap).toBe(2.2)
    for (let i = 1; i < 4; i++) dec.place('chaser', i, 1, [])
    dec.reset()
    dec.place('chaser', 0, 1, [])
    expect(calls[3]).toMatchObject({ cx: 0, cz: 20 })
    expect(calls[4]).toMatchObject({ cx: 20, cz: 0 })
  })
})
