/**
 * growth/upgrade — 强化与进阶规则。
 *
 * 数值为占位（用户要求数值体系后续单独设计），当前规则：
 *   强化：每级 +5% 武器伤害，消耗 合金碎片（等级越高越贵）
 *   进阶：0-3 阶，每阶武器机制效果 +50%，消耗 核心晶体
 * 属性计算函数供武器系统查询：伤害倍率 / 机制倍率。
 */
import type { WeaponDef } from '../arsenal';
import type { Inventory } from './inventory';

/** 强化：每级伤害加成 */
export const LEVEL_DAMAGE_STEP = 0.05;
/** 拉满一次升级数（每次点击升 500 级，可重复点继续升） */
export const MAX_SYNC_STEP = 500;
/** 进阶：每阶机制加成 */
export const ASCENSION_MECH_STEP = 0.5;
/** 进阶上限 */
export const MAX_ASCENSION = 3;

/** 配件改装：每阶进阶解锁的新效果描述（配件机制） */
export const ASCENSION_EFFECTS: Record<string, string[]> = {
  energy: ['爆发伤害 +10%', '爆发命中附加 1s 易伤', '过载暴击率 +8%'],
  overload: ['过载伤害 +10%', '过载期间移速 +15%', '过载能量消耗 -30%'],
  lockon: ['索敌范围 +25%', '电弧可弹射 1 次', '索敌伤害 +20%'],
  slow: ['减速持续时间 +40%', '霜缓命中附加 5 点伤害', '减速效果提升至 60%'],
  charge: ['蓄力速度 +25%', '满蓄力附加穿透', '蓄力暴击率 +12%'],
  beam: ['射线射程 +30%', '射线伤害 +12%', '射线能量消耗 -25%'],
  chain: ['弹跳次数 +1', '弹跳衰减降低', '首跳伤害 +20%'],
  guard: ['治疗量 +40%', '治疗附加 2s 护盾', '冷却时间 -25%'],
};

/** 某武器当前进阶已解锁/下一阶效果文案 */
export function ascensionEffectsFor(mechKind: string, ascension: number): { next: string | null; unlocked: string[] } {
  const list = ASCENSION_EFFECTS[mechKind] ?? [];
  return {
    unlocked: list.slice(0, ascension),
    next: ascension < list.length ? list[ascension] : null,
  };
}
/** 符文：每级伤害加成 */
export const RUNE_DAMAGE_STEP = 0.02;
/** 符文上限 */
export const MAX_RUNE = 10;

/** 符文词缀（词缀体系）：每 2 级符文解锁 1 个词缀槽（最多 5 个） */
export const AFFIX_POOL: { kind: 'atk' | 'crit' | 'spd' | 'energy' | 'vamp'; name: string; desc: string; min: number; max: number }[] = [
  { kind: 'atk', name: '凶残', desc: '伤害 +', min: 0.02, max: 0.06 },
  { kind: 'crit', name: '精准', desc: '暴击率 +', min: 0.01, max: 0.03 },
  { kind: 'spd', name: '迅捷', desc: '攻速 +', min: 0.02, max: 0.05 },
  { kind: 'energy', name: '充沛', desc: '能量获取 +', min: 0.04, max: 0.1 },
  { kind: 'vamp', name: '嗜血', desc: '吸血 +', min: 0.005, max: 0.02 },
];

/** 词缀数量 = 符文等级 / 2（2,4,6,8,10 → 1-5 个） */
export function affixSlots(rune: number): number {
  return Math.floor(rune / 2);
}

/** 随机生成一个新词缀（类型随机，数值在值域内） */
export function rollAffix(): { kind: 'atk' | 'crit' | 'spd' | 'energy' | 'vamp'; value: number } {
  const pool = AFFIX_POOL;
  const idx = Math.floor(Math.random() * pool.length);
  const t = pool[idx];
  const value = +(t.min + Math.random() * (t.max - t.min)).toFixed(4);
  return { kind: t.kind, value };
}

/** 词缀伤害加成汇总 */
export function affixDamageMult(g: { affixes: { kind: string; value: number }[] }): number {
  return g.affixes.filter((a) => a.kind === 'atk').reduce((s, a) => s + a.value, 0);
}
/** 词缀暴击率加成 */
export function affixCritMult(g: { affixes: { kind: string; value: number }[] }): number {
  return g.affixes.filter((a) => a.kind === 'crit').reduce((s, a) => s + a.value, 0);
}
/** 词缀攻速加成 */
export function affixSpdMult(g: { affixes: { kind: string; value: number }[] }): number {
  return g.affixes.filter((a) => a.kind === 'spd').reduce((s, a) => s + a.value, 0);
}
/** 词缀能量获取加成 */
export function affixEnergyMult(g: { affixes: { kind: string; value: number }[] }): number {
  return g.affixes.filter((a) => a.kind === 'energy').reduce((s, a) => s + a.value, 0);
}
/** 词缀吸血（伤害的百分比回血） */
export function affixVampMult(g: { affixes: { kind: string; value: number }[] }): number {
  return g.affixes.filter((a) => a.kind === 'vamp').reduce((s, a) => s + a.value, 0);
}

/** 附魔：每级暴击率加成 / 攻速加成（附魔/皮肤强化） */
export const ENCHANT_CRIT_STEP = 0.01;
export const ENCHANT_SPD_STEP = 0.02;
export const MAX_ENCHANT = 20;

