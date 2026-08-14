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
}

export class Spawner {
  private rng: Rng;
  private world: THREE.Scene;
  private enemies: Enemy[] = [];

  constructor(world: THREE.Scene, seed: number) {
    this.world = world;
    this.rng = new Rng(seed);
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
    for (const kind of kinds) {
      let elite: EliteAffix | undefined;
      if (opts?.eliteChance && this.rng.range(0, 1) < opts.eliteChance) {
        elite = ELITE_AFFIXES[Math.floor(this.rng.range(0, ELITE_AFFIXES.length))].kind;
      }
      const e = new Enemy(ENEMY_DEFS[kind], this.rng, { hpMult: opts?.hpMult, dmgMult: opts?.dmgMult, elite });
      this.world.add(e.root);
      this.enemies.push(e);
    }
  }

  all(): readonly Enemy[] {
    return this.enemies;
  }

  /** 清除死亡敌人并从场景移除 */
  sweep(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        this.world.remove(e.root);
        this.enemies.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const e of this.enemies) this.world.remove(e.root);
    this.enemies = [];
  }

  remaining(): number {
    return this.enemies.length;
  }
}
