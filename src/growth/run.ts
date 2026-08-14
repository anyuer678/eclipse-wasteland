/**
 * growth/run — 局内成长系统（升级选牌，Roguelite）。
 *
 * 击杀积累经验 → 升级 → 暂停弹出 3 选 1 强化卡 → 应用局内 BUFF。
 * 每局（每次进副本）重置；塔模式叠加形成"每局不同 build"。
 * Roguelite 局内强化。
 */

export type BoostId =
  | 'dmg'
  | 'spd'
  | 'crit'
  | 'move'
  | 'regen'
  | 'armor'
  | 'split'
  | 'pierce'
  | 'vamp'
  | 'energy'
  | 'hp'
  | 'elite'
  | 'mag'
  | 'reload'
  | 'critDmg'
  | 'frost'
  | 'lucky'
  | 'thorns';

export interface RunBoost {
  id: BoostId;
  name: string;
  desc: string;
  /** 每次选取的叠加值 */
  value: number;
}

export interface RunState {
  level: number;
  exp: number;
  /** 本次战斗获得的强化（id → 层数） */
  boosts: Record<BoostId, number>;
}

export const BOOST_POOL: RunBoost[] = [
  { id: 'dmg', name: '攻击强化', desc: '伤害 +15%', value: 0.15 },
  { id: 'spd', name: '攻速强化', desc: '射速 +12%', value: 0.12 },
  { id: 'crit', name: '暴击强化', desc: '暴击率 +10%', value: 0.1 },
  { id: 'move', name: '疾行', desc: '移速 +10%', value: 0.1 },
  { id: 'regen', name: '再生', desc: '每秒回复 1.5 生命', value: 1.5 },
  { id: 'armor', name: '铁壁', desc: '减伤 +15%', value: 0.15 },
  { id: 'split', name: '分裂弹', desc: '命中分裂 2 发（40% 伤害）', value: 0.4 },
  { id: 'pierce', name: '穿透强化', desc: '伤害 +20%', value: 0.2 },
  { id: 'vamp', name: '嗜血', desc: '伤害的 3% 回复生命', value: 0.03 },
  { id: 'energy', name: '能量涌动', desc: '能量回复 +1.5/s', value: 1.5 },
  { id: 'hp', name: '生命强化', desc: '最大生命 +15', value: 15 },
  { id: 'elite', name: '精英猎手', desc: '对精英伤害 +30%', value: 0.3 },
  { id: 'mag', name: '扩容弹夹', desc: '弹夹容量 +50%', value: 0.5 },
  { id: 'reload', name: '速装填', desc: '换弹速度 ×2', value: 1 },
  { id: 'critDmg', name: '致命一击', desc: '暴击伤害 +30%', value: 0.3 },
  { id: 'frost', name: '寒霜弹', desc: '命中减速 20%（1.5s）', value: 0.2 },
  { id: 'lucky', name: '幸运', desc: '暴击率 +6% · 金币掉落 +20%', value: 0.06 },
  { id: 'thorns', name: '荆棘', desc: '受伤反弹 5 点伤害', value: 5 },
];

export function newRun(): RunState {
  return { level: 0, exp: 0, boosts: { dmg: 0, spd: 0, crit: 0, move: 0, regen: 0, armor: 0, split: 0, pierce: 0, vamp: 0, energy: 0, hp: 0, elite: 0, mag: 0, reload: 0, critDmg: 0, frost: 0, lucky: 0, thorns: 0 } };
}

/** 升级所需经验（随等级增长） */
export function expNeeded(level: number): number {
  return 5 + level * 2;
}

/** 击杀获得经验（精英 +2），返回是否升级 */
export function addKillExp(run: RunState, elite: boolean): boolean {
  run.exp += elite ? 2 : 1;
  let leveled = false;
  while (run.exp >= expNeeded(run.level)) {
    run.exp -= expNeeded(run.level);
    run.level += 1;
    leveled = true;
  }
  return leveled;
}

/** 随机 3 个不重复强化选项（可按权重去除已满的） */
export function rollChoices(run: RunState, count = 3): RunBoost[] {
  const maxed = new Set<BoostId>(['split']);
  const pool = BOOST_POOL.filter((b) => !maxed.has(b.id) || (run.boosts[b.id] ?? 0) < 3);
  const picks: RunBoost[] = [];
  const used = new Set<number>();
  while (picks.length < count && used.size < pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    if (used.has(idx)) continue;
    used.add(idx);
    picks.push(pool[idx]);
  }
  return picks;
}

/** 应用选择：记录层数并返回该强化 */
export function applyChoice(run: RunState, id: BoostId): RunBoost {
  const b = BOOST_POOL.find((x) => x.id === id)!;
  run.boosts[id] = (run.boosts[id] ?? 0) + 1;
  return b;
}

/** 局内加成汇总 */
export function runBonuses(run: RunState): {
  dmgMult: number;
  spdMult: number;
  critBonus: number;
  critDmgBonus: number;
  moveMult: number;
  regenPerSec: number;
  armorBonus: number;
  split: number;
  pierceMult: number;
  vamp: number;
  energyRegen: number;
  maxHpBonus: number;
  eliteDmg: number;
  magMult: number;
  reloadMult: number;
  frost: number;
  luckyCrit: number;
  luckyGold: number;
  thorns: number;
} {
  const n = (id: BoostId): number => run.boosts[id] ?? 0;
  return {
    dmgMult: 1 + n('dmg') * 0.15 + n('pierce') * 0.2,
    spdMult: 1 + n('spd') * 0.12,
    critBonus: n('crit') * 0.1 + n('lucky') * 0.06,
    critDmgBonus: n('critDmg') * 0.3,
    moveMult: 1 + n('move') * 0.1,
    regenPerSec: n('regen') * 1.5,
    armorBonus: Math.min(0.6, n('armor') * 0.15),
    split: n('split') * 0.4,
    pierceMult: 1,
    vamp: n('vamp') * 0.03,
    energyRegen: n('energy') * 1.5,
    maxHpBonus: n('hp') * 15,
    eliteDmg: 1 + n('elite') * 0.3,
    magMult: 1 + n('mag') * 0.5,
    reloadMult: 1 + n('reload'),
    frost: n('frost') * 0.2,
    luckyCrit: n('lucky') * 0.06,
    luckyGold: n('lucky') * 0.2,
    thorns: n('thorns') * 5,
  };
}
