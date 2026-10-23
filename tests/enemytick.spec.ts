import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { tickEnemies } from '../src/play/enemyTick'
import type { EnemyTickDeps, EnemyTickEnemy, EnemyTickEvent } from '../src/play/enemyTick'

interface Rec {
  flash: number
  elite: number
  corpse: number
  updates: number
  died: boolean
  healed: number
}

const makeEnemy = (over: Partial<EnemyTickEnemy> & { rec?: Rec; burn?: boolean; event?: EnemyTickEvent | null } = {}) => {
  const rec: Rec = over.rec ?? { flash: 0, elite: 0, corpse: 0, updates: 0, died: false, healed: 0 }
  const e: EnemyTickEnemy = {
    alive: true,
    hp: 10,
    root: { position: new THREE.Vector3(0, 0, 0) },
    def: { hp: 10, kind: 'chaser', blastRadius: 0 },
    updateFlash: () => rec.flash++,
    tickElite: () => rec.elite++,
    tickCorpse: () => rec.corpse++,
    tickBurn: () => !!over.burn,
    update: () => {
      rec.updates++
      return over.event ?? null
    },
    die: () => {
      rec.died = true
      e.alive = false
    },
    healBy: (n) => {
      rec.healed += n
      e.hp += n
    },
    ...over,
  }
  return { e, rec }
}

const deps = (over: Partial<EnemyTickDeps> = {}) => {
  const rec = {
    targets: [] as number[],
    hits: 0,
    shots: [] as { color: number; speed: number; to: THREE.Vector3 }[],
    kills: 0,
    popups: 0,
    shakes: 0,
    booms: 0,
    spits: 0,
    los: true,
  }
  const d: EnemyTickDeps = {
    nav: {
      updateTarget: () => {},
      hasLineOfSight3D: () => rec.los,
      steer: () => {},
    },
    playerPos: new THREE.Vector3(0, 0, 0),
    stealth: false,
    all: () => [],
    onKill: () => {
      rec.kills++
      return true
    },
    sfx: {
      boom: () => rec.booms++,
      spit: () => rec.spits++,
    },
    shake: () => rec.shakes++,
    damagePlayer: (n) => {
      rec.targets.push(n)
      return true
    },
    hudHit: () => rec.hits++,
    spawnProjectile: (_f, to, color, speed) => rec.shots.push({ color, speed, to }),
    clipProjectile: (_f, to) => to,
    popup: () => rec.popups++,
    ...over,
  }
  return { d, rec }
}

describe('tickEnemies', () => {
  it('燃烧死亡触发统一结算；升级暂停时中止后续敌人', () => {
    const a = makeEnemy({ burn: true })
    const b = makeEnemy()
    const { d, rec } = deps({ all: () => [a.e, b.e] })
    tickEnemies([a.e, b.e], 0.016, d)
    expect(rec.kills).toBe(1)
    expect(b.rec.updates).toBe(0)
  })

  it('隐身时只推进状态，不出手', () => {
    const a = makeEnemy({ event: { melee: 10 } })
    const { d, rec } = deps({ stealth: true, all: () => [a.e] })
    tickEnemies([a.e], 0.016, d)
    expect(a.rec.flash).toBe(1)
    expect(a.rec.updates).toBe(0)
    expect(rec.targets).toHaveLength(0)
  })

  it('近战按视线结算；自爆在遮挡时不掉血', () => {
    const melee = makeEnemy({ event: { melee: 12 } })
    const { d, rec } = deps({ all: () => [melee.e] })
    tickEnemies([melee.e], 0.016, d)
    expect(rec.targets).toEqual([12])
    expect(rec.hits).toBe(1)

    const blast = makeEnemy({ event: { blast: 30 } })
    const noLos = deps({ all: () => [blast.e] })
    noLos.rec.los = false
    tickEnemies([blast.e], 0.016, noLos.d)
    expect(blast.rec.died).toBe(true)
    expect(noLos.rec.targets).toHaveLength(0)
  })

  it('喷吐/弹幕走截断后的落点，炮台弹速更高', () => {
    const from = new THREE.Vector3(0, 1, 0)
    const to = new THREE.Vector3(0, 1, 5)
    const spit = makeEnemy({ event: { spit: { from, to, damage: 7 } } })
    const { d, rec } = deps({ all: () => [spit.e] })
    tickEnemies([spit.e], 0.016, d)
    expect(rec.shots[0]).toMatchObject({ color: 0x3fb96a, speed: 13 })

    const turret = makeEnemy({ event: { spit: { from, to, damage: 9 } }, def: { hp: 10, kind: 'turret', blastRadius: 0 } })
    const t = deps({ all: () => [turret.e] })
    tickEnemies([turret.e], 0.016, t.d)
    expect(t.rec.shots[0]).toMatchObject({ color: 0xd9c26a, speed: 16 })

    const caster = makeEnemy({ event: { cast: [{ from, to, damage: 4 }, { from, to, damage: 4 }] } })
    const c = deps({ all: () => [caster.e] })
    tickEnemies([caster.e], 0.016, c.d)
    expect(c.rec.shots).toHaveLength(2)
    expect(c.rec.shots[0]!.color).toBe(0xcc88ff)
  })

  it('治疗者只治疗 7m 内非满血友军并弹一次提示', () => {
    const healer = makeEnemy({ event: { heal: 12 }, root: { position: new THREE.Vector3(0, 0, 0) } })
    const hurt = makeEnemy({ hp: 5, root: { position: new THREE.Vector3(3, 0, 0) } })
    const full = makeEnemy({ root: { position: new THREE.Vector3(2, 0, 0) } })
    const far = makeEnemy({ hp: 1, root: { position: new THREE.Vector3(20, 0, 0) } })
    const { d, rec } = deps({ all: () => [healer.e, hurt.e, full.e, far.e] })
    tickEnemies([healer.e], 0.016, d)
    expect(hurt.rec.healed).toBe(12)
    expect(full.rec.healed).toBe(0)
    expect(far.rec.healed).toBe(0)
    expect(rec.popups).toBe(1)
  })
})
