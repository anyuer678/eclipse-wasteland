/**
 * arsenal/combat — 纯战斗公式（无 Three/WebGL 依赖）。
 *
 * 从 weapon.ts 抽出的可单测部分：伤害 / 射速 / 弹夹 / 换弹 / 蓄力倍率。
 * weapon.ts 运行时与本表共用同一套公式，避免两处漂移。
 */
import { clamp } from '../core/math';
import type { WeaponDef } from './defs';

/** 射击间隔（秒）= 60 / RPM / 攻速倍率 */
export function fireIntervalSeconds(rpm: number, fireRateMult = 1): number {
  if (rpm <= 0) return Number.POSITIVE_INFINITY;
  return 60 / rpm / Math.max(fireRateMult, 1e-6);
}

/** 单发面板伤害 = 基础伤害 × 蓄力倍率 × 养成伤害倍率 */
export function shotDamage(baseDamage: number, chargeMult = 1, growthDamage = 1): number {
  return baseDamage * chargeMult * growthDamage;
}

/** 弹夹容量（含局内扩容） */
export function magCapacity(mag: number, magMult = 1): number {
  return Math.ceil(mag * Math.max(magMult, 0));
}

/** 换弹时长（按武器原型；运行时再除以速装填倍率） */
export function reloadTimeFor(archetype: WeaponDef['archetype']): number {
  switch (archetype) {
    case 'sniper':
      return 2.4;
    case 'shotgun':
      return 2.1;
    case 'smg':
      return 1.8;
    case 'rifle':
      return 1.6;
    default:
      return 1.2;
  }
}

/** 蓄力伤害倍率：chargeTime/time 夹到 [0,1] 后在 1..maxMult 线性插值 */
export function chargeDamageMult(chargeTime: number, maxMult: number, chargeNeed: number): number {
  const t = chargeNeed <= 0 ? 1 : clamp(chargeTime / chargeNeed, 0, 1);
  return 1 + (maxMult - 1) * t;
}

/** 理论 DPS（配表平衡用）：单发伤害 × 弹丸数 × 每秒射击次数 */
export function tableDps(def: Pick<WeaponDef, 'damage' | 'pellets' | 'rpm'>, growthDamage = 1, fireRateMult = 1): number {
  const interval = fireIntervalSeconds(def.rpm, fireRateMult);
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  return shotDamage(def.damage, 1, growthDamage) * Math.max(def.pellets, 1) / interval;
}

/** 开火后能量（夹到 [0, energyMax]） */
export function energyAfterShot(current: number, energyGain: number, energyGainMult: number, energyMax: number): number {
  return clamp(current + energyGain * energyGainMult, 0, energyMax);
}
