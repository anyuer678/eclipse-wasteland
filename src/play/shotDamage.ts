/**
 * play/shotDamage — 玩家单发命中伤害的乘数链（纯函数）。
 *
 * 顺序：基础伤害 × 等级压制 × 连杀 × 隐身/角色 × 攻击倍率 × 暴击 × 局内伤害，
 * 最后叠加高地优势；NaN/非正数回退基础伤害。
 */
export interface ShotDamageInput {
  base: number;
  /** 等级压制系数（等级差越大越偏离 1） */
  suppression: number;
  killStreak: number;
  /** 隐身倍率（未隐身传 1） */
  stealthMult: number;
  attackMult: number;
  critChance: number;
  /** 暴击倍率（武器 critMult + 局内暴击伤害加成） */
  critMult: number;
  runDamageMult: number;
  highGround: boolean;
}

export interface ShotDamageOutput {
  damage: number;
  isCrit: boolean;
}

export function shotDamage(i: ShotDamageInput, rand: () => number = Math.random): ShotDamageOutput {
  const isCrit = rand() < i.critChance;
  const critMult = isCrit ? i.critMult : 1;
  let dmg =
    i.base *
    i.suppression *
    (1 + Math.min(i.killStreak, 6) * 0.05) *
    i.stealthMult *
    i.attackMult *
    critMult *
    i.runDamageMult;
  if (!Number.isFinite(dmg) || dmg <= 0) dmg = i.base; // NaN 防护
  if (i.highGround) dmg *= 1.2;
  return { damage: dmg, isCrit };
}
