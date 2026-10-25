/**
 * shell/hudUpdate — 把一帧数据应用到 HUD（含准星扩散与 BOSS 血条）。
 */
import type { HudView } from './hud';

export interface HudBossInfo {
  name: string;
  hp: number;
  maxHp: number;
  /** 当前阶段（0=初始）与阶段阈值（血量百分比），驱动血条分段刻度与狂暴变色 */
  phase?: number;
  thresholds?: number[];
}

export function applyHudFrame(
  hud: HudView,
  data: Parameters<HudView['update']>[0],
  firing: boolean,
  boss: HudBossInfo | null
): void {
  hud.update(data);
  hud.setSpread(firing ? 0.5 : 0);
  if (boss) hud.boss(boss.name, Math.max(0, (boss.hp / boss.maxHp) * 100), boss.phase ?? 0, boss.thresholds ?? []);
  else hud.hideBoss();
}
