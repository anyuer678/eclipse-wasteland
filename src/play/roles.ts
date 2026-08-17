/**
 * play/roles — 角色系统（X 键大招）。
 *
 * 角色技能（隐身/召唤/持续伤害场），5 个角色：
 *   影袭者  — X 隐身 3 秒（隐身中伤害×2，敌人不攻击）
 *   机甲师  — X 召唤机甲分身自动攻击 10 秒
 *   炎术士  — X 施放炼狱灼烧场 4 秒（范围持续伤害+减速）
 *   圣徒    — X 施放圣光治疗场 5 秒（每秒回复生命）
 *   狂战士  — X 进入狂暴 4 秒（射速×1.5，受伤-30%）
 */

export type RoleKind = 'stealth' | 'summon' | 'inferno' | 'heal' | 'fury';

export interface RoleDef {
  id: string;
  name: string;
  desc: string;
  kind: RoleKind;
  cooldown: number;
  duration: number;
  color: number;
  /** 体型缩放 */
  scale?: { x: number; y: number; z: number };
}

export const ROLES: RoleDef[] = [
  {
    id: 'assassin',
    name: '影袭者',
    desc: 'X 进入隐身 3 秒：敌人不再锁定你，隐身中伤害×2',
    kind: 'stealth',
    cooldown: 12,
    duration: 3,
    color: 0x5a86b8,
    scale: { x: 1.0, y: 1.0, z: 0.92 },
  },
  {
    id: 'engineer',
    name: '机甲师',
    desc: 'X 召唤机甲分身，自动攻击 10 秒',
    kind: 'summon',
    cooldown: 16,
    duration: 10,
    color: 0xd97b2a,
    scale: { x: 1.43, y: 2.34, z: 1.37 },
  },
  {
    id: 'pyro',
    name: '炎术士',
    desc: 'X 在脚下施放炼狱灼烧场 4 秒：范围持续伤害+减速',
    kind: 'inferno',
    cooldown: 14,
    duration: 4,
    color: 0xd94a4a,
    scale: { x: 1.03, y: 1.42, z: 1.06 },
  },
  {
    id: 'saint',
    name: '圣徒',
    desc: 'X 施放圣光治疗场 5 秒：每秒回复 12 生命',
    kind: 'heal',
    cooldown: 18,
    duration: 5,
    color: 0x8ad94a,
    scale: { x: 1.0, y: 1.0, z: 1.0 },
  },
  {
    id: 'fury',
    name: '狂战士',
    desc: 'X 进入狂暴 4 秒：射速 ×1.5、受到伤害 -30%',
    kind: 'fury',
    cooldown: 16,
    duration: 4,
    color: 0xd94a4a,
    scale: { x: 1.67, y: 1.78, z: 1.15 },
  },
];

export function findRole(id: string): RoleDef {
  const r = ROLES.find((x) => x.id === id);
  if (!r) throw new Error(`unknown role: ${id}`);
  return r;
}
