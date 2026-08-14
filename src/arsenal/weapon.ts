/**
 * arsenal/weapon — 武器运行时。
 *
 * 射击 = hitscan（准星方向射线）+ 亮线弹道（无真实弹道、无子弹实体）。
 * 每把武器由配表驱动，机制状态机在 update() 中推进：
 *   energy / overload / lockon / slow / charge
 */
import * as THREE from 'three';
import { clamp } from '../core';
import type { WeaponDef } from './defs';
import type { TracerPool } from './tracer';

/** 射击上下文：由外部（玩家系统）注入 */
export interface FireContext {
  origin: THREE.Vector3; // 枪口世界坐标
  direction: THREE.Vector3; // 准星方向（归一化）
  tracer: TracerPool;
  /** 命中点计算：返回世界命中点（无敌人时落到场景/地面） */
  resolveHit: (origin: THREE.Vector3, dir: THREE.Vector3) => THREE.Vector3;
  /** 命中敌人回调（阶段 4 接入）：返回 true 表示命中敌人（用于减速/吸血等） */
  onHitEnemy?: (pos: THREE.Vector3, damage: number, extra: { slow?: number; lockTarget?: boolean }) => boolean;
  /** 穿透查询：沿方向收集射线上的敌人位置（含最近目标，按距离排序） */
  resolvePierce?: (origin: THREE.Vector3, dir: THREE.Vector3, max: number) => THREE.Vector3[];
  /** 查询锁敌目标（阶段 4 接入） */
  findTarget?: (origin: THREE.Vector3, maxRange: number) => THREE.Vector3 | null;
  /** 连锁闪电：命中点向附近敌人弹跳（chain 机制） */
  onChain?: (pos: THREE.Vector3, damage: number, jumps: number, falloff: number) => void;
  /** 治疗玩家（guard 机制） */
  onHeal?: (amount: number) => void;
}

export interface WeaponState {
  energy: number;
  ammo: number;
  overloaded: boolean;
  charging: boolean;
  chargeTime: number;
  reloading: boolean;
  reloadTimer: number;
}

export class Weapon {
  readonly def: WeaponDef;
  state: WeaponState;

  /** 养成倍率（由 growth 系统注入）：伤害倍率 / 机制倍率 / 能量获取倍率 / 攻速倍率 */
  growthDamage = 1;
  growthMech = 1;
  energyGainMult = 1;
  fireRateMult = 1;
  /** 局内扩容弹夹 / 速装填（run 成长） */
  magMult = 1;
  reloadMult = 1;

  private fireCooldown = 0;

  constructor(def: WeaponDef) {
    this.def = def;
    this.state = {
      energy: 0,
      ammo: def.mag,
      overloaded: false,
      charging: false,
      chargeTime: 0,
      reloading: false,
      reloadTimer: 0,
    };
  }

  /** 当前弹夹容量（含扩容） */
  magCap(): number {
    return Math.ceil(this.def.mag * this.magMult);
  }

  /** 换弹时长（按武器类型） */
  static reloadTimeFor(def: WeaponDef): number {
    switch (def.archetype) {
      case 'sniper': return 2.4;
      case 'shotgun': return 2.1;
      case 'smg': return 1.8;
      case 'rifle': return 1.6;
      default: return 1.2;
    }
  }

  /** 触发换弹（弹药不满且未在换弹时） */
  reload(): void {
    const s = this.state;
    if (s.reloading || s.ammo >= this.magCap()) return;
    s.reloading = true;
    s.reloadTimer = Weapon.reloadTimeFor(this.def) / this.reloadMult;
  }

  /** 每逻辑帧推进（冷却/蓄力/过载耗能/换弹） */
  update(dt: number, _ctx: FireContext): void {
    const s = this.state;
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (s.reloading) {
      s.reloadTimer -= dt;
      if (s.reloadTimer <= 0) {
        s.ammo = this.magCap();
        s.reloading = false;
      }
    }

    this.guardCooldown = Math.max(0, this.guardCooldown - dt);

    if (s.overloaded && this.def.mech.kind === 'overload') {
      s.energy = Math.max(0, s.energy - (this.def.mech as { energyPerSec: number }).energyPerSec * dt);
      if (s.energy <= 0) s.overloaded = false;
    }

    if (s.charging) {
      s.chargeTime = Math.min(s.chargeTime + dt, (this.def.mech as { time: number }).time);
    }
  }

  /** 切换形态（overload 机制） */
  toggleOverload(): void {
    if (this.def.mech.kind !== 'overload') return;
    const s = this.state;
    if (!s.overloaded && s.energy >= 25) {
      s.overloaded = true;
    } else {
      s.overloaded = false;
    }
  }

  /**
   * 武器主动技能（E 键）：
   *   energy → 能量爆发射击
   *   lockon → 电弧索敌
   *   overload → 切换过载形态
   */
  skill(ctx: FireContext): void {
    const m = this.def.mech;
    if (m.kind === 'energy') {
      const s = this.state;
      if (s.energy >= m.cost) {
        s.energy -= m.cost;
        if (this.fireCooldown <= 0) {
          const origin = ctx.origin.clone().addScaledVector(ctx.direction, 0.5);
          const hit = ctx.resolveHit(origin, ctx.direction);
          ctx.tracer.fire(origin, hit, 0xff5566, 2);
          ctx.onHitEnemy?.(hit, this.def.damage * m.multiplier * this.growthMech, {});
          this.fireCooldown = (60 / this.def.rpm) / this.fireRateMult;
        }
      }
    } else if (m.kind === 'lockon') {
      const target = ctx.findTarget?.(ctx.origin, m.range) ?? null;
      if (target && ctx.onHitEnemy) {
        ctx.tracer.fire(ctx.origin, target, 0x66e0ff, 2);
        ctx.onHitEnemy(target, this.def.damage * m.damageFactor * this.growthMech, { lockTarget: true });
      }
    } else if (m.kind === 'overload') {
      this.toggleOverload();
    } else if (m.kind === 'guard') {
      // 圣辉守护：E 治疗玩家（带冷却）
      if (this.guardCooldown <= 0 && ctx.onHeal) {
        this.guardCooldown = m.cooldown;
        ctx.onHeal(m.heal);
      }
    }
  }

