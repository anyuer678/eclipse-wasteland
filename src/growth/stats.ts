/**
 * growth/stats — 玩家属性系统（玩家属性系统）。
 *
 * 四围（角色四维）：
 *   体质 Body   → 最大生命
 *   力量 Power  → 伤害倍率
 *   知识 Mind   → 暴击率 / 能量回复
 *   敏捷 Agility→ 移速 / 攻速
 * 四围来源：武器成长（附魔/巅峰）与天赋。
 * 战力 = 四围属性加权折算的综合评分。
 */

export interface PlayerStats {
  /** 攻击倍率（1 + 天赋dmg + 攻击药水 + 巅峰） */
  attackMult: number;
  /** 暴击率 0-1（基础 + 附魔 + 巅峰） */
  critRate: number;
  /** 暴击伤害倍率 */
  critMult: number;
  /** 护甲减伤 0-0.6（护盾药剂临时提升） */
  armor: number;
  /** 移速倍率（加速药水临时提升） */
  speedMult: number;
  /** 能量回复/秒（天赋能量亲和提升） */
  energyRegen: number;
  /** 最大生命加成（体质/巅峰） */
  maxHpBonus: number;
  /** 攻速倍率（敏捷/附魔） */
  fireRateMult: number;
}

export type BuffKind = 'atk' | 'shield' | 'speed';

export interface BuffState {
  atk: number; // 剩余秒
  shield: number;
  speed: number;
}

export const BUFF_DURATION: Record<BuffKind, number> = { atk: 20, shield: 10, speed: 12 };

/** 四围（角色属性面板展示） */
export interface FourStats {
  body: number;
  power: number;
  mind: number;
  agility: number;
}

/**
 * 基础属性 + 天赋 + 武器成长（附魔/巅峰汇总）。
 * @param growth 全武器成长汇总 { enchant: 总附魔, pinnacle: 总巅峰 }
 */
export function baseStats(
  dmgBonus: number,
  hpBonus: number,
  energyBonus: number,
  growth: { enchant: number; pinnacle: number }
): PlayerStats {
  // 力量：巅峰伤害加成；知识：附魔+巅峰暴击；敏捷：附魔攻速；体质：巅峰生命
  const powerBonus = growth.pinnacle * 0.03;
  const critBonus = growth.enchant * 0.01 + Math.floor(growth.pinnacle / 5) * 0.01;
  const speedBonus = growth.enchant * 0.02;
  return {
    attackMult: 1 + dmgBonus + powerBonus,
    critRate: Math.min(0.45, 0.06 + critBonus),
    critMult: 1.6,
    armor: 0,
    speedMult: 1,
    energyRegen: 1 + energyBonus,
    maxHpBonus: growth.pinnacle * 5 + hpBonus,
    fireRateMult: 1 + speedBonus,
  };
}

/** 四围数值（供属性面板展示；天赋/成长折算） */
export function fourStats(stats: PlayerStats): FourStats {
  return {
    body: Math.round(stats.maxHpBonus),
    power: Math.round((stats.attackMult - 1) * 100),
    mind: Math.round(stats.critRate * 100),
    agility: Math.round((stats.fireRateMult - 1) * 100),
  };
}

/** 战力 = 四围加权折算综合评分（战力系统） */
export function powerScore(stats: PlayerStats, maxHp: number): number {
  return Math.round(
    stats.attackMult * 100 +
      stats.critRate * 80 +
      (stats.critMult - 1) * 40 +
      stats.armor * 120 +
      (stats.speedMult - 1) * 60 +
      (stats.fireRateMult - 1) * 50 +
      stats.maxHpBonus * 2 +
      maxHp * 0.3
  );
}

/** 应用临时 BUFF 后的实时属性 */
export function applyBuffs(base: PlayerStats, buffs: BuffState): PlayerStats {
  return {
    ...base,
    attackMult: base.attackMult + (buffs.atk > 0 ? 0.25 : 0),
    armor: Math.min(0.6, base.armor + (buffs.shield > 0 ? 0.35 : 0)),
    speedMult: base.speedMult + (buffs.speed > 0 ? 0.3 : 0),
  };
}

/** 触发 BUFF */
export function applyBuff(buffs: BuffState, kind: BuffKind): void {
  buffs[kind] = BUFF_DURATION[kind];
}

/** 每帧递减 BUFF */
export function tickBuffs(buffs: BuffState, dt: number): void {
  if (buffs.atk > 0) buffs.atk = Math.max(0, buffs.atk - dt);
  if (buffs.shield > 0) buffs.shield = Math.max(0, buffs.shield - dt);
  if (buffs.speed > 0) buffs.speed = Math.max(0, buffs.speed - dt);
}
