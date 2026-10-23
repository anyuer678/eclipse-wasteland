/**
 * play/loot — 局内掉落配表与随机（纯函数）。
 *
 * 宝箱奖励分支与 BUFF 球种类集中在这里，game 侧只负责生成模型与入库。
 */
export type OrbKind = 'fireSpd' | 'crit' | 'heal' | 'energy' | 'move';

export interface OrbDef {
  kind: OrbKind;
  color: number;
  label: string;
}

export const ORB_KINDS: readonly OrbDef[] = [
  { kind: 'fireSpd', color: 0xffd24a, label: '速射' },
  { kind: 'crit', color: 0xff6a4a, label: '暴击' },
  { kind: 'heal', color: 0x4aff8a, label: '回复' },
  { kind: 'energy', color: 0x4ad9ff, label: '充能' },
  { kind: 'move', color: 0xc9a0ff, label: '疾行' },
];

export interface ChestReward {
  reward: string;
  amount: number;
}

export function rollOrbKind(rand: () => number = Math.random): OrbDef {
  return ORB_KINDS[Math.floor(rand() * ORB_KINDS.length)]!;
}

/** 大宝箱：核心晶体 ×3 / 金币 ×40；小宝箱：材料/金币/医疗包 */
export function rollChestReward(big: boolean, rand: () => number = Math.random): ChestReward {
  const roll = rand();
  if (big) {
    return roll < 0.5 ? { reward: '核心晶体', amount: 3 } : { reward: '金币', amount: 40 };
  }
  if (roll < 0.45) return { reward: '合金碎片', amount: 2 + Math.floor(rand() * 3) };
  if (roll < 0.75) return { reward: '金币', amount: 10 + Math.floor(rand() * 15) };
  return { reward: 'medkit', amount: 1 };
}
