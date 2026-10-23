/**
 * debug/stateQueries — 运行状态类调试查询（从 game.ts 抽出的纯映射）。
 *
 * 所有状态通过 getter 读取，函数本身不持有引用；便于单测与后续扩展。
 */
export interface WeaponView {
  id: string;
  name: string;
  index: number;
  count: number;
  viewmodelId: string;
  kills: number;
  growthDamage: number;
  magMult: number;
  magCap: number;
  ammo: number;
}

export interface StateDeps {
  paused: () => boolean;
  shopOpen: () => boolean;
  settingsVisible: () => boolean;
  menu: () => boolean;
  phase: () => string;
  wave: () => number;
  enemiesRemaining: () => number;
  ticks: () => number;
  lockTries: () => number;
  unlockCalls: () => number;
  pointerLocked: () => boolean;
  hp: () => number;
  maxHp: () => number;
  weapon: () => WeaponView;
  shortBuffs: () => { fireSpd: number; crit: number; move: number };
  buffs: () => { atk: number; shield: number; speed: number };
  shield: () => number;
  shieldCooldown: () => number;
  fury: () => number;
  stealth: () => number;
  roleCooldown: () => number;
  meleeCooldown: () => number;
  dashCooldown: () => number;
  summonActive: () => boolean;
  infernoActive: () => boolean;
  healActive: () => boolean;
  killStreak: () => number;
  run: () => { level: number; exp: number; boosts: Record<string, number> };
}

export function uiState(d: StateDeps): {
  paused: boolean;
  shopOpen: boolean;
  settings: boolean;
  menu: boolean;
  phase: string;
  wave: number;
  enemies: number;
  ticks: number;
  lockTries: number;
  unlockCalls: number;
  pointerLocked: boolean;
} {
  return {
    paused: d.paused(),
    shopOpen: d.shopOpen(),
    settings: d.settingsVisible(),
    menu: d.menu(),
    phase: d.phase(),
    wave: d.wave(),
    enemies: d.enemiesRemaining(),
    ticks: d.ticks(),
    lockTries: d.lockTries(),
    unlockCalls: d.unlockCalls(),
    pointerLocked: d.pointerLocked(),
  };
}

export function weaponState(d: StateDeps): WeaponView {
  const w = d.weapon();
  return { ...w, growthDamage: +w.growthDamage.toFixed(4) };
}

export function combatState(d: StateDeps): {
  killStreak: number;
  shortBuffs: { fireSpd: number; crit: number; move: number };
  buffs: { atk: number; shield: number; speed: number };
  shield: number;
  shieldCooldown: number;
  fury: number;
  stealth: number;
  roleCooldown: number;
  meleeCooldown: number;
  dashCooldown: number;
  summon: boolean;
  inferno: boolean;
  heal: boolean;
  maxHp: number;
  hp: number;
} {
  return {
    killStreak: d.killStreak(),
    shortBuffs: { ...d.shortBuffs() },
    buffs: { ...d.buffs() },
    shield: +d.shield().toFixed(2),
    shieldCooldown: +d.shieldCooldown().toFixed(2),
    fury: +d.fury().toFixed(2),
    stealth: +d.stealth().toFixed(2),
    roleCooldown: +d.roleCooldown().toFixed(2),
    meleeCooldown: +d.meleeCooldown().toFixed(2),
    dashCooldown: +d.dashCooldown().toFixed(2),
    summon: d.summonActive(),
    inferno: d.infernoActive(),
    heal: d.healActive(),
    maxHp: d.maxHp(),
    hp: d.hp(),
  };
}

export function buffState(d: StateDeps): { atk: number; shield: number; speed: number } {
  return { ...d.buffs() };
}

export function runDump(d: StateDeps): { level: number; exp: number; boosts: Record<string, number> } {
  const r = d.run();
  return { level: r.level, exp: r.exp, boosts: { ...r.boosts } };
}
