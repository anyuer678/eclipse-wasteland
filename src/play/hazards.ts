/**
 * play/hazards — 场地陷阱（毒池）判定。
 *
 * 以池子所在地面为基准判断垂直距离：高地上的池照样生效，
 * 平台上的玩家/敌人不会被隔空毒到。
 */
export interface PoolPoint {
  x: number;
  y: number;
  z: number;
}

export interface PoisonPool {
  x: number;
  z: number;
  r: number;
}

/** 每秒毒伤（玩家与敌人共用同一数值） */
export const POISON_DPS = 8;

export function inPoisonPool(pos: PoolPoint, pool: PoisonPool, poolGround: number, verticalTolerance = 0.7): boolean {
  const dx = pos.x - pool.x;
  const dz = pos.z - pool.z;
  return dx * dx + dz * dz < pool.r * pool.r && Math.abs(pos.y - poolGround) < verticalTolerance;
}
