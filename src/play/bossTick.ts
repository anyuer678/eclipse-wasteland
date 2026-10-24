/**
 * play/bossTick — BOSS 的逐帧推进（追击/AI/阶段演出/招式结算）。
 *
 * 与敌人共用导航流场与视线语义：所有直接伤害必须过视线；
 * 冲锋只做预警、伤害在撞击帧的 melee 结算；召唤围绕 BOSS 落点。
 */
import * as THREE from 'three';

export interface BossEvent {
  melee?: number;
  chargeDir?: unknown;
  stompRadius?: number;
  summon?: number;
}

export interface BossLike {
  alive: boolean;
  phase: number;
  root: { position: THREE.Vector3 };
  centerInto(v: THREE.Vector3): THREE.Vector3;
  update(dt: number, playerPos: THREE.Vector3, ctx: { navX: number; navZ: number }): BossEvent | null;
  applyGround(y: number): void;
}

export interface BossTickNav {
  updateTarget(x: number, z: number): void;
  hasLineOfSight3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  steer(x: number, z: number, y: number, out: { x: number; z: number }): void;
}

export interface BossTickDeps {
  nav: BossTickNav;
  playerPos: THREE.Vector3;
  dt: number;
  /** 上一帧已播报的阶段（<0 表示刚记录，不触发演出） */
  phaseSeen: number;
  terrainHeightAt(x: number, z: number): number;
  clampArena(pos: THREE.Vector3): void;
  resolveObstacles(pos: THREE.Vector3, radius: number): void;
  damagePlayer(amount: number, src?: { x: number; z: number }): boolean;
  hudHit(): void;
  shake(amp: number, dur: number): void;
  roar(): void;
  announce(text: string, color: string, durationMs: number): void;
  burst(pos: THREE.Vector3, color: number, scale: number): void;
  emit(pos: THREE.Vector3, color: number, count: number, speed: number, scale: number): void;
  summon(count: number, x: number, z: number): void;
  scratch: THREE.Vector3;
}

/** 返回新的 phaseSeen */
export function tickBoss(boss: BossLike, d: BossTickDeps): number {
  let phaseSeen = d.phaseSeen;
  // 转阶段演出：吼叫 + 公告 + 冲击环（bossPhase<0 表示刚记录，不触发）
  if (boss.phase !== phaseSeen) {
    if (phaseSeen >= 0) {
      d.roar();
      d.announce('⚠ 狂暴化', '#ff4444', 1500);
      d.burst(boss.root.position, 0xff4a22, 6);
      boss.centerInto(d.scratch);
      d.emit(d.scratch, 0xff5a22, 22, 6.5, 2);
    }
    phaseSeen = boss.phase;
  }
  // 追击也走导航流场绕障；地面高度每帧注入（践踏跳跃叠在地形上）
  d.nav.updateTarget(d.playerPos.x, d.playerPos.z);
  const bossDir = { x: 0, z: 0 };
  d.nav.steer(boss.root.position.x, boss.root.position.z, boss.root.position.y, bossDir);
  const evt = boss.update(d.dt, d.playerPos, { navX: bossDir.x, navZ: bossDir.z });
  boss.applyGround(d.terrainHeightAt(boss.root.position.x, boss.root.position.z));
  // 体积碰撞兜底：冲锋/被击退都不得穿墙，也不许站进斜坡体内
  d.clampArena(boss.root.position);
  d.resolveObstacles(boss.root.position, 1.25);
  boss.applyGround(d.terrainHeightAt(boss.root.position.x, boss.root.position.z));
  if (!evt) return phaseSeen;
  const bp = boss.root.position;
  // BOSS 的所有直接伤害都要过视线：隔墙不结算
  const bossLos = d.nav.hasLineOfSight3D(bp.x, bp.y + 1.2, bp.z, d.playerPos.x, d.playerPos.y + 1.0, d.playerPos.z);
  if (evt.melee !== undefined) {
    // 横扫 / 冲锋撞击（撞击是冲锋结束帧的 melee 结算）
    if (bossLos && d.damagePlayer(evt.melee, { x: bp.x, z: bp.z })) d.hudHit();
  } else if (evt.chargeDir) {
    // 冲锋起手只做预警，伤害只在撞击帧结算；不能起手瞬发
    d.shake(0.1, 0.2);
  } else if (evt.stompRadius) {
    d.shake(0.2, 0.4);
    if (bossLos && d.playerPos.distanceTo(bp) < evt.stompRadius) {
      if (d.damagePlayer(8, { x: bp.x, z: bp.z })) d.hudHit();
    }
  } else if (evt.summon) {
    // 召唤物围绕 BOSS 出现，而不是全图随机位置 / 玩家脚下
    d.summon(evt.summon, bp.x, bp.z);
  }
  return phaseSeen;
}
