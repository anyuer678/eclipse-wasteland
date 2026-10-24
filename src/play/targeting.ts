/**
 * play/targeting — 索敌与穿透目标收集（纯逻辑）。
 *
 * 所有目标判定都要求 3D 视线；穿透额外被掩体/地形截断，按距离排序后取前 N。
 */
import type * as THREE from 'three';
import type { NavObstacle } from '../horde/nav';
import { rayAabbT, raySphere } from './raycast';

export interface TargetEnemy {
  alive: boolean;
  center(): THREE.Vector3;
}

export interface TargetingDeps {
  enemies(): readonly TargetEnemy[];
  hasLineOfSight3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
}

/** 范围内最近的可见目标中心；无目标返回 null */
export function findNearestVisible(
  origin: THREE.Vector3,
  maxRange: number,
  d: TargetingDeps
): THREE.Vector3 | null {
  let best: { e: TargetEnemy; dist: number } | null = null;
  const maxSq = maxRange * maxRange;
  for (const e of d.enemies()) {
    if (!e.alive) continue;
    const c = e.center();
    const dist = c.distanceToSquared(origin);
    if (dist > maxSq) continue;
    if (!d.hasLineOfSight3D(origin.x, origin.y, origin.z, c.x, c.y, c.z)) continue;
    if (best === null || dist < best.dist) best = { e, dist };
  }
  return best ? best.e.center() : null;
}

export interface PierceDeps extends TargetingDeps {
  obstacles: readonly NavObstacle[];
  terrainRayDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null;
}

const RANGE = 60;

/** 沿射线收集前 max 个目标（按距离排序），墙体/地形后的目标排除 */
export function resolvePierceTargets(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  max: number,
  d: PierceDeps
): THREE.Vector3[] {
  // 穿透也要被墙截断：先求墙距，挡在墙后的目标不进列表
  let wallT = Infinity;
  for (const o of d.obstacles) {
    const t = rayAabbT(origin, dir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, RANGE);
    if (t !== null && t > 0.02 && t < wallT) wallT = t;
  }
  const terrainT = d.terrainRayDistance(
    origin.x,
    origin.y,
    origin.z,
    origin.x + dir.x * RANGE,
    origin.y + dir.y * RANGE,
    origin.z + dir.z * RANGE
  );
  if (terrainT !== null && terrainT < wallT) wallT = terrainT;
  // 沿方向收集射线附近敌人（按距离排序）
  const hits: { e: TargetEnemy; t: number }[] = [];
  for (const e of d.enemies()) {
    if (!e.alive) continue;
    const c = e.center();
    const t = raySphere(origin, dir, c, 0.9);
    if (t !== null && t < wallT) hits.push({ e, t });
  }
  hits.sort((a, b) => a.t - b.t);
  return hits.slice(0, max).map((h) => h.e.center());
}
