/**
 * growth/upgrade — 强化与进阶规则。
 *
 * 数值与关卡奖励经济对齐（missions.ts 奖励 ≈ 合金 10-48 / 核心 12-48 每次通关）：
 *   同步强化：每级 +5% 武器伤害，成本 2 + 等级/4 合金（等级越高越贵，拉满按材料自动停）
 *   进阶：0-3 阶，每阶武器机制效果 +50%，消耗核心晶体 8/16/24
 *   符文：0-10 级，每级 +2% 伤害，每 2 级解锁 1 个词缀槽
 *   附魔：0-20 级，每级暴击 +1% / 攻速 +2%
 *   巅峰：0-15 级，每级伤害 +3% / 生命 +5，每 5 级额外暴击 +1%
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

/** 进阶效果（文案+数值同表）：num 为该阶效果的数值载荷，由各系 ascensionMods 消费 */
export interface AscensionEffect {
  text: string;
  num?: number;
}

export const ASCENSION_EFFECTS: Record<string, AscensionEffect[]> = {
  energy: [{ text: '爆发伤害 +10%' }, { text: '爆发命中附加 1s 易伤' }, { text: '过载暴击率 +8%' }],
  overload: [{ text: '过载伤害 +10%' }, { text: '过载期间移速 +15%' }, { text: '过载能量消耗 -30%' }],
  lockon: [{ text: '索敌范围 +25%' }, { text: '电弧可弹射 1 次' }, { text: '索敌伤害 +20%' }],
  slow: [
    { text: '减速持续时间 +40%', num: 1.4 },
    { text: '霜缓命中附加 5 点伤害', num: 5 },
    { text: '减速效果提升至 60%', num: 0.4 },
  ],
  charge: [{ text: '蓄力速度 +25%' }, { text: '满蓄力附加穿透' }, { text: '蓄力暴击率 +12%' }],
  beam: [
    { text: '射线射程 +30%', num: 1.3 },
    { text: '射线伤害 +12%', num: 1.12 },
    { text: '射线能量消耗 -25%', num: 0.75 },
  ],
  chain: [
    { text: '弹跳次数 +1', num: 1 },
    { text: '弹跳衰减降低', num: 0.75 },
    { text: '首跳伤害 +20%', num: 1.2 },
  ],
  guard: [{ text: '治疗量 +40%' }, { text: '治疗附加 2s 护盾' }, { text: '冷却时间 -25%' }],
};

/** 某武器当前进阶已解锁/下一阶效果文案 */
export function ascensionEffectsFor(mechKind: string, ascension: number): { next: string | null; unlocked: string[] } {
  const list = ASCENSION_EFFECTS[mechKind] ?? [];
  return {
    unlocked: list.slice(0, ascension).map((r) => r.text),
    next: ascension < list.length ? list[ascension].text : null,
  };
}

/** 前 n 阶效果的数值载荷（无载荷的阶为 undefined；n 夹取 0-3） */
function ascensionNums(kind: string, n: number): (number | undefined)[] {
  return (ASCENSION_EFFECTS[kind] ?? []).slice(0, Math.max(0, Math.min(3, n))).map((r) => r.num);
}

export interface ChainAscensionMods {
  jumpsBonus: number;
  falloffOverride: number | null;
  firstHitMult: number;
}

/** chain 进阶数值：阶1 弹跳 +1 · 阶2 衰减改 0.75 · 阶3 首跳 ×1.2 */
export function chainAscensionMods(ascension: number): ChainAscensionMods {
  const [jumps, falloff, first] = ascensionNums('chain', ascension);
  return { jumpsBonus: jumps ?? 0, falloffOverride: falloff ?? null, firstHitMult: first ?? 1 };
}

export interface BeamAscensionMods {
  rangeMult: number;
  damageMult: number;
  energyMult: number;
}

/** beam 进阶数值：阶1 射程 ×1.3 · 阶2 伤害 ×1.12 · 阶3 能耗 ×0.75 */
export function beamAscensionMods(ascension: number): BeamAscensionMods {
  const [range, damage, energy] = ascensionNums('beam', ascension);
  return { rangeMult: range ?? 1, damageMult: damage ?? 1, energyMult: energy ?? 1 };
}

export interface SlowAscensionMods {
  durationMult: number;
  hitBonus: number;
  factorOverride: number | null;
}

/** slow 进阶数值：阶1 时长 ×1.4 · 阶2 命中附加 5 伤害 · 阶3 减速系数改 0.4（60% 减速） */
export function slowAscensionMods(ascension: number): SlowAscensionMods {
  const [duration, bonus, factor] = ascensionNums('slow', ascension);
  return { durationMult: duration ?? 1, hitBonus: bonus ?? 0, factorOverride: factor ?? null };
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
  // 同步强化成本：2 + 每 4 级 +1 合金（与关卡奖励对齐：中期关卡数小时可拉满数十级）
  const cost = 2 + Math.floor(g.level / 4);
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
  const cost = 8 + g.ascension * 8; // 进阶 8/16/24 核心晶体（机制 +50%/阶，成本高于附魔）
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
