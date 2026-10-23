/**
 * campaign/missionProgress — 每关通关次数（跨局持久化）。
 *
 * 选关页展示「已通关 ×N」，让 12 关的推进有可读的长期进度。
 */
export const MISSION_CLEARS_KEY = 'ss-mission-clears-v1';

export interface ClearStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 纯函数：过滤非字符串键/非法数值，计数取非负整数 */
export function sanitizeClears(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
      if (n > 0) out[k] = n;
    }
  }
  return out;
}

export function loadMissionClears(storage: ClearStorage): Record<string, number> {
  try {
    const raw = storage.getItem(MISSION_CLEARS_KEY);
    return raw ? sanitizeClears(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** 记录一次通关，返回该关新的通关次数 */
export function recordMissionClear(id: string, storage: ClearStorage): number {
  if (!id) return 0;
  const clears = loadMissionClears(storage);
  const next = (clears[id] ?? 0) + 1;
  clears[id] = next;
  try {
    storage.setItem(MISSION_CLEARS_KEY, JSON.stringify(clears));
  } catch {
    /* 忽略持久化失败 */
  }
  return next;
}
