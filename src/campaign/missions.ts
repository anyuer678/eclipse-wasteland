/**
 * campaign/missions — 关卡配置表。
 *
 * 副本制：选关卡进入 → 波次推进 → BOSS 战 → 结算掉落。
 * 等级分层：怪物等级按 2 递进（Lv1 → Lv21），与玩家局内等级、天赋/强化成长曲线对齐；
 * 每波 +1、BOSS +2，难度另带等级偏移（轻松 -2 / 困难 +2 / 噩梦 +4）。
 * 奖励：合金碎片/核心晶体数量随等级线性放大，配合强化成本表（upgrade.ts）结算。
 */
import type { MissionDef } from './types';

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1-facility',
    name: '废弃设施',
    monsterLevel: 1,
    mapId: 'facility',
    introSeconds: 3,
    waves: [
      { chasers: 5, boomers: 0, spitters: 0 },
      { chasers: 6, boomers: 2, spitters: 0 },
      { chasers: 8, boomers: 2, spitters: 2 },
    ],
    boss: {
      id: 'behemoth', name: '巨兽·拉格纳', hp: 550, color: 0x8a2bd9, skillInterval: 3.2,
      resistance: { physical: 0, fire: 1, ice: 2, energy: 0 },
      bossType: 'beast', phaseThresholds: [0.5],
    },
    rewards: { material: '合金碎片', amount: 10 },
  },
  {
    id: 'm2-quarry',
    name: '废弃矿场',
    monsterLevel: 3,
    mapId: 'quarry',
    introSeconds: 3,
    waves: [
      { chasers: 7, boomers: 1, spitters: 1 },
      { chasers: 9, boomers: 3, spitters: 2 },
      { chasers: 11, boomers: 3, spitters: 3 },
    ],
    boss: {
      id: 'titan', name: '泰坦·铸炉', hp: 790, color: 0xd94a5e, skillInterval: 3.0,
      resistance: { physical: 1, fire: 3, ice: 0, energy: 1 },
      bossType: 'mech', phaseThresholds: [0.6, 0.3],
    },
    rewards: { material: '核心晶体', amount: 12 },
  },
  {
    id: 'm3-pipeline',
    name: '腐蚀管道',
    monsterLevel: 5,
    mapId: 'facility',
    introSeconds: 3,
    waves: [
      { chasers: 9, boomers: 2, spitters: 1 },
      { chasers: 11, boomers: 3, spitters: 2 },
      { chasers: 13, boomers: 4, spitters: 3, guards: 1 },
    ],
    boss: {
      id: 'python', name: '管道巨蟒', hp: 1030, color: 0x6b8e23, skillInterval: 2.8,
      resistance: { physical: 0, fire: 2, ice: 0, energy: 1 },
      bossType: 'beast', phaseThresholds: [0.6, 0.3],
    },
    rewards: { material: '合金碎片', amount: 16 },
  },
  {
    id: 'm4-lab',
    name: '废弃实验室',
    monsterLevel: 7,
    mapId: 'lab',
    introSeconds: 3,
    waves: [
      { chasers: 10, boomers: 2, spitters: 2 },
      { chasers: 12, boomers: 3, spitters: 3 },
      { chasers: 14, boomers: 4, spitters: 4, guards: 1 },
    ],
    boss: {
      id: 'warden', name: '守卫者·原型', hp: 1270, color: 0x2e6e8a, skillInterval: 2.6,
      resistance: { physical: 2, fire: 0, ice: 0, energy: 3 },
      bossType: 'mech', phaseThresholds: [0.7, 0.4],
    },
    rewards: { material: '核心晶体', amount: 20 },
  },
  {
    id: 'm5-volcano',
    name: '熔岩深渊',
    monsterLevel: 9,
    mapId: 'volcano',
    introSeconds: 4,
    waves: [
      { chasers: 12, boomers: 3, spitters: 3, berserkers: 1 },
      { chasers: 14, boomers: 4, spitters: 3, berserkers: 2 },
      { chasers: 16, boomers: 5, spitters: 4, berserkers: 2, guards: 1 },
    ],
    boss: {
      id: 'firedragon', name: '火龙·炎魔', hp: 1510, color: 0xff4400, skillInterval: 2.4,
      resistance: { physical: 1, fire: 3, ice: 0, energy: 1 },
      bossType: 'elemental', phaseThresholds: [0.7, 0.4, 0.15],
    },
    rewards: { material: '核心晶体', amount: 24 },
  },
  {
    id: 'm6-ice',
    name: '冰霜要塞',
    monsterLevel: 11,
    mapId: 'ice',
    introSeconds: 4,
    waves: [
      { chasers: 14, boomers: 2, spitters: 4, guards: 2 },
      { chasers: 16, boomers: 3, spitters: 5, guards: 2, berserkers: 1 },
      { chasers: 18, boomers: 4, spitters: 5, guards: 3, berserkers: 2 },
    ],
    boss: {
      id: 'shiva', name: '希瓦女神', hp: 1750, color: 0x44ccff, skillInterval: 2.2,
      resistance: { physical: 1, fire: 0, ice: 3, energy: 1 },
      bossType: 'elemental', phaseThresholds: [0.65, 0.35, 0.1],
    },
    rewards: { material: '合金碎片', amount: 28 },
  },
  {
    id: 'm7-deepquarry',
    name: '深井矿脉',
    monsterLevel: 13,
    mapId: 'quarry',
    introSeconds: 4,
    waves: [
      { chasers: 16, boomers: 3, spitters: 4, guards: 2, berserkers: 1 },
      { chasers: 18, boomers: 4, spitters: 5, guards: 2, berserkers: 2 },
      { chasers: 20, boomers: 5, spitters: 5, guards: 3, berserkers: 2, casters: 1 },
    ],
    boss: {
      id: 'golem', name: '掘金魔像', hp: 1990, color: 0x8b7355, skillInterval: 2.2,
      resistance: { physical: 3, fire: 0, ice: 1, energy: 0 },
      bossType: 'mech', phaseThresholds: [0.6, 0.3],
    },
    rewards: { material: '核心晶体', amount: 32 },
  },
  {
    id: 'm8-cyber',
    name: '赛博都市',
    monsterLevel: 15,
    mapId: 'lab',
    introSeconds: 4,
    waves: [
      { chasers: 16, boomers: 4, spitters: 4, guards: 2, berserkers: 1 },
      { chasers: 18, boomers: 5, spitters: 5, guards: 3, berserkers: 2, casters: 1 },
      { chasers: 20, boomers: 6, spitters: 6, guards: 3, berserkers: 3, casters: 2 },
    ],
    boss: {
      id: 'chimera', name: '奇美拉·合体', hp: 2230, color: 0x00ff88, skillInterval: 2.0,
      resistance: { physical: 2, fire: 1, ice: 1, energy: 2 },
      bossType: 'mech', phaseThresholds: [0.75, 0.5, 0.25],
    },
    rewards: { material: '核心晶体', amount: 36 },
  },
  {
    id: 'm9-magma',
    name: '熔岩核心',
    monsterLevel: 17,
    mapId: 'volcano',
    introSeconds: 4,
    waves: [
      { chasers: 18, boomers: 4, spitters: 5, guards: 3, berserkers: 2, casters: 1 },
      { chasers: 20, boomers: 5, spitters: 6, guards: 3, berserkers: 3, casters: 2 },
      { chasers: 22, boomers: 6, spitters: 6, guards: 4, berserkers: 3, casters: 2, turrets: 1 },
    ],
    boss: {
      id: 'magmalord', name: '熔心领主', hp: 2470, color: 0xff6600, skillInterval: 1.9,
      resistance: { physical: 1, fire: 3, ice: 0, energy: 2 },
      bossType: 'elemental', phaseThresholds: [0.7, 0.45, 0.2],
    },
    rewards: { material: '核心晶体', amount: 40 },
  },
  {
    id: 'm10-frostdeep',
    name: '霜之深处',
    monsterLevel: 19,
    mapId: 'ice',
    introSeconds: 5,
    waves: [
      { chasers: 20, boomers: 4, spitters: 6, guards: 3, berserkers: 2, casters: 2 },
      { chasers: 22, boomers: 5, spitters: 6, guards: 4, berserkers: 3, casters: 2, turrets: 1 },
      { chasers: 24, boomers: 6, spitters: 7, guards: 4, berserkers: 4, casters: 3, healers: 1 },
    ],
    boss: {
      id: 'frostqueen', name: '冰封女王', hp: 2710, color: 0xaaddff, skillInterval: 1.8,
      resistance: { physical: 1, fire: 0, ice: 3, energy: 2 },
      bossType: 'elemental', phaseThresholds: [0.7, 0.4, 0.15],
    },
    rewards: { material: '核心晶体', amount: 44 },
  },
  {
    id: 'm11-basement',
    name: '设施底层',
    monsterLevel: 21,
    mapId: 'facility',
    introSeconds: 5,
    waves: [
      { chasers: 22, boomers: 5, spitters: 6, guards: 4, berserkers: 3, casters: 2 },
      { chasers: 22, boomers: 5, spitters: 6, guards: 4, berserkers: 3, casters: 2, turrets: 1 },
      { chasers: 24, boomers: 6, spitters: 7, guards: 4, berserkers: 4, casters: 3, turrets: 2, healers: 1 },
      { chasers: 26, boomers: 7, spitters: 7, guards: 5, berserkers: 4, casters: 3, turrets: 2, healers: 2 },
    ],
    boss: {
      id: 'unit0', name: '零号机', hp: 2950, color: 0xcccccc, skillInterval: 1.7,
      resistance: { physical: 2, fire: 2, ice: 2, energy: 2 },
      bossType: 'mech', phaseThresholds: [0.75, 0.5, 0.25],
    },
    rewards: { material: '核心晶体', amount: 48 },
  },
  {
    id: 'm12-canyon',
    name: '裂谷栈桥',
    monsterLevel: 23,
    mapId: 'canyon',
    introSeconds: 5,
    waves: [
      { chasers: 24, boomers: 6, spitters: 7, guards: 4, berserkers: 4, casters: 3, turrets: 1 },
      { chasers: 26, boomers: 7, spitters: 8, guards: 5, berserkers: 4, casters: 3, turrets: 1, healers: 1 },
    ],
    boss: {
      id: 'canyonlord', name: '峡谷领主', hp: 3100, color: 0xd98a3a, skillInterval: 1.8,
      resistance: { physical: 1, fire: 1, ice: 1, energy: 1 },
      bossType: 'beast', phaseThresholds: [0.65, 0.3],
    },
    rewards: { material: '核心晶体', amount: 50 },
  },
  {
    id: 'tower',
    name: '试炼之塔',
    monsterLevel: 20,
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
