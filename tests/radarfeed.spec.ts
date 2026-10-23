import { describe, it, expect } from 'vitest'
import { drawRadar } from '../src/shell/radarFeed'
import type { RadarDeps } from '../src/shell/radarFeed'
import type { Radar } from '../src/shell/radar'

const fakeRadar = () => {
  const calls: string[] = []
  const dots: string[] = []
  const radar = {
    begin: (x: number, z: number, yaw: number) => calls.push(`begin:${x},${z},${yaw}`),
    dot: (x: number, z: number, color: string, size: number) => dots.push(`${x},${z},${color},${size}`),
    end: () => calls.push('end'),
  } as unknown as Radar
  return { radar, calls, dots }
}

const deps = (over: Partial<RadarDeps> = {}): RadarDeps => ({
  radar: fakeRadar().radar,
  playerX: 1,
  playerZ: 2,
  yaw: 0.5,
  enemies: [],
  boss: null,
  crates: [],
  chests: [],
  orbs: [],
  poisonPools: [],
  ...over,
})

describe('drawRadar', () => {
  it('绘制顺序 begin → 实体点 → end，并跳过死亡敌人/木箱', () => {
    const f = fakeRadar()
    const r = deps({
      radar: f.radar,
      enemies: [
        { alive: true, root: { position: { x: 3, z: 4 } }, def: { color: 0xff0000 } },
        { alive: false, root: { position: { x: 9, z: 9 } }, def: { color: 0x00ff00 } },
      ],
      boss: { alive: false, root: { position: { x: 5, z: 5 } } },
      crates: [
        { alive: true, x: 6, z: 7 },
        { alive: false, x: 8, z: 8 },
      ],
      chests: [{ mesh: { position: { x: 1, z: 1 } } }],
      orbs: [{ mesh: { position: { x: 2, z: 2 } } }],
      poisonPools: [{ x: 10, z: 11 }],
    })
    drawRadar(r)
    expect(f.calls).toEqual(['begin:1,2,0.5', 'end'])
    expect(f.dots).toEqual([
      '3,4,#ff0000,3',
      '6,7,#d9a44a,2',
      '1,1,#ffe9a8,3',
      '2,2,#66d9ff,2',
      '10,11,rgba(62,160,85,0.85),4',
    ])
  })

  it('BOSS 存活时以更大的橙色点标出', () => {
    const f = fakeRadar()
    drawRadar(deps({ radar: f.radar, boss: { alive: true, root: { position: { x: 20, z: 21 } } } }))
    expect(f.dots).toEqual(['20,21,#ff4400,5'])
  })
})
