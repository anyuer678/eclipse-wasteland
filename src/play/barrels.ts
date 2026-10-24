/**
 * play/barrels — 爆炸桶纯逻辑：伤害衰减 / 链式引爆候选。
 * 粒子、震屏、导航重烘等应用层留在 game.ts。
 */

export const BARREL_RADIUS = 4.5;
export const BARREL_BASE_DMG = 110;
export const BARREL_PLAYER_DMG = 25;
export const BARREL_HP = 12;
/** 链式引爆的引信延时（秒）：给玩家一点跑出第二爆圈的机会 */
export const BARREL_CHAIN_DELAY = 0.15;

/** 距离衰减：爆心 1 → 边缘 0.35（线性） */
export function barrelFalloff(dist: number, radius = BARREL_RADIUS): number {
  const t = Math.min(1, Math.max(0, dist / radius));
  return 1 - t * 0.65;
}

export interface ChainSource {
  x: number;
  z: number;
  alive: boolean;
}

/** 爆心波及半径内的其它桶（爆炸前应先把爆桶置 alive=false，天然排除自身） */
export function collectChainBarrels<T extends ChainSource>(barrels: readonly T[], cx: number, cz: number, radius = BARREL_RADIUS): T[] {
  const out: T[] = [];
  for (const b of barrels) {
    if (!b.alive) continue;
    const dx = b.x - cx;
    const dz = b.z - cz;
    if (dx * dx + dz * dz <= radius * radius) out.push(b);
  }
  return out;
}
