/**
 * campaign/missions — 关卡配置表。
 *
 * 副本制：选关卡进入 → 波次推进 → BOSS 战 → 结算掉落。
 * 数值（血量/数量）为占位，阶段 6（养成）后再做平衡。
 */
import type { MissionDef } from './types';

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1-facility',
    name: '废弃设施',
    mapId: 'facility',
    introSeconds: 3,
    waves: [
      { chasers: 5, boomers: 0, spitters: 0 },
      { chasers: 6, boomers: 2, spitters: 0 },
      { chasers: 8, boomers: 2, spitters: 2 },
    ],
    boss: {
      id: 'behemoth', name: '巨兽·拉格纳', hp: 600, color: 0x8a2bd9, skillInterval: 3.2,
      resistance: { physical: 0, fire: 1, ice: 2, energy: 0 },
      bossType: 'beast', phaseThresholds: [0.5],
    },
    rewards: { material: '合金碎片', amount: 12 },
  },
  {
    id: 'm2-quarry',
    name: '废弃矿场',
    mapId: 'quarry',
    introSeconds: 3,
    waves: [
      { chasers: 8, boomers: 1, spitters: 1 },
      { chasers: 10, boomers: 3, spitters: 2 },
      { chasers: 12, boomers: 3, spitters: 3 },
    ],
    boss: {
      id: 'titan', name: '泰坦·铸炉', hp: 1000, color: 0xd94a5e, skillInterval: 2.8,
      resistance: { physical: 1, fire: 3, ice: 0, energy: 1 },
      bossType: 'mech', phaseThresholds: [0.6, 0.3],
    },
    rewards: { material: '核心晶体', amount: 8 },
  },
  {
    id: 'm3-lab',
    name: '废弃实验室',
    mapId: 'lab',
    introSeconds: 3,
    waves: [
      { chasers: 10, boomers: 2, spitters: 2 },
      { chasers: 12, boomers: 3, spitters: 3 },
      { chasers: 14, boomers: 4, spitters: 4 },
    ],
    boss: {
      id: 'warden', name: '守卫者·原型', hp: 1400, color: 0x2e6e8a, skillInterval: 2.5,
      resistance: { physical: 2, fire: 0, ice: 0, energy: 3 },
      bossType: 'mech', phaseThresholds: [0.7, 0.4],
    },
    rewards: { material: '核心晶体', amount: 12 },
  },
  // ---- 新增 BOSS 体系 ----
  {
    id: 'm4-volcano',
    name: '熔岩深渊',
    mapId: 'facility',
    introSeconds: 4,
    waves: [
      { chasers: 12, boomers: 3, spitters: 3, berserkers: 1 },
      { chasers: 14, boomers: 4, spitters: 3, berserkers: 2 },
      { chasers: 16, boomers: 5, spitters: 4, berserkers: 2, guards: 1 },
    ],
    boss: {
      id: 'firedragon', name: '火龙·炎魔', hp: 2000, color: 0xff4400, skillInterval: 2.2,
      resistance: { physical: 1, fire: 3, ice: 0, energy: 1 },
      bossType: 'elemental', phaseThresholds: [0.7, 0.4, 0.15],
    },
    rewards: { material: '核心晶体', amount: 15 },
  },
  {
    id: 'm5-ice',
    name: '冰霜要塞',
    mapId: 'quarry',
    introSeconds: 4,
    waves: [
      { chasers: 14, boomers: 2, spitters: 4, guards: 2 },
      { chasers: 16, boomers: 3, spitters: 5, guards: 2, berserkers: 1 },
      { chasers: 18, boomers: 4, spitters: 5, guards: 3, berserkers: 2 },
    ],
    boss: {
      id: 'shiva', name: '希瓦女神', hp: 2500, color: 0x44ccff, skillInterval: 2.0,
      resistance: { physical: 1, fire: 0, ice: 3, energy: 1 },
      bossType: 'elemental', phaseThresholds: [0.65, 0.35, 0.1],
    },
    rewards: { material: '合金碎片', amount: 20 },
  },
  {
    id: 'm6-cyber',
    name: '赛博都市',
    mapId: 'lab',
    introSeconds: 4,
    waves: [
      { chasers: 16, boomers: 4, spitters: 4, guards: 2, berserkers: 1 },
      { chasers: 18, boomers: 5, spitters: 5, guards: 3, berserkers: 2, casters: 1 },
      { chasers: 20, boomers: 6, spitters: 6, guards: 3, berserkers: 3, casters: 2 },
    ],
    boss: {
      id: 'chimera', name: '奇美拉·合体', hp: 3000, color: 0x00ff88, skillInterval: 1.8,
      resistance: { physical: 2, fire: 1, ice: 1, energy: 2 },
      bossType: 'mech', phaseThresholds: [0.75, 0.5, 0.25],
    },
    rewards: { material: '核心晶体', amount: 18 },
  },
  {
    id: 'tower',
    name: '试炼之塔',
    mapId: 'facility',
    introSeconds: 3,
    waves: [{ chasers: 4, boomers: 0, spitters: 0 }],
    boss: {
      id: 'tower-boss', name: '塔主', hp: 600, color: 0x5a2bd9, skillInterval: 3.2,
      resistance: { physical: 0, fire: 0, ice: 0, energy: 0 },
      bossType: 'undead',
    },
    rewards: { material: '合金碎片', amount: 10 },
    tower: true,
  },
];

export function findMission(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
