/**
 * play/enemyTick — 敌人 AI 的逐帧推进（从 game 战斗循环抽出）。
 *
 * 负责：状态衰减/尸体动画、隐身跳过、燃烧死亡、视线与绕障方向、
 * 近战/自爆/喷吐/弹幕/治疗事件的统一结算。副作用通过 deps 注入。
 * 返回后由调用方继续做体积分离与贴地物理。
 */
import * as THREE from 'three';

export interface EnemyTickEvent {
  melee?: number;
  blast?: number;
  spit?: { from: THREE.Vector3; to: THREE.Vector3; damage: number };
  cast?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[];
  heal?: number;
}

export interface EnemyTickEnemy {
  alive: boolean;
  hp: number;
  root: { position: THREE.Vector3 };
  def: { hp: number; kind: string; blastRadius: number };
  updateFlash(dt: number): void;
  tickElite(dt: number): void;
  tickCorpse(dt: number): void;
  tickBurn(dt: number): boolean;
  update(
    dt: number,
    playerPos: THREE.Vector3,
    ctx: { navX: number; navZ: number; seesPlayer: boolean }
  ): EnemyTickEvent | null;
  die(): void;
  healBy(amount: number): void;
}

export interface EnemyTickNav {
  updateTarget(x: number, z: number): void;
  hasLineOfSight3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  steer(x: number, z: number, y: number, out: { x: number; z: number }): void;
}

export interface EnemyTickDeps<T extends EnemyTickEnemy = EnemyTickEnemy> {
  nav: EnemyTickNav;
  playerPos: THREE.Vector3;
  /** 隐身时敌人不攻击（但仍推进状态/尸体动画） */
  stealth: boolean;
  /** 当前全部敌人（治疗者用；可能包含本帧新生成的单位） */
  all(): readonly T[];
  /** 返回 true 表示触发升级暂停，应立即停止本帧后续敌人 */
  onKill(e: T): boolean;
  sfx: { boom(): void; spit(): void };
  shake(amp: number, dur: number): void;
  damagePlayer(amount: number, src?: { x: number; z: number }): boolean;
  hudHit(): void;
  spawnProjectile(from: THREE.Vector3, to: THREE.Vector3, color: number, speed: number, damage: number): void;
  /** 弹道被掩体/地形截断后的终点 */
  clipProjectile(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3;
  popup(pos: THREE.Vector3, text: string, color: string, size?: number): void;
}

const HEAL_RADIUS = 7;

export function tickEnemies<T extends EnemyTickEnemy>(crowd: readonly T[], dt: number, d: EnemyTickDeps<T>): void {
  const pp = d.playerPos;
  d.nav.updateTarget(pp.x, pp.z);
  const navDir = { x: 0, z: 0 };
  for (const e of crowd) {
    e.updateFlash(dt);
    e.tickElite(dt);
    if (!e.alive) {
      e.tickCorpse(dt); // 倒地动画（播完由 spawner.sweep 回收）
      continue;
    }
    if (d.stealth) continue;
    if (e.tickBurn(dt)) {
      if (d.onKill(e)) break;
      continue;
    }
    const ep = e.root.position;
    const sees = d.nav.hasLineOfSight3D(ep.x, ep.y + 1.15, ep.z, pp.x, pp.y + 1.1, pp.z);
    navDir.x = 0;
    navDir.z = 0;
    d.nav.steer(ep.x, ep.z, ep.y, navDir);
    const evt = e.update(dt, pp, { navX: navDir.x, navZ: navDir.z, seesPlayer: sees });
    if (!evt) continue;
    if (evt.melee !== undefined || evt.blast !== undefined) {
      if (evt.blast !== undefined) {
        e.die();
        d.sfx.boom();
        d.shake(0.22, 0.45);
        // 爆炸按真实半径 + 遮挡结算：跑出范围和隔墙都不掉血
        const dx = pp.x - ep.x;
        const dz = pp.z - ep.z;
        const dy = pp.y - ep.y;
        const radius = e.def.blastRadius > 0 ? e.def.blastRadius : 2.6;
        const exposed = d.nav.hasLineOfSight3D(ep.x, ep.y + 0.8, ep.z, pp.x, pp.y + 1.0, pp.z);
        if (dx * dx + dz * dz <= radius * radius && Math.abs(dy) < 2.2 && exposed) {
          if (d.damagePlayer(evt.blast, { x: ep.x, z: ep.z })) d.hudHit();
        }
      } else if (d.damagePlayer(evt.melee ?? 0, { x: ep.x, z: ep.z })) {
        d.hudHit();
      }
    }
    if (evt.spit) {
      d.sfx.spit();
      const color = e.def.kind === 'turret' ? 0xd9c26a : 0x3fb96a;
      d.spawnProjectile(
        evt.spit.from,
        d.clipProjectile(evt.spit.from, evt.spit.to),
        color,
        e.def.kind === 'turret' ? 16 : 13,
        evt.spit.damage
      );
    }
    if (evt.cast) {
      // 弹幕法师三连弹：紫色弹丸
      d.sfx.spit();
      for (const c of evt.cast) d.spawnProjectile(c.from, d.clipProjectile(c.from, c.to), 0xcc88ff, 11, c.damage);
    }
    if (evt.heal) {
      // 治疗者：治疗 7m 内友军（不含自己），绿色跳字提示
      let healed = 0;
      for (const ally of d.all()) {
        if (!ally.alive || ally === e) continue;
        if (ally.root.position.distanceTo(e.root.position) > HEAL_RADIUS) continue;
        if (ally.hp >= ally.def.hp) continue;
        ally.healBy(evt.heal);
        healed += 1;
      }
      if (healed > 0) {
        d.popup(e.root.position.clone().add(new THREE.Vector3(0, 1.7, 0)), `治疗 ×${healed}`, '#7fd9a0', 16);
      }
    }
  }
}
