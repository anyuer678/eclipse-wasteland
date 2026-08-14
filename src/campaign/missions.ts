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
    boss: { id: 'behemoth', name: '巨兽·拉格纳', hp: 600, color: 0x8a2bd9, skillInterval: 3.2 },
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
    boss: { id: 'titan', name: '泰坦·铸炉', hp: 1000, color: 0xd94a5e, skillInterval: 2.8 },
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
    boss: { id: 'warden', name: '守卫者·原型', hp: 1400, color: 0x2e6e8a, skillInterval: 2.5 },
    rewards: { material: '核心晶体', amount: 12 },
  },
  {
    id: 'tower',
    name: '试炼之塔',
    mapId: 'facility',
    introSeconds: 3,
    waves: [{ chasers: 4, boomers: 0, spitters: 0 }],
    boss: { id: 'tower-boss', name: '塔主', hp: 600, color: 0x5a2bd9, skillInterval: 3.2 },
    rewards: { material: '合金碎片', amount: 10 },
    tower: true,
  },
];

export function findMission(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