/** 巅峰：每级伤害加成 / 生命加成，每 5 级额外暴击（巅峰突破） */
export const PINNACLE_DMG_STEP = 0.03;
export const PINNACLE_HP_STEP = 5;
export const PINNACLE_CRIT_INTERVAL = 5;
export const MAX_PINNACLE = 15;

/** 计算某武器当前成长下的伤害倍率（同步 + 符文 + 巅峰 + 词缀 + 熟练度） */
export function damageMultiplier(def: WeaponDef, inventory: Inventory): number {
  const g = inventory.getWeapon(def.id);
  // 熟练度：每 20 杀 +1 级，每级 +2% 伤害（上限 10 级 = 200 杀）
  const mastery = Math.min(10, Math.floor(g.kills / 20)) * 0.02;
  return 1 + g.level * LEVEL_DAMAGE_STEP + g.rune * RUNE_DAMAGE_STEP + g.pinnacle * PINNACLE_DMG_STEP + affixDamageMult(g) + mastery;
}

/** 计算某武器当前成长下的机制倍率（爆发/蓄力/索敌等效果增强） */
export function mechMultiplier(def: WeaponDef, inventory: Inventory): number {
  const g = inventory.getWeapon(def.id);
  return 1 + g.ascension * ASCENSION_MECH_STEP;
}

/** 尝试强化一次，成功返回新等级，失败（材料不足）返回 null */
export function tryUpgrade(def: WeaponDef, inventory: Inventory): { level: number; cost: number } | null {
  const g = inventory.getWeapon(def.id);
  const cost = (g.level + 1) * 2; // 强化成本随等级增长
  if (!inventory.spendMaterial('合金碎片', cost)) return null;
  g.level += 1;
  inventory.persist();
  return { level: g.level, cost };
}

/** 一键强化 n 级：连续强化直到 n 次或材料不足；返回实际强化次数 */
export function tryUpgradeN(def: WeaponDef, inventory: Inventory, n: number): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (!tryUpgrade(def, inventory)) break;
    done++;
  }
  return done;
}

/** 拉满：一次升 500 级（可重复点击继续升，无等级上限） */
export function tryUpgradeMax(def: WeaponDef, inventory: Inventory): number {
  return tryUpgradeN(def, inventory, MAX_SYNC_STEP);
}

/** 附魔一次：暴击 +1%、攻速 +2%（消耗核心晶体） */
export function tryEnchant(def: WeaponDef, inventory: Inventory): { enchant: number; cost: number } | null {
  const g = inventory.getWeapon(def.id);
  if (g.enchant >= MAX_ENCHANT) return null;
  const cost = 4 + g.enchant * 2;
  if (!inventory.spendMaterial('核心晶体', cost)) return null;
  g.enchant += 1;
  inventory.persist();
  return { enchant: g.enchant, cost };
}

/** 一键附魔 n 级 */
export function tryEnchantN(def: WeaponDef, inventory: Inventory, n: number): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (!tryEnchant(def, inventory)) break;
    done++;
  }
  return done;
}

/** 巅峰突破一次：伤害 +3%、生命 +5，每 5 级暴击 +1%（消耗合金碎片 + 金币） */
export function tryPinnacle(def: WeaponDef, inventory: Inventory): { pinnacle: number; costM: number; costG: number } | null {
  const g = inventory.getWeapon(def.id);
  if (g.pinnacle >= MAX_PINNACLE) return null;
  const costM = 6 + g.pinnacle * 3;
  const costG = 40 + g.pinnacle * 20;
  if (!inventory.spendMaterial('合金碎片', costM)) return null;
  if (!inventory.spendGold(costG)) {
    inventory.addMaterial('合金碎片', costM); // 回滚材料
    return null;
  }
  g.pinnacle += 1;
  inventory.persist();
  return { pinnacle: g.pinnacle, costM, costG };
}

/** 一键巅峰 n 级 */
export function tryPinnacleN(def: WeaponDef, inventory: Inventory, n: number): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (!tryPinnacle(def, inventory)) break;
    done++;
  }
  return done;
}

/** 附魔/巅峰提供的暴击率加成（附魔 + 巅峰每 5 级） */
export function critFromGrowth(g: { enchant: number; pinnacle: number }): number {
  return g.enchant * ENCHANT_CRIT_STEP + Math.floor(g.pinnacle / PINNACLE_CRIT_INTERVAL) * 0.01;
}

/** 尝试进阶一次，成功返回新阶数，失败返回 null */
export function tryAscend(def: WeaponDef, inventory: Inventory): { ascension: number; cost: number } | null {
  const g = inventory.getWeapon(def.id);
  if (g.ascension >= MAX_ASCENSION) return null;
  const cost = 5 + g.ascension * 5;
  if (!inventory.spendMaterial('核心晶体', cost)) return null;
  g.ascension += 1;
  inventory.persist();
  return { ascension: g.ascension, cost };
}

/** 尝试符文升级一次，成功返回新等级，失败返回 null（每 2 级解锁新词缀） */
export function tryRuneUpgrade(def: WeaponDef, inventory: Inventory): { rune: number; cost: number; affix: boolean } | null {
  const g = inventory.getWeapon(def.id);
  if (g.rune >= MAX_RUNE) return null;
  const cost = 3 + g.rune * 2;
  if (!inventory.spendMaterial('核心晶体', cost)) return null;
  g.rune += 1;
  let affix = false;
  // 到达词缀槽位（2/4/6/8/10）时生成新词缀
  if (g.rune % 2 === 0) {
    g.affixes.push(rollAffix());
    affix = true;
  }
  inventory.persist();
  return { rune: g.rune, cost, affix };
}
