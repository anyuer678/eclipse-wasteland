/**
 * campaign/rewards — 结算奖励数学（纯函数）。
 *
 * 难度倍率 × 局内幸运金币，按「普通通关 / 塔层通关 / 塔失败」分别计算
 * 材料、金币与天赋点；副作用（入库/成就/每日）留在 game 侧。
 */
export interface SettleInput {
  tower: boolean;
  towerFloor: number;
  rewardMaterial: string;
  rewardAmount: number;
  kills: number;
  /** 关卡基础怪物等级（普通关金币随等级成长） */
  missionLevel: number;
  difficulty: number;
  /** 局内「幸运」叠加的金币倍率（0.2/层） */
  luckyGold: number;
  /** 天赋「搜刮」金币加成 */
  goldBonus: number;
}

export interface RewardOut {
  material: string;
  materialAmount: number;
  gold: number;
  talentGain: number;
}

/** 难度奖励倍率（普通 ×1 / 困难 ×1.8 / 噩梦 ×3）× 局内幸运金币 */
export function difficultyRewardMult(difficulty: number, luckyGold = 0): number {
  const base = difficulty >= 2 ? 3 : difficulty >= 1.5 ? 1.8 : difficulty <= 0.8 ? 0.8 : 1;
  return base * (1 + luckyGold);
}

/** 通关（普通关或塔层）奖励 */
export function clearRewards(i: SettleInput): RewardOut {
  const d = difficultyRewardMult(i.difficulty, i.luckyGold);
  // 天赋点：通关基础 +1，每击杀 15 个敌人额外 +1（与天赋屏提示一致）
  const talentGain = 1 + Math.floor(i.kills / 15);
  if (i.tower) {
    const floor = i.towerFloor;
    return {
      material: i.rewardMaterial,
      materialAmount: Math.round(i.rewardAmount * (1 + floor * 0.25) * d),
      gold: Math.round(30 * (1 + floor * 0.3) * (1 + i.goldBonus) * d),
      talentGain,
    };
  }
  return {
    material: i.rewardMaterial,
    materialAmount: Math.round(i.rewardAmount * d),
    gold: Math.round((30 + i.missionLevel * 5) * (1 + i.goldBonus) * d),
    talentGain,
  };
}

/** 塔模式失败：按层数结算部分奖励（材料固定为合金碎片） */
export function towerFailureRewards(i: SettleInput): RewardOut {
  const d = difficultyRewardMult(i.difficulty, i.luckyGold);
  const floor = Math.max(1, i.towerFloor);
  return {
    material: '合金碎片',
    materialAmount: Math.max(2, Math.round(i.rewardAmount * (1 + floor * 0.2) * d)),
    gold: Math.round(20 * (1 + floor * 0.2) * d),
    talentGain: 0,
  };
}

/**
 * 塔模式每层击破 BOSS 的即时奖励（floor 为 0 起的当前层索引）。
 * 材料仍按层数线性增长、不吃难度倍率，保持既有掉落节奏。
 */
export function towerFloorClearRewards(
  floor: number,
  difficulty: number,
  luckyGold: number
): { material: string; materialAmount: number; gold: number } {
  const d = difficultyRewardMult(difficulty, luckyGold);
  return {
    material: '合金碎片',
    materialAmount: Math.round(2 + floor * 0.5),
    gold: Math.round(20 * (1 + floor * 0.15) * d),
  };
}
