/**
 * growth/reset — 清除本地存档（设置面板的“重置进度”）。
 *
 * 只删除本游戏使用的键，不触碰同源其他站点数据。纯函数便于单测。
 */
export const SAVE_KEYS = [
  'ss-rebuild-save-v1',
  'ss-rebuild-save-v1-backup',
  'ss-achievements-v1',
  'ss-daily-v1',
  'ss-autopick-v1',
  'ss-tower-best-v1',
  'ss-role',
  'ss-role-picked',
  'ss-settings-v1',
  'ss-tips-v1',
] as const;

export interface RemovableStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** 返回实际删除的键数量（不存在的键不计） */
export function resetAllProgress(storage: RemovableStorage): number {
  let removed = 0;
  for (const key of SAVE_KEYS) {
    try {
      if (storage.getItem(key) !== null) removed += 1;
      storage.removeItem(key);
    } catch {
      /* 单键失败不影响其余键 */
    }
  }
  return removed;
}
