/**
 * play/chain — 连锁闪电的逐跳结算（纯逻辑）。
 *
 * 从命中点向 10m 内最近的可见敌人弹跳，伤害逐跳衰减；每跳都要求 3D 视线。
 * 每跳锁定一个新目标（同一敌人不会被重复命中，主命中目标也不参与弹跳），跳数 = 受害目标数上限。
 * 击杀/熟练度等副作用由注入回调处理。
 */
import type * as THREE from 'three';
import type { TargetEnemy } from './targeting';

export interface ChainDeps<T extends TargetEnemy> {
  enemies(): readonly T[];
  hasLineOfSight3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  fire(from: THREE.Vector3, to: THREE.Vector3): void;
  /** 返回是否死亡 */
  damage(e: T, amount: number): boolean;
  /** 返回 true 表示触发升级暂停，应立即停止后续跳 */
  onKill(e: T): boolean;
  /** 主命中已结算的目标：预置进 hitSet，避免第一跳打回主目标浪费跳数 */
  exclude?: T | null;
}

export function chainLightning<T extends TargetEnemy>(
  pos: THREE.Vector3,
  damage: number,
  jumps: number,
  falloff: number,
  d: ChainDeps<T>
): void {
  let fromPos = pos;
  let dmg = damage;
  const hitSet = new Set<T>();
  if (d.exclude) hitSet.add(d.exclude);
  for (let j = 0; j < jumps; j++) {
    let best: { e: T; dist: number } | null = null;
    for (const e of d.enemies()) {
      if (!e.alive || hitSet.has(e)) continue;
      const c = e.center();
      const dist = c.distanceToSquared(fromPos);
      if (dist < 1e-4) continue;
      if (dist >= 100) continue;
      if (!d.hasLineOfSight3D(fromPos.x, fromPos.y, fromPos.z, c.x, c.y, c.z)) continue;
      if (best === null || dist < best.dist) best = { e, dist };
    }
    if (!best) break;
    dmg *= falloff;
    const to = best.e.center();
    d.fire(fromPos, to);
    hitSet.add(best.e);
    const dead = d.damage(best.e, dmg);
    if (dead && d.onKill(best.e)) break;
    fromPos = to;
  }
}
