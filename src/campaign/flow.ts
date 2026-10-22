/**
 * campaign/flow — 副本流程状态机。
 *
 * intro → wave（逐波推进）→ boss（末波后）→ clear / failed
 * 驱动 Spawner 与 Boss，向事件总线广播阶段/进度/结算。
 */
import { Rng } from '../core';
import type { Spawner } from '../horde';
import { Boss } from './boss';
import type { BossSpec, FlowPhase, MissionDef, WaveSpec } from './types';

export interface FlowResult {
  phase: FlowPhase;
  mission: MissionDef;
  waveIndex: number;
  totalWaves: number;
  /** 塔模式当前层数（非塔 = waveIndex+1） */
  towerFloor: number;
  kills: number;
  timeSeconds: number;
  rewardMaterial: string;
  rewardAmount: number;
}

export class MissionFlow {
  private rng: Rng;
  private spawner: Spawner;
  mission: MissionDef;
  phase: FlowPhase = 'intro';
  waveIndex = 0;
  boss: Boss | null = null;
  kills = 0;
  private phaseTimer = 0;
  private totalTime = 0;

  onPhaseChange: (phase: FlowPhase, mission: MissionDef, wave: number, totalWaves: number) => void = () => {};
  onResult: (result: FlowResult) => void = () => {};
  /** 难度系数（轻松 0.7 / 普通 1 / 困难 1.5 / 噩梦 2.2） */
  difficulty = 1;
  /** 当前怪物等级（波次/BOSS 刷新时更新，供等级压制结算） */
  monsterLevel = 1;
  /** 难度对应的怪物等级偏移 */
  get levelOffset(): number {
    return this.difficulty >= 2 ? 4 : this.difficulty >= 1.5 ? 2 : this.difficulty <= 0.8 ? -2 : 0;
  }

  constructor(mission: MissionDef, spawner: Spawner, seed: number) {
    this.mission = mission;
    this.spawner = spawner;
    this.rng = new Rng(seed);
  }

  start(): void {
    this.phase = 'intro';
    this.phaseTimer = this.mission.introSeconds;
    this.waveIndex = 0;
    this.kills = 0;
    this.totalTime = 0;
    this.boss = null;
    this.emitPhase();
  }

