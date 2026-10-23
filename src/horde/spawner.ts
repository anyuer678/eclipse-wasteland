/**
 * horde/spawner — 刷怪器。
 *
 * 阶段 4：简单刷怪（按波次定义一次刷一批，供验证战斗闭环）。
 * 阶段 5（campaign）将接管完整副本流程，此处的按波次刷怪逻辑
 * 会升级为"关卡定义驱动"。
 */
import * as THREE from 'three';
import { Rng } from '../core';
import { ENEMY_DEFS, Enemy, ELITE_AFFIXES } from './enemy';
import type { EliteAffix, EnemyKind } from './enemy';

export interface WaveSpec {
  chasers: number;
  boomers: number;
  spitters: number;
  guards?: number;
  berserkers?: number;
  casters?: number;
  healers?: number;
  turrets?: number;
}

export interface WaveOptions {
  /** 生命倍率（塔层数缩放） */
  hpMult?: number;
  /** 伤害倍率 */
  dmgMult?: number;
  /** 精英概率 0-1 */
  eliteChance?: number;
  /** 本波前 N 只强制为精英（0/1/2），用于波次保底 */
  eliteGuaranteed?: number;
  /** 怪物等级（等级压制 / 经验结算） */
  level?: number;
  /** 刷怪放置中心（默认由 game 侧决定，通常是玩家位置；BOSS 召唤传 BOSS 位置） */
  center?: { x: number; z: number };
  /** 相对放置中心的最小/最大距离 */
  placeMin?: number;
  placeMax?: number;
}

/** 刷怪落点选择器：由 game 用导航网格实现 */
export type SpawnPlacement = (
  kind: EnemyKind,
  index: number,
  total: number,
  placed: readonly { x: number; z: number; r: number }[],
  opts?: WaveOptions
) => { x: number; y: number; z: number } | null;

/** 第 i 只怪是否为精英：前 guaranteed 只必出，其余按概率；传入两次随机数便于单测 */
export function eliteFor(i: number, guaranteed: number, chance: number, roll: number, affixRoll: number): EliteAffix | undefined {
  const forced = i < Math.max(0, Math.floor(guaranteed));
  if (!forced && !(chance > 0 && roll < chance)) return undefined;
  const idx = Math.min(ELITE_AFFIXES.length - 1, Math.max(0, Math.floor(affixRoll * ELITE_AFFIXES.length)));
  return ELITE_AFFIXES[idx].kind;
}

export class Spawner {
  private rng: Rng;
  private world: THREE.Scene;
  private enemies: Enemy[] = [];
  /** 落点选择器（导航网格可用后由 game 注入） */
  private placement: SpawnPlacement | null = null;

  constructor(world: THREE.Scene, seed: number) {
    this.world = world;
    this.rng = new Rng(seed);
  }

  setPlacement(placement: SpawnPlacement | null): void {
    this.placement = placement;
  }

  spawnWave(spec: WaveSpec, opts?: WaveOptions): void {
    const kinds: EnemyKind[] = [
      ...Array<EnemyKind>(spec.chasers).fill('chaser'),
      ...Array<EnemyKind>(spec.boomers).fill('boomer'),
      ...Array<EnemyKind>(spec.spitters).fill('spitter'),
      ...Array<EnemyKind>(spec.guards ?? 0).fill('guard'),
      ...Array<EnemyKind>(spec.berserkers ?? 0).fill('berserker'),
      ...Array<EnemyKind>(spec.casters ?? 0).fill('caster'),
      ...Array<EnemyKind>(spec.healers ?? 0).fill('healer'),
      ...Array<EnemyKind>(spec.turrets ?? 0).fill('turret'),
    ];
    const placed: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const elite = eliteFor(
        i,
        opts?.eliteGuaranteed ?? 0,
        opts?.eliteChance ?? 0,
        this.rng.range(0, 1),
        this.rng.range(0, 1)
      );
      const e = new Enemy(ENEMY_DEFS[kind], this.rng, { hpMult: opts?.hpMult, dmgMult: opts?.dmgMult, elite, level: opts?.level });
      const spot = this.placement?.(kind, i, kinds.length, placed, opts);
      if (spot) {
        e.place(spot.x, spot.z, spot.y);
        placed.push({ x: spot.x, z: spot.z, r: e.def.radius });
      }
      this.world.add(e.root);
      this.enemies.push(e);
    }
  }

  all(): readonly Enemy[] {
    return this.enemies;
  }

  /** 回收倒地动画播完的尸体（死亡瞬间不再立刻消失，先扑倒再清理） */
  sweep(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.removable) {
        this.world.remove(e.root);
        this.enemies.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const e of this.enemies) this.world.remove(e.root);
    this.enemies = [];
  }

  /** 剩余活着的敌人（尸体不算，保证波次按击杀推进） */
  remaining(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n += 1;
    return n;
  }
}
