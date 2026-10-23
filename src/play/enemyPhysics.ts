/**
 * play/enemyPhysics — 敌人水平/垂直物理（从 game.ts 抽出）。
 *
 * 顺序保持与原实现一致：
 *   1) 障碍推回（分离之前）
 *   2) 群体分离（由 separateCrowd 负责，调用方插在两步之间）
 *   3) 玩家体积推开 → 障碍推回 → 贴地/下落
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsEnemy {
  alive: boolean;
  def: { radius: number };
  root: { position: Vec3Like };
  refuseClimb(ground: number): boolean;
  applyGroundMotion(ground: number, dt: number): void;
}

export interface EnemyPhysicsCtx {
  player: Vec3Like;
  terrainHeight: (x: number, z: number) => number;
  clampArena: (pos: Vec3Like) => void;
  resolveObstacles: (pos: Vec3Like, radius: number) => void;
}

/** 分离前的障碍推回：避免把已经嵌进掩体的怪当成可站立点 */
export function resolveCrowdObstacles(crowd: readonly PhysicsEnemy[], ctx: EnemyPhysicsCtx): void {
  for (const e of crowd) {
    if (!e.alive) continue;
    const pos = e.root.position;
    ctx.clampArena(pos);
    e.refuseClimb(ctx.terrainHeight(pos.x, pos.z));
    ctx.resolveObstacles(pos, e.def.radius + 0.06);
  }
}

/** 分离后的收尾：玩家体积推开 → 障碍 → 贴地/下落 */
export function settleCrowd(crowd: readonly PhysicsEnemy[], dt: number, ctx: EnemyPhysicsCtx): void {
  const p = ctx.player;
  for (const e of crowd) {
    if (!e.alive) continue;
    const ep = e.root.position;
    const dx = ep.x - p.x;
    const dz = ep.z - p.z;
    const d = Math.hypot(dx, dz);
    const minD = 0.3 + e.def.radius;
    if (d < minD && Math.abs(ep.y - p.y) < 1.4) {
      if (d > 1e-4) {
        ep.x = p.x + (dx / d) * minD;
        ep.z = p.z + (dz / d) * minD;
      } else {
        ep.x = p.x + minD;
      }
    }
    ctx.clampArena(ep);
    ctx.resolveObstacles(ep, e.def.radius + 0.06);
    e.refuseClimb(ctx.terrainHeight(ep.x, ep.z));
    e.applyGroundMotion(ctx.terrainHeight(ep.x, ep.z), dt);
  }
}
