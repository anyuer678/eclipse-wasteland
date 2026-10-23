/**
 * play/fieldTicks — 战斗循环里与实体状态相关的每帧小步骤。
 *
 * 包含：BUFF 球的悬浮/拾取、燃烧/减速/眩晕特效（10Hz）、短期增益倒计时。
 * 只读实体并通过注入的回调产生副作用，便于单测。
 */
import type * as THREE from 'three';

export interface OrbLike<K extends string> {
  mesh: THREE.Group;
  kind: K;
}

export interface OrbTickDeps<K extends string> {
  orbs: OrbLike<K>[];
  scene: { remove(o: THREE.Object3D): void };
  playerPos: THREE.Vector3;
  dt: number;
  time: number;
  canPickup(x: number, y: number, z: number): boolean;
  pick(kind: K): void;
  onPickup(): void;
}

/** 悬浮/旋转动画 + 拾取（倒序遍历，拾取后原地删除） */
export function tickOrbPickups<K extends string>(d: OrbTickDeps<K>): void {
  for (let i = d.orbs.length - 1; i >= 0; i--) {
    const orb = d.orbs[i]!;
    orb.mesh.rotation.y += d.dt * 2.2;
    const core = orb.mesh.children[0];
    if (core) core.position.y = 0.9 + Math.sin(d.time * 3 + i) * 0.15;
    const p = orb.mesh.position;
    if (p.distanceToSquared(d.playerPos) < 2.6 && d.canPickup(p.x, p.y, p.z)) {
      d.pick(orb.kind);
      d.scene.remove(orb.mesh);
      d.onPickup();
      d.orbs.splice(i, 1);
    }
  }
}

export interface StatusEnemy {
  alive: boolean;
  centerInto(v: THREE.Vector3): THREE.Vector3;
  isBurning(): boolean;
  isSlowed(): boolean;
  isStunned(): boolean;
}

export interface StatusFxSink {
  emit(pos: THREE.Vector3, color: number, count: number, speed: number, scale?: number): void;
}

/** 状态特效（由调用方按 10Hz 节流后调用） */
export function emitStatusFx(
  enemies: readonly StatusEnemy[],
  sink: StatusFxSink,
  scratch: THREE.Vector3,
  rand: () => number = Math.random
): void {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.isBurning()) {
      e.centerInto(scratch);
      scratch.y += 0.6 + rand() * 0.5;
      sink.emit(scratch, 0xff7a33, 1, 0.9, 0.8);
    }
    if (e.isSlowed()) {
      e.centerInto(scratch);
      scratch.y += 0.5 + rand() * 0.7;
      sink.emit(scratch, 0x66c8ff, 1, 0.6, 0.7);
    }
    if (e.isStunned()) {
      e.centerInto(scratch);
      scratch.y += 1.35 + rand() * 0.25;
      sink.emit(scratch, 0xffd24a, 2, 1.1, 0.6);
    }
  }
}

export interface ShortBuffs {
  fireSpd: number;
  crit: number;
  move: number;
}

const SHORT_KEYS = ['fireSpd', 'crit', 'move'] as const;

/** 递减短期增益；返回本帧是否有增益到期（需要刷新属性缓存） */
export function tickShortBuffs(buffs: ShortBuffs, dt: number): boolean {
  let expired = false;
  for (const k of SHORT_KEYS) {
    if (buffs[k] <= 0) continue;
    const before = buffs[k];
    buffs[k] = Math.max(0, buffs[k] - dt);
    if (before > 0 && buffs[k] <= 0) expired = true;
  }
  return expired;
}
