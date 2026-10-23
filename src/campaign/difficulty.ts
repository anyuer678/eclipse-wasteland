/**
 * campaign/difficulty — 难度选择的持久化（跨局/跨会话记住上次选择）。
 */
export const DIFFICULTY_KEY = 'ss-difficulty';
export const DIFFICULTY_OPTIONS = [0.7, 1, 1.5, 2.2] as const;

export function normalizeDifficulty(v: number): number {
  return (DIFFICULTY_OPTIONS as readonly number[]).includes(v) ? v : 1;
}

export function loadDifficulty(): number {
  try {
    return normalizeDifficulty(Number(localStorage.getItem(DIFFICULTY_KEY) ?? 1));
  } catch {
    return 1;
  }
}

export function saveDifficulty(v: number): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, String(normalizeDifficulty(v)));
  } catch {
    /* 忽略持久化失败 */
  }
}
