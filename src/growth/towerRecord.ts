/**
 * growth/towerRecord — 试炼之塔最高层数（跨局持久化）。
 *
 * 失败/退出也记录到达层数；选择页与结算展示历史最佳，给无尽模式一个长期目标。
 */
export const TOWER_BEST_KEY = 'ss-tower-best-v1';

/** 纯函数：历史最高与本次到达取较大值（脏数据兜底为 0） */
export function nextBest(stored: number, reached: number): number {
  const s = Number.isFinite(stored) ? Math.floor(stored) : 0;
  const r = Number.isFinite(reached) ? Math.floor(reached) : 0;
  return Math.max(0, s, r);
}

export function loadTowerBest(): number {
  try {
    return nextBest(Number(localStorage.getItem(TOWER_BEST_KEY) ?? 0), 0);
  } catch {
    return 0;
  }
}

/** 记录一次到达层数，返回当前历史最高 */
export function recordTowerBest(reached: number): number {
  const best = nextBest(loadTowerBest(), reached);
  try {
    localStorage.setItem(TOWER_BEST_KEY, String(best));
  } catch {
    /* 忽略持久化失败 */
  }
  return best;
}
