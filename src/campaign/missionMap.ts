/**
 * campaign/missionMap — 开局地图重建与可破坏木箱实例化。
 *
 * 负责：移除并释放上一张地图 → 按任务变体生成新布局 → 读取刷怪锚点 →
 * 按地图配置重建木箱（木箱 mesh 引用用于击碎后隐藏）。
 */
import * as THREE from 'three';
import { World } from '../render/world';
import type { NavObstacle } from '../horde';

export interface MissionCrate {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  mesh?: THREE.Mesh;
  obstacle?: NavObstacle;
}

export interface MissionMap {
  mapRoot: THREE.Group;
  spawnAnchors: { x: number; z: number }[];
  crates: MissionCrate[];
}

export const CRATE_HP = 25;

export function rebuildMissionMap(
  world: World,
  mapId: Parameters<World['buildMap']>[0],
  variant: number,
  previous: THREE.Group | null
): MissionMap {
  if (previous) {
    world.scene.remove(previous);
    World.disposeMap(previous);
  }
  const mapRoot = world.buildMap(mapId, variant);
  const spawnAnchors = (mapRoot.userData.spawnAnchors ?? []) as { x: number; z: number }[];
  const crateGroup = mapRoot.userData.crateGroup as THREE.Group | undefined;
  const defs = (mapRoot.userData.crates ?? []) as { x: number; z: number; obstacle?: NavObstacle }[];
  const crates: MissionCrate[] = [];
  for (let i = 0; i < defs.length; i++) {
    const c = defs[i]!;
    crates.push({
      x: c.x,
      z: c.z,
      hp: CRATE_HP,
      alive: true,
      mesh: crateGroup?.children[i] as THREE.Mesh | undefined,
      obstacle: c.obstacle,
    });
  }
  return { mapRoot, spawnAnchors, crates };
}