  /** 每逻辑帧推进，返回是否触发阶段变化 */
  update(dt: number, playerAlive: boolean): boolean {
    this.totalTime += dt;

    if (!playerAlive) {
      if (this.phase !== 'failed') {
        this.phase = 'failed';
        this.emitResult();
        this.emitPhase();
        return true;
      }
      return false;
    }

    let changed = false;

    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'wave';
        this.spawnCurrentWave();
        this.emitPhase();
        changed = true;
      }
    } else if (this.phase === 'wave') {
      if (this.spawner.remaining() === 0) {
        if (this.mission.tower) {
          // 塔模式：波次无限推进，每 5 层出 BOSS
          this.waveIndex += 1;
          if (this.waveIndex % 5 === 4) {
            this.phase = 'boss';
            this.boss = new Boss(this.towerBossSpec(), this.rng);
            // 塔主经验必须按层数等级结算，否则击杀只给 1 级经验
            this.boss.monsterLevel = this.monsterLevel;
          } else {
            this.spawnCurrentWave();
          }
          this.emitPhase();
        } else if (this.waveIndex + 1 < this.mission.waves.length) {
          this.waveIndex += 1;
          this.spawnCurrentWave();
          this.emitPhase();
        } else if (this.mission.boss) {
          this.phase = 'boss';
          const bossLvl = Math.max(1, (this.mission.monsterLevel ?? 1) + this.waveIndex + this.levelOffset + 2);
          this.boss = new Boss(this.mission.boss, this.rng);
          this.boss.monsterLevel = bossLvl;
          this.boss.hp = Math.round(this.boss.hp * (1 + 0.32 * (bossLvl - 1)) * this.difficulty);
          this.monsterLevel = bossLvl;
          this.emitPhase();
        } else {
          this.finishClear();
        }
        changed = true;
      }
    } else if (this.phase === 'boss') {
      if (this.boss && !this.boss.alive) {
        if (this.mission.tower) {
          // 塔模式：BOSS 击杀 → 继续下一层，不掉落结算
          this.phase = 'wave';
          this.waveIndex += 1;
          this.spawnCurrentWave();
          this.emitPhase();
        } else {
          this.finishClear();
        }
        changed = true;
      }
    }

    return changed;
  }

  /** BOSS 掉血调用（由射击系统回调） */
  get activeBoss(): Boss | null {
    return this.phase === 'boss' ? this.boss : null;
  }

  private spawnCurrentWave(): void {
    if (this.mission.tower) {
      // 塔模式：波次构成随层数增长 + 难度缩放 + 精英概率（高楼层加入盾兵/狂战）
      const floor = this.waveIndex + 1;
      const spec: WaveSpec = {
        chasers: Math.min(3 + floor, 16),
        boomers: Math.min(Math.floor(floor / 3), 6),
        spitters: Math.min(Math.floor(floor / 4), 6),
        guards: floor >= 4 ? Math.min(Math.floor(floor / 4), 4) : 0,
        berserkers: floor >= 6 ? Math.min(Math.floor(floor / 3), 6) : 0,
        casters: floor >= 3 ? Math.min(Math.floor(floor / 2), 5) : 0,
      };
      const lvl = (this.mission.monsterLevel ?? 1) + Math.floor(floor * 1.5) + this.levelOffset;
      const hpMult = this.difficulty * (1 + 0.32 * (lvl - 1));
      const dmgMult = this.difficulty * (1 + 0.2 * (lvl - 1));
      // 精英层（每 3 层）：精英概率翻倍
      let eliteChance = Math.min(0.05 + floor * 0.02 + lvl * 0.004, 0.4);
      if (floor % 3 === 0) eliteChance = Math.min(0.55, eliteChance * 2);
      this.monsterLevel = Math.max(1, lvl);
      this.spawner.spawnWave(spec, { hpMult, dmgMult, eliteChance, level: this.monsterLevel });
      return;
    }
    const lvl = (this.mission.monsterLevel ?? 1) + this.waveIndex + this.levelOffset;
    this.monsterLevel = Math.max(1, lvl);
    const spec = this.mission.waves[this.waveIndex];
    this.spawner.spawnWave(spec as WaveSpec, {
      hpMult: this.difficulty * (1 + 0.32 * (lvl - 1)),
      dmgMult: this.difficulty * (1 + 0.2 * (lvl - 1)),
      eliteChance: Math.min(0.4, 0.04 + lvl * 0.005),
      level: this.monsterLevel,
    });
  }

  /** 塔模式 BOSS 规格：随层数与怪物等级强化 */
  private towerBossSpec(): BossSpec {
    const floor = this.waveIndex + 1;
    const lvl = Math.max(1, (this.mission.monsterLevel ?? 1) + Math.floor(floor * 1.5) + this.levelOffset + 2);
    this.monsterLevel = lvl;
    return {
      id: 'tower-boss',
      name: `塔主·第${floor}层`,
      hp: Math.round(600 * (1 + (floor - 5) * 0.25) * (1 + 0.32 * (lvl - 1)) * this.difficulty),
      color: 0x5a2bd9,
      skillInterval: Math.max(2, 3.2 - Math.floor(floor / 10) * 0.3),
    };
  }

  private finishClear(): void {
    this.phase = 'clear';
    this.emitResult();
    this.emitPhase();
  }

  private emitPhase(): void {
    this.onPhaseChange(this.phase, this.mission, this.waveIndex, this.mission.waves.length);
  }

  private emitResult(): void {
    this.onResult({
      phase: this.phase,
      mission: this.mission,
      waveIndex: this.waveIndex,
      totalWaves: this.mission.waves.length,
      towerFloor: this.waveIndex + 1,
      kills: this.kills,
      timeSeconds: Math.floor(this.totalTime),
      rewardMaterial: this.phase === 'clear' ? this.mission.rewards.material : '',
      rewardAmount: this.phase === 'clear' ? this.mission.rewards.amount : 0,
    });
  }
}
