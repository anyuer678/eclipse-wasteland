/**
 * growth/autopick — 局外「自动选择」配置与流派优先级。
 *
 * 开启后升级不再弹牌暂停，而是从本次随机出的三张牌里按当前流派的优先级
 * 直接领取。配置与流派保存在 localStorage（ss-autopick-v1），局外可改。
 */
import { BOOST_POOL } from './run';
import type { BoostId } from './run';

export interface AutoPickPreset {
  name: string;
  /** 优先级从高到低：排在前面的先选 */
  order: BoostId[];
}

export interface AutoPickConfig {
  enabled: boolean;
  /** 当前流派下标 */
  active: number;
  presets: AutoPickPreset[];
}

const KEY = 'ss-autopick-v1';
const MAX_NAME = 12;

/** 全部局内强化 id（保持配表顺序，用于补齐流派排序） */
export const ALL_BOOST_IDS: BoostId[] = BOOST_POOL.map((b) => b.id);

const DEFAULT_PRESETS: AutoPickPreset[] = [
  {
    name: '火力流',
    order: ['dmg', 'crit', 'critDmg', 'pierce', 'spd', 'elite', 'lucky', 'mag', 'reload', 'split', 'frost', 'vamp', 'energy', 'move', 'hp', 'armor', 'regen', 'thorns'],
  },
  {
    name: '生存流',
    order: ['hp', 'armor', 'regen', 'vamp', 'thorns', 'move', 'dmg', 'crit', 'critDmg', 'spd', 'energy', 'mag', 'reload', 'lucky', 'pierce', 'elite', 'split', 'frost'],
  },
  {
    name: '速射流',
    order: ['spd', 'mag', 'reload', 'crit', 'dmg', 'critDmg', 'lucky', 'pierce', 'move', 'split', 'frost', 'elite', 'energy', 'vamp', 'hp', 'armor', 'regen', 'thorns'],
  },
];

export function defaultAutoPick(): AutoPickConfig {
  return { enabled: false, active: 0, presets: DEFAULT_PRESETS.map((p) => ({ name: p.name, order: [...p.order] })) };
}

/** 规范化：去重、补齐缺失强化、纠正流派下标；读档与写档都走这里 */
export function sanitizeAutoPick(raw: Partial<AutoPickConfig> | null | undefined): AutoPickConfig {
  const presets: AutoPickPreset[] = [];
  for (const p of raw?.presets ?? []) {
    const name = typeof p?.name === 'string' && p.name.trim() ? p.name.trim().slice(0, MAX_NAME) : `流派 ${presets.length + 1}`;
    const seen = new Set<BoostId>();
    const order: BoostId[] = [];
    for (const id of p?.order ?? []) {
      if (ALL_BOOST_IDS.includes(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    for (const id of ALL_BOOST_IDS) if (!seen.has(id)) order.push(id);
    presets.push({ name, order });
  }
  const finalPresets = presets.length > 0 ? presets : defaultAutoPick().presets;
  const active = Math.min(Math.max(0, Math.floor(raw?.active ?? 0)), finalPresets.length - 1);
  return { enabled: raw?.enabled === true, active, presets: finalPresets };
}

let cache: AutoPickConfig | null = null;

export function getAutoPick(): AutoPickConfig {
  if (!cache) {
    let raw: Partial<AutoPickConfig> | null = null;
    try {
      const s = localStorage.getItem(KEY);
      if (s) raw = JSON.parse(s) as Partial<AutoPickConfig>;
    } catch {
      // localStorage 不可用时用默认配置
    }
    cache = sanitizeAutoPick(raw);
  }
  return cache;
}

export function saveAutoPick(cfg: AutoPickConfig): void {
  cache = sanitizeAutoPick(cfg);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // 忽略持久化失败
  }
}

/** 当前启用的流派；未开启或配置异常时返回 null（走手动选牌） */
export function activePreset(cfg: AutoPickConfig = getAutoPick()): AutoPickPreset | null {
  if (!cfg.enabled) return null;
  return cfg.presets[cfg.active] ?? null;
}

/** 从本次随机牌里选优先级最高的一张；流派没覆盖到的牌退回第一张 */
export function pickBoost(choices: readonly BoostId[], preset: AutoPickPreset | null | undefined): BoostId | null {
  if (choices.length === 0) return null;
  if (!preset) return choices[0];
  const rank = new Map<BoostId, number>();
  preset.order.forEach((id, i) => rank.set(id, i));
  let best: BoostId | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const id of choices) {
    const r = rank.get(id);
    if (r !== undefined && r < bestRank) {
      bestRank = r;
      best = id;
    }
  }
  return best ?? choices[0];
}
