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
  const kinds: DailyKind[] = ['kills', 'clears', 'chests'];
  const targets = [25 + (h % 15), 1 + (h % 2), 4 + (h % 3)];
  return kinds.map((k, i) => ({
    id: `d-${dateStr}-${i}`,
    kind: k,
    name: k === 'kills' ? `猎杀敌人 ${targets[i]} 个` : k === 'clears' ? `通关副本 ${targets[i]} 次` : `击碎补给箱 ${targets[i]} 个`,
    target: targets[i],
    rewardMaterial: mats[i],
    rewardAmount: 8 + (h % 8) + i * 4,
    rewardGold: 50 + (h % 60) + i * 30,
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

/** 记录进度（击杀/通关/强化/开箱时调用） */
export function addDailyProgress(state: DailyState, kind: DailyKind, amount = 1): void {
  if (state.date !== todayKey()) {
    // 跨天重置
    state.date = todayKey();
    state.progress = {};
    state.claimed = [];
  }
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
