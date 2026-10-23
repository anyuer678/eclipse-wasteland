/**
 * campaign/placement — 刷怪落点选择器（从 game 的 beginMission 抽出）。
 *
 * 每 3 只怪换一个地标/外圈锚点，再从锚点附近找可站点；
 * 距离玩家不在 10–42m 或找不到点时回退到玩家周围的常规环形落点。
 */
import { pickSpawnAnchor } from './spawnZones';
import type { EnemyKind } from '../horde';

export interface PlacementPoint {
  x: number;
  z: number;
}

export interface PlacementOpts {
  center?: PlacementPoint;
  placeMin?: number;
  placeMax?: number;
}

export interface PlacementNav {
  findSpawnPoint(
    random: () => number,
    cx: number,
    cz: number,
    minR: number,
    maxR: number,
    placed?: readonly { x: number; z: number; r: number }[],
    minGap?: number
  ): { x: number; y: number; z: number } | null;
}

export interface PlacementDeps {
  nav: PlacementNav;
  anchors: () => readonly PlacementPoint[];
  rng: () => number;
  player: () => PlacementPoint;
}

export interface Placement {
  place(
    kind: EnemyKind,
    index: number,
    total: number,
    placed: readonly { x: number; z: number; r: number }[],
    opts?: PlacementOpts
  ): { x: number; y: number; z: number } | null;
  reset(): void;
}

export function createPlacement(d: PlacementDeps): Placement {
  let seq = 0;
  return {
    reset(): void {
      seq = 0;
    },
    place(kind, _index, _total, placed, opts) {
      const px = opts?.center?.x ?? d.player().x;
      const pz = opts?.center?.z ?? d.player().z;
      // 区域分簇：每 3 只换一个锚点（地标/外圈点位），再从锚点附近找可站立点
      if (!opts?.center) {
        const anchors = d.anchors();
        if (anchors.length > 0) {
          const anchor = pickSpawnAnchor(anchors, seq++, 3, px, pz, 12, 40);
          if (anchor) {
            const spot = d.nav.findSpawnPoint(d.rng, anchor.x, anchor.z, 0.6, 4.5, placed, kind === 'boomer' ? 2.2 : 1.5);
            if (spot) {
              const dist = Math.hypot(spot.x - px, spot.z - pz);
              if (dist >= 10 && dist <= 42) return spot;
            }
          }
        }
      }
      return d.nav.findSpawnPoint(
        d.rng,
        px,
        pz,
        opts?.placeMin ?? 14,
        opts?.placeMax ?? 26,
        placed,
        kind === 'boomer' ? 2.2 : 1.5
      );
    },
  };
}
