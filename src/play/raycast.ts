/**
 * play/raycast — 弹道遮挡与射线求交。
 *
 * 纯数学 + 一个复用向量，不依赖游戏/渲染状态，便于单测。
 * 障碍物从地面延伸到 top，地形射线由调用方注入（NavField 负责）。
 */
import * as THREE from 'three';
import type { NavObstacle } from '../horde/nav';

export type TerrainRay = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null;

const clipDir = new THREE.Vector3();

/** 射线-球体求交，返回最近正距离或 null */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}

/**
 * 射线与 AABB 的最近命中距离（slab 法，障碍从地面延伸到 top）。
 * 返回 null 表示不相交；t=0 表示起点已在盒内。
 */
export function rayAabbT(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  maxT: number
): number | null {
  let tmin = 0;
  let tmax = maxT;
  if (Math.abs(dir.x) < 1e-8) {
    if (origin.x < minX || origin.x > maxX) return null;
  } else {
    let t1 = (minX - origin.x) / dir.x;
    let t2 = (maxX - origin.x) / dir.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.y) < 1e-8) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    let t1 = (minY - origin.y) / dir.y;
    let t2 = (maxY - origin.y) / dir.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dir.z) < 1e-8) {
    if (origin.z < minZ || origin.z > maxZ) return null;
  } else {
    let t1 = (minZ - origin.z) / dir.z;
    let t2 = (maxZ - origin.z) / dir.z;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** 命中点是否落在障碍物表面（打在墙上时不能再按邻近伤害到墙后的敌人） */
export function pointOnObstacleSurface(pos: THREE.Vector3, obstacles: readonly NavObstacle[], eps = 0.08): boolean {
  for (const o of obstacles) {
    // 木箱本身是射击目标，不当作“墙命中”吞掉伤害
    if (o.crate) continue;
    if (pos.y > o.top + eps) continue;
    const ax = Math.abs(pos.x - o.x);
    const az = Math.abs(pos.z - o.z);
    if (ax > o.hw + eps || az > o.hd + eps) continue;
    if (Math.abs(ax - o.hw) <= eps || Math.abs(az - o.hd) <= eps || Math.abs(pos.y - o.top) <= eps) return true;
  }
  return false;
}

/** 弹道被掩体/地形遮挡时截断（精确射线-AABB，不用采样漏掉薄墙） */
export function clipToObstacles(
  from: THREE.Vector3,
  to: THREE.Vector3,
  obstacles: readonly NavObstacle[],
  terrainRayDistance: TerrainRay
): THREE.Vector3 {
  clipDir.subVectors(to, from);
  const len = clipDir.length();
  if (len < 1e-6) return to;
  clipDir.multiplyScalar(1 / len);
  let best = len;
  for (const o of obstacles) {
    const t = rayAabbT(from, clipDir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, len);
    if (t !== null && t < best) best = t;
  }
  const terrainT = terrainRayDistance(from.x, from.y, from.z, to.x, to.y, to.z);
  if (terrainT !== null && terrainT < best) best = terrainT;
  return best < len ? from.clone().addScaledVector(clipDir, best) : to;
}
