/**
 * arsenal/defs — 武器配表（data-driven）。
 *
 * 所有可调数值集中在此，调平衡只改这一个文件。
 * 每把武器挂一种"机制"（mech），对应经典射击游戏式玩法：
 *   energy  — 能量资源：射击积攒，右键耗能爆发
 *   overload— 形态切换：E 在常规/过载形态间切换
 *   lockon  — 索敌：右键锁定并连线最近目标
 *   slow    — 控制：命中施加减速
 *   charge  — 蓄力：按住左键提升伤害
 *   beam    — 持续射线：按住左键喷射，耗能量不耗弹
 *   chain   — 连锁闪电：命中后弹跳伤害
 *   guard   — 治疗：E 键治疗玩家
 */

export type Archetype = 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'sniper';

export type Rarity = 'common' | 'fine' | 'hero' | 'gold' | 'legend';

/** 稀有度配色（UI 显示用） */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9aa0a6',
  fine: '#3d6b4a',
  hero: '#5a86b8',
  gold: '#d9a44a',
  legend: '#c04535',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '普通',
  fine: '卓越',
  hero: '英雄',
  gold: '黄金',
  legend: '传说',
};

export type MechSpec =
  | { kind: 'energy'; cost: number; multiplier: number }
  | { kind: 'overload'; energyPerSec: number }
  | { kind: 'lockon'; range: number; damageFactor: number }
  | { kind: 'slow'; factor: number; seconds: number }
  | { kind: 'charge'; maxMult: number; time: number }
  | { kind: 'beam'; dps: number; energyPerSec: number; range: number }
  | { kind: 'chain'; jumps: number; falloff: number }
  | { kind: 'guard'; heal: number; cooldown: number }
  | { kind: 'burst'; shots: number; burstDelay: number }
  | { kind: 'pierce'; targets: number; falloff: number };

export interface WeaponDef {
  id: string;
  name: string;
  archetype: Archetype;
  rarity: Rarity;
  damage: number;
  rpm: number;
  mag: number;
  pellets: number;
  spreadDeg: number;
  critMult: number;
  energyGain: number;
  energyMax: number;
  color: number;
  mech: MechSpec;
}

export const ARSENAL: WeaponDef[] = [
  {
    id: 'pulse-rifle',
    name: '脉冲步枪',
    archetype: 'rifle',
    rarity: 'hero',
    damage: 14,
    rpm: 600,
    mag: 120,
    pellets: 1,
    spreadDeg: 1.2,
    critMult: 1.5,
    energyGain: 4,
    energyMax: 100,
    color: 0x4a90d9,
    mech: { kind: 'energy', cost: 40, multiplier: 2.2 },
  },
  {
    id: 'fission-shotgun',
    name: '裂变霰弹',
    archetype: 'shotgun',
    rarity: 'gold',
    damage: 9,
    rpm: 90,
    mag: 20,
    pellets: 7,
    spreadDeg: 5.5,
    critMult: 1.4,
    energyGain: 2,
    energyMax: 100,
    color: 0xd97b2a,
    mech: { kind: 'overload', energyPerSec: 12 },
  },
  {
    id: 'arc-pistol',
    name: '电弧手枪',
    archetype: 'pistol',
    rarity: 'legend',
    damage: 26,
    rpm: 240,
    mag: 24,
    pellets: 1,
    spreadDeg: 0.8,
    critMult: 2.4,
    energyGain: 6,
    energyMax: 100,
    color: 0x8e5ad9,
    mech: { kind: 'lockon', range: 18, damageFactor: 1.8 },
  },
  {
    id: 'frost-smg',
    name: '霜锋冲锋',
    archetype: 'smg',
    rarity: 'fine',
    damage: 8,
    rpm: 900,
    mag: 80,
    pellets: 1,
    spreadDeg: 2.4,
    critMult: 1.5,
    energyGain: 3,
    energyMax: 100,
    color: 0x4ad0d9,
    mech: { kind: 'slow', factor: 0.55, seconds: 1.6 },
  },
  {
    id: 'dawn-sniper',
    name: '破晓狙击',
    archetype: 'sniper',
    rarity: 'gold',
    damage: 90,
    rpm: 40,
    mag: 20,
    pellets: 1,
    spreadDeg: 0.15,
    critMult: 2.8,
    energyGain: 10,
    energyMax: 100,
    color: 0xd9d24a,
    mech: { kind: 'charge', maxMult: 3, time: 1.2 },
  },
  {
    id: 'ember-spray',
    name: '烈焰风暴',
    archetype: 'rifle',
    rarity: 'hero',
    damage: 4,
    rpm: 600,
    mag: 60,
    pellets: 1,
    spreadDeg: 2.8,
    critMult: 1.2,
    energyGain: 2,
    energyMax: 100,
    color: 0xd95a2a,
    mech: { kind: 'beam', dps: 46, energyPerSec: 18, range: 16 },
  },
  {
    id: 'storm-javelin',
    name: '雷暴投枪',
    archetype: 'pistol',
    rarity: 'legend',
    damage: 22,
    rpm: 150,
    mag: 10,
    pellets: 1,
    spreadDeg: 1.0,
    critMult: 1.8,
    energyGain: 5,
    energyMax: 100,
    color: 0x5a86d9,
    mech: { kind: 'chain', jumps: 4, falloff: 0.65 },
  },
  {
    id: 'aurora-guard',
    name: '圣辉守护',
    archetype: 'smg',
    rarity: 'fine',
    damage: 7,
    rpm: 700,
    mag: 72,
    pellets: 1,
    spreadDeg: 2.2,
    critMult: 1.4,
    energyGain: 3,
    energyMax: 100,
    color: 0x8fc9a0,
    mech: { kind: 'guard', heal: 25, cooldown: 6 },
  },
  {
    id: 'tri-burst',
    name: '三连突击',
    archetype: 'rifle',
    rarity: 'gold',
    damage: 12,
    rpm: 220,
    mag: 90,
    pellets: 1,
    spreadDeg: 1.4,
    critMult: 1.6,
    energyGain: 4,
    energyMax: 100,
    color: 0xd9a44a,
    mech: { kind: 'burst', shots: 3, burstDelay: 0.06 },
  },
  {
    id: 'skypierce',
    name: '穿云狙击',
    archetype: 'sniper',
    rarity: 'legend',
    damage: 75,
    rpm: 35,
    mag: 10,
    pellets: 1,
    spreadDeg: 0.1,
    critMult: 2.6,
    energyGain: 8,
    energyMax: 100,
    color: 0xe8e0c8,
    mech: { kind: 'pierce', targets: 3, falloff: 0.6 },
  },
];

export function findDef(id: string): WeaponDef {
  const d = ARSENAL.find((w) => w.id === id);
  if (!d) throw new Error(`unknown weapon: ${id}`);
  return d;
}
