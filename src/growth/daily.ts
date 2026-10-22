/**
 * growth/daily — 每日任务系统。
 *
 * 每天 3 个任务（击杀/通关/强化/开箱），完成后可领取材料+金币奖励。
 * 按日期种子生成任务，避免存档作弊（每日重置）。
 */
import type { Inventory } from './inventory';

export type DailyKind = 'kills' | 'clears' | 'upgrades' | 'chests';

export interface DailyTask {
  id: string;
  kind: DailyKind;
  /** 任务名 */
  name: string;
  target: number;
  /** 奖励 */
  rewardMaterial: string;
  rewardAmount: number;
  rewardGold: number;
}

/** 按日期生成 3 个任务（同一天相同） */
export function genDailyTasks(dateStr: string): DailyTask[] {
  // 简单 hash：日期 → 任务组合
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
  const mats = ['合金碎片', '核心晶体', '合金碎片'];
  // 三类组合轮换：保证每天既有击杀/通关，也有强化或开箱
  const kindSets: DailyKind[][] = [
    ['kills', 'clears', 'chests'],
    ['kills', 'upgrades', 'clears'],
    ['upgrades', 'kills', 'chests'],
  ];
  const kinds = kindSets[h % kindSets.length];
  const targets = [25 + (h % 15), 1 + (h % 2), 4 + (h % 3)];
  const names: Record<DailyKind, (t: number) => string> = {
    kills: (t) => `猎杀敌人 ${t} 个`,
    clears: (t) => `通关副本 ${t} 次`,
    upgrades: (t) => `强化武器 ${t} 次`,
    chests: (t) => `拾取补给箱 ${t} 个`,
  };
  return kinds.map((k, i) => ({
    id: `d-${dateStr}-${i}`,
    kind: k,
    name: names[k](targets[i]),
    target: targets[i],
    rewardMaterial: mats[i],
    rewardAmount: 10 + (h % 8) + i * 5,
    rewardGold: 60 + (h % 60) + i * 40,
  }));
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface DailyState {
  date: string;
  progress: Record<string, number>;
  claimed: string[];
}

export function loadDaily(): DailyState {
  try {
    const raw = localStorage.getItem('ss-daily-v1');
    if (raw) {
      const s = JSON.parse(raw) as DailyState;
      if (s.date === todayKey()) return s;
    }
  } catch {
    // ignore
  }
  return { date: todayKey(), progress: {}, claimed: [] };
}

export function saveDaily(s: DailyState): void {
  try {
    localStorage.setItem('ss-daily-v1', JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** 跨天重置（返回是否发生重置）；进度写入与领奖前都调用，避免结算昨天的任务 */
export function ensureDaily(state: DailyState, today = todayKey()): boolean {
  if (state.date === today) return false;
  state.date = today;
  state.progress = {};
  state.claimed = [];
  return true;
}

/** 记录进度（击杀/通关/强化/开箱时调用） */
export function addDailyProgress(state: DailyState, kind: DailyKind, amount = 1): void {
  ensureDaily(state);
  const tasks = genDailyTasks(state.date);
  for (const t of tasks) {
    if (t.kind === kind) {
      state.progress[t.id] = (state.progress[t.id] ?? 0) + amount;
    }
  }
  saveDaily(state);
}

/** 领取任务奖励 */
export function claimDaily(state: DailyState, inventory: Inventory, taskId: string): boolean {
  ensureDaily(state);
  if (state.claimed.includes(taskId)) return false;
  const tasks = genDailyTasks(state.date);
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return false;
  if ((state.progress[taskId] ?? 0) < t.target) return false;
  state.claimed.push(taskId);
  inventory.addMaterial(t.rewardMaterial, t.rewardAmount);
  inventory.addGold(t.rewardGold);
  saveDaily(state);
  return true;
}
