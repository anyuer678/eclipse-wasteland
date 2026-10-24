/**
 * play/hitscan — 玩家 hitscan 命中判定。
 *
 * 依次比较掩体/地形/木箱/敌人/BOSS 的射线距离，返回最近命中点。
 * 结果点写入模块内复用向量（与旧实现一致：调用方只读，不应跨帧持有）。
 */
import * as THREE from 'three';
import type { NavObstacle } from '../horde/nav';
import { rayAabbT, raySphere } from './raycast';

export interface HitscanUnit {
  alive: boolean;
  centerInto(v: THREE.Vector3): THREE.Vector3;
}

export interface HitscanCrate {
  alive: boolean;
  x: number;
  z: number;
}

export interface HitscanInput {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  obstacles: readonly NavObstacle[];
  terrainRay: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null;
  crates: readonly HitscanCrate[];
  barrels: readonly HitscanCrate[];
  enemies: readonly HitscanUnit[];
  boss: HitscanUnit | null;
}

export interface HitscanResult {
  /** 命中点（复用向量） */
  point: THREE.Vector3;
  /** 停在墙/地形/地面（不是单位），本次伤害不结算 */
  terrainSurface: boolean;
}

const hitScratch = new THREE.Vector3();
const centerScratch = new THREE.Vector3();
const RANGE = 60;

export function castHitscan(inp: HitscanInput): HitscanResult {
  const { origin, dir } = inp;
  let bestT = RANGE;
  let hit = false;
  // 掩体优先参与截断：玩家射击是 hitscan，必须和敌人弹丸一样被墙挡住
  let wallT = Infinity;
  for (const o of inp.obstacles) {
    const t = rayAabbT(origin, dir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, RANGE);
    if (t !== null && t > 0.02 && t < wallT) wallT = t;
  }
  const terrainT = inp.terrainRay(origin.x, origin.y, origin.z, origin.x + dir.x * RANGE, origin.y + dir.y * RANGE, origin.z + dir.z * RANGE);
  if (terrainT !== null && terrainT < wallT) wallT = terrainT;
  for (const c of inp.crates) {
    if (!c.alive) continue;
    hitScratch.set(c.x, 0.7, c.z);
    const t = raySphere(origin, dir, hitScratch, 1.0);
    if (t !== null && t < bestT && t < wallT) {
      bestT = t;
      hit = true;
    }
  }
  // 爆炸桶：低矮圆柱，命中球近似
  for (const b of inp.barrels) {
    if (!b.alive) continue;
    hitScratch.set(b.x, 0.5, b.z);
    const t = raySphere(origin, dir, hitScratch, 0.9);
    if (t !== null && t < bestT && t < wallT) {
      bestT = t;
      hit = true;
    }
  }
  for (const e of inp.enemies) {
    if (!e.alive) continue;
    // 命中半径放宽到 1.1（容忍地形高度差，平视也能打高处敌人）
    e.centerInto(centerScratch);
    const t = raySphere(origin, dir, centerScratch, 1.1);
    if (t !== null && t < bestT && t < wallT) {
      bestT = t;
      hit = true;
    }
  }
  if (inp.boss && inp.boss.alive) {
    inp.boss.centerInto(centerScratch);
    const t = raySphere(origin, dir, centerScratch, 3.2);
    if (t !== null && t < bestT && t < wallT) {
      bestT = t;
      hit = true;
    }
  }
  if (hit) return { point: hitScratch.copy(origin).addScaledVector(dir, bestT), terrainSurface: false };
  if (wallT < RANGE) {
    return {
      point: hitScratch.copy(origin).addScaledVector(dir, wallT),
      terrainSurface: terrainT !== null && terrainT <= wallT,
    };
  }
  if (dir.y < -1e-4) {
    const t = -origin.y / dir.y;
    if (t > 0) return { point: hitScratch.copy(origin).addScaledVector(dir, t), terrainSurface: true };
  }
  return { point: hitScratch.copy(origin).addScaledVector(dir, RANGE), terrainSurface: false };
}
