/**
 * play/streak — 连杀播报文案与回血奖励（纯函数）。
 *
 * 3 连杀起播报；5/10 连杀额外回血（可叠加）；颜色随连杀档位升级。
 */
export interface StreakEvent {
  text: string;
  color: string;
  /** 本次连杀触发的回血量（可叠加） */
  heal: number;
}

const NAMES: Record<number, string> = {
  3: '🔥 三连杀!',
  5: '⚡ 五连杀!',
  8: '💀 八连杀!',
  10: '🌟 十连杀!!',
  15: '👑 十五连杀!!!',
  20: '🏆 无敌!!!',
};

export function streakEvent(streak: number): StreakEvent | null {
  if (streak < 3) return null;
  const color = streak >= 10 ? '#ffd700' : streak >= 5 ? '#ff6644' : '#ff9944';
  const heal = (streak >= 5 ? 5 : 0) + (streak >= 10 ? 10 : 0);
  return { text: NAMES[streak] ?? `🔥 ${streak}连杀!`, color, heal };
}
