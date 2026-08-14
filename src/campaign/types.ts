/**
 * campaign/types — 副本（关卡）相关类型定义。
 */

/** 单波敌人构成 */
export interface WaveSpec {
  chasers: number;
  boomers: number;
  spitters: number;
  guards?: number;
  berserkers?: number;
  casters?: number;
}

/** BOSS 规格 */
export interface BossSpec {
  id: string;
  name: string;
  hp: number;
  color: number;
  /** 技能间隔（秒） */
  skillInterval: number;
}

/** 关卡定义 */
export interface MissionDef {
  id: string;
  name: string;
  /** 地图布局：废弃设施 / 采石场 / 实验室 */
  mapId: 'facility' | 'quarry' | 'lab';
  /** 进入副本前准备时间（秒） */
  introSeconds: number;
  waves: WaveSpec[];
  boss?: BossSpec;
  /** 结算掉落 */
  rewards: { material: string; amount: number };
  /** 试炼之塔：无限层模式（波次无限推进，每 5 层出 BOSS，仅失败结算） */
  tower?: boolean;
}

/** 副本流程阶段 */
export type FlowPhase = 'intro' | 'wave' | 'boss' | 'clear' | 'failed';
