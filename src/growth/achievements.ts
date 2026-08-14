/**
 * growth/achievements — 成就系统（成就/矩阵）。
 *
 * 达成条件自动判定并发放奖励（金币/材料）。持久化进度。
 */

export type AchCond = 'kills' | 'clears' | 'upgrades' | 'ascensions';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  cond: AchCond;
  target: number;
  reward: { gold?: number; alloy?: number; core?: number };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'k1', name: '初露锋芒', desc: '累计击杀 50 个敌人', cond: 'kills', target: 50, reward: { gold: 50 } },
  { id: 'k2', name: '战场老兵', desc: '累计击杀 200 个敌人', cond: 'kills', target: 200, reward: { alloy: 30 } },
  { id: 'k3', name: '屠戮者', desc: '累计击杀 500 个敌人', cond: 'kills', target: 500, reward: { core: 15, gold: 200 } },
  { id: 'c1', name: '初次告捷', desc: '通关任务 5 次', cond: 'clears', target: 5, reward: { gold: 80 } },
  { id: 'c2', name: '常胜之师', desc: '通关任务 20 次', cond: 'clears', target: 20, reward: { alloy: 40, core: 10 } },
  { id: 'u1', name: '锻造师', desc: '累计强化 10 次', cond: 'upgrades', target: 10, reward: { gold: 60 } },
  { id: 'a1', name: '机师', desc: '累计进阶 3 次', cond: 'ascensions', target: 3, reward: { core: 8 } },
];

export interface AchievementState {
  /** 各条件累计值 */
  counters: Record<AchCond, number>;
  /** 已达成成就 id */
  claimed: string[];
}

const KEY = 'ss-achievements-v1';

export function loadAchievements(): AchievementState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as AchievementState;
      return {
        counters: { kills: p.counters?.kills ?? 0, clears: p.counters?.clears ?? 0, upgrades: p.counters?.upgrades ?? 0, ascensions: p.counters?.ascensions ?? 0 },
        claimed: Array.isArray(p.claimed) ? p.claimed : [],
      };
    }
  } catch {
    // ignore
  }
  return { counters: { kills: 0, clears: 0, upgrades: 0, ascensions: 0 }, claimed: [] };
}

function save(state: AchievementState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** 累计一个条件，返回本次新达成的成就列表（奖励由调用方发放） */
export function addProgress(state: AchievementState, cond: AchCond, amount: number): AchievementDef[] {
  state.counters[cond] += amount;
  save(state);
  const newly: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (a.cond === cond && state.counters[cond] >= a.target && !state.claimed.includes(a.id)) {
      state.claimed.push(a.id);
      newly.push(a);
    }
  }
  if (newly.length > 0) save(state);
  return newly;
}

/** 发放成就奖励 */
export function grantReward(inv: { addGold: (n: number) => void; addMaterial: (k: string, n: number) => void }, a: AchievementDef): void {
  if (a.reward.gold) inv.addGold(a.reward.gold);
  if (a.reward.alloy) inv.addMaterial('合金碎片', a.reward.alloy);
  if (a.reward.core) inv.addMaterial('核心晶体', a.reward.core);
}
