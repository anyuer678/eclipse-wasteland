import { describe, it, expect } from 'vitest'
import { applyHudFrame } from '../src/shell/hudUpdate'
import type { HudView } from '../src/shell/hud'

const fakeHud = () => {
  const calls: string[] = []
  const hud = {
    update: () => calls.push('update'),
    setSpread: (p: number) => calls.push(`spread:${p}`),
    boss: (n: string, pct: number) => calls.push(`boss:${n}:${pct}`),
    hideBoss: () => calls.push('hideBoss'),
  } as unknown as HudView
  return { hud, calls }
}

const data = { hp: 100 } as Parameters<HudView['update']>[0]

describe('applyHudFrame', () => {
  it('开火时张开准星，BOSS 存活时按百分比更新血条', () => {
    const f = fakeHud()
    applyHudFrame(f.hud, data, true, { name: '峡谷领主', hp: 150, maxHp: 300 })
    expect(f.calls).toEqual(['update', 'spread:0.5', 'boss:峡谷领主:50'])
  })

  it('无 BOSS 时隐藏血条，且百分比下限为 0', () => {
    const f = fakeHud()
    applyHudFrame(f.hud, data, false, null)
    expect(f.calls).toEqual(['update', 'spread:0', 'hideBoss'])

    const g = fakeHud()
    applyHudFrame(g.hud, data, false, { name: '塔主', hp: -5, maxHp: 600 })
    expect(g.calls).toContain('boss:塔主:0')
  })
})
