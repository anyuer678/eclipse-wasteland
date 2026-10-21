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
}

export interface WaveOptions {
  /** 生命倍率（塔层数缩放） */
  hpMult?: number;
  /** 伤害倍率 */
  dmgMult?: number;
  /** 精英概率 0-1 */
  eliteChance?: number;
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
) => { x: number; z: number; y: number } | null;

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
    ];
    const placed: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      let elite: EliteAffix | undefined;
      if (opts?.eliteChance && this.rng.range(0, 1) < opts.eliteChance) {
        elite = ELITE_AFFIXES[Math.floor(this.rng.range(0, ELITE_AFFIXES.length))].kind;
      }
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
