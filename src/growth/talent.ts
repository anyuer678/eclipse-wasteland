/**
 * growth/talent — 天赋系统。
 *
 * 天赋点来源：击杀（每 15 击杀 +1）与通关（每关 +2）。
 * 技能树 4 节点，每节点 5 级，全属性加成（数值占位，后续平衡）。
 */
import type { Inventory } from './inventory';

export interface TalentNode {
  id: string;
  name: string;
  desc: (level: number) => string;
  maxLevel: number;
  /** 每级加成值 */
  perLevel: number;
}

export const TALENT_NODES: TalentNode[] = [
  { id: 'dmg', name: '火力强化', desc: (l) => `武器伤害 +${l * 4}%`, maxLevel: 5, perLevel: 0.04 },
  { id: 'hp', name: '体魄', desc: (l) => `生命上限 +${l * 25}`, maxLevel: 5, perLevel: 25 },
  { id: 'energy', name: '能量亲和', desc: (l) => `能量获取 +${l * 15}%`, maxLevel: 5, perLevel: 0.15 },
  { id: 'loot', name: '搜刮', desc: (l) => `金币掉落 +${l * 20}%`, maxLevel: 5, perLevel: 0.2 },
];

/** 存档中的天赋等级（持久化在 inventory） */
export interface TalentState {
  talents: Record<string, number>;
}

export function loadTalents(_inventory: Inventory): TalentState {
  // 天赋等级持久化：挂到 inventory 存档同 key 下（简单实现：内存 + 存档）
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('ss-rebuild-talents-v1');
  } catch {
    /* 隐私模式：无存档 */
  }
  if (raw) {
    try {
      const t = JSON.parse(raw) as TalentState;
      return { talents: t.talents ?? {} };
    } catch {
      // ignore
    }
  }
  return { talents: {} };
}

export function saveTalents(state: TalentState): void {
  try {
    localStorage.setItem('ss-rebuild-talents-v1', JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function talentLevel(state: TalentState, id: string): number {
  return state.talents[id] ?? 0;
}

export function upgradeTalent(state: TalentState, id: string, inventory: Inventory): boolean {
  const node = TALENT_NODES.find((n) => n.id === id);
  if (!node) return false;
  const lvl = talentLevel(state, id);
  if (lvl >= node.maxLevel) return false;
  if (!inventory.spendTalentPoint()) return false;
  state.talents[id] = lvl + 1;
  saveTalents(state);
  return true;
}

/** 汇总加成 */
export function talentBonuses(state: TalentState): { dmg: number; hp: number; energyGain: number; gold: number } {
  const dmg = talentLevel(state, 'dmg') * 0.04;
  const hp = talentLevel(state, 'hp') * 25;
  const energyGain = talentLevel(state, 'energy') * 0.15;
  const gold = talentLevel(state, 'loot') * 0.2;
  return { dmg, hp, energyGain, gold };
}