  private guardCooldown = 0;

  /** 尝试射击，返回本次是否开火 */
  fire(ctx: FireContext): boolean {
    const s = this.state;
    if (this.fireCooldown > 0 || s.ammo <= 0 || s.reloading) {
      // 弹药耗尽自动触发换弹
      if (s.ammo <= 0 && !s.reloading) this.reload();
      return false;
    }

    const d = this.def;
    const interval = 60 / d.rpm / this.fireRateMult;
    this.fireCooldown = interval;

    // 蓄力武器：未松开前持续蓄力，不实际开火
    if (d.mech.kind === 'charge') {
      s.charging = true;
      return false;
    }
    this.discharge(ctx);
    return true;
  }

  /** 松开左键：蓄力武器在此刻结算 */
  releaseFire(ctx: FireContext): void {
    const s = this.state;
    if (!s.charging) return;
    s.charging = false;
    const mech = this.def.mech as { maxMult: number; time: number };
    const t = clamp(s.chargeTime / mech.time, 0, 1);
    const mult = 1 + (mech.maxMult - 1) * t;
    s.chargeTime = 0;
    this.discharge(ctx, mult, 1 + t * 1.5);
  }

  /** 结算一次开火（亮线 + 伤害回调） */
  private discharge(ctx: FireContext, damageMult = 1, lineIntensity = 1): void {
    const s = this.state;
    const d = this.def;
    s.ammo -= 1;

    // 能量累积
    s.energy = clamp(s.energy + d.energyGain * this.energyGainMult, 0, d.energyMax);

    const shotDamage = d.damage * damageMult * this.growthDamage;

    // beam 机制（烈焰风暴）：持续射线耗能量、不耗弹药
    if (d.mech.kind === 'beam') {
      const m = d.mech as { energyPerSec: number; range: number };
      s.energy = Math.max(0, s.energy - m.energyPerSec * this.fireCooldown);
      if (s.energy <= 0) {
        s.ammo = Math.max(0, s.ammo - 1);
        return;
      }
    }

    // 弹道从准星前方出发（视觉严格沿准星），终点为命中点
    const origin = ctx.origin.clone().addScaledVector(ctx.direction, 0.5);

    for (let p = 0; p < d.pellets; p++) {
      const dir = this.spreadDir(ctx.direction, d.spreadDeg, p);
      const hit = ctx.resolveHit(origin, dir);
      const isBeam = d.mech.kind === 'beam';
      ctx.tracer.fire(origin, hit, isBeam ? 0xff7a3a : d.color, isBeam ? 2 : lineIntensity);
      if (ctx.onHitEnemy) {
        const extra: { slow?: number } = {};
        if (d.mech.kind === 'slow') extra.slow = (d.mech as { factor: number }).factor;
        const hitAny = ctx.onHitEnemy(hit, shotDamage, extra);
        // burst 机制（三连突击）：同一次开火连发多发
        if (d.mech.kind === 'burst') {
          const m = d.mech as { shots: number };
          for (let i = 1; i < m.shots; i++) {
            const dir2 = this.spreadDir(ctx.direction, d.spreadDeg, p + i);
            const hit2 = ctx.resolveHit(origin, dir2);
            ctx.tracer.fire(origin, hit2, d.color, lineIntensity * 0.8);
            ctx.onHitEnemy?.(hit2, shotDamage, {});
          }
        }
        // pierce 机制（穿云狙击）：沿射线穿透多个敌人，伤害递减
        if (d.mech.kind === 'pierce') {
          const m = d.mech as { targets: number; falloff: number };
          const rest = ctx.resolvePierce?.(origin, ctx.direction, m.targets + 1) ?? [];
          // 跳过第一个（已由主命中处理）
          for (let i = 1; i < rest.length; i++) {
            ctx.tracer.fire(origin, rest[i], d.color, lineIntensity * (1 - i * 0.25));
            ctx.onHitEnemy?.(rest[i], shotDamage * Math.pow(m.falloff, i), {});
          }
        }
        // chain 机制（雷暴投枪）：命中后弹跳
        if (d.mech.kind === 'chain' && hitAny && ctx.onChain) {
          const m = d.mech as { jumps: number; falloff: number };
          ctx.onChain(hit, shotDamage * 0.7, m.jumps, m.falloff);
        }
      }
    }

    // 机制结算
    if (d.mech.kind === 'energy' && ctx.onHitEnemy) {
      // 能量爆发由 E 键技能触发（skill()）
    }
  }

  /** 生成散射方向（霰弹弹丸用确定性伪随机扇分布） */
  private spreadDir(base: THREE.Vector3, spreadDeg: number, seed: number): THREE.Vector3 {
    if (spreadDeg <= 0.01) return base.clone();
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(base, up).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const realUp = new THREE.Vector3().crossVectors(right, base).normalize();
    const offX = (seed * 1.6180339887 % 1 - 0.5) * 2;
    const offY = (seed * 2.7182818284 % 1 - 0.5) * 2;
    const dir = base.clone().addScaledVector(right, offX * spread).addScaledVector(realUp, offY * spread).normalize();
    return dir;
  }
}
