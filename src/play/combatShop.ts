/**
 * play/combatShop — 局内商店商品表（单一真相源）。
 *
 * 界面渲染与购买结算都读这张表，避免价格/描述在 game.ts 里再写一份。
 */
export interface CombatGood {
  id: string;
  name: string;
  desc: string;
  price: number;
}

export const COMBAT_GOODS: CombatGood[] = [
  { id: 'heal', name: '医疗包', desc: '回复 60 生命', price: 30 },
  { id: 'dmg', name: '狂暴药剂', desc: '伤害 +25%（20s）', price: 40 },
  { id: 'energy', name: '能量电池', desc: '能量回满', price: 20 },
  { id: 'shield', name: '护盾发生器', desc: '减伤 70%（12s）', price: 35 },
  { id: 'ammo', name: '弹药补给', desc: '所有武器弹匣装满', price: 15 },
  { id: 'crit', name: '精准药剂', desc: '暴击率 +20%（12s）', price: 30 },
];

export function combatGood(id: string): CombatGood | undefined {
  return COMBAT_GOODS.find((g) => g.id === id);
}

export function canAfford(gold: number, id: string): boolean {
  const good = combatGood(id);
  return !!good && gold >= good.price;
}
