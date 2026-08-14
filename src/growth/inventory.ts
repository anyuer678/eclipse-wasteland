/**
 * growth/inventory — 玩家背包（材料 + 武器成长数据）。
 *
 * 材料来自副本结算掉落；武器成长按 id 记录强化等级与进阶等级。
 * 数据持久化到 localStorage（单机存档）。
 */

export interface WeaponAffix {
  /** 词缀类型：atk/crit/spd/energy/vamp */
  kind: 'atk' | 'crit' | 'spd' | 'energy' | 'vamp';
  /** 数值强度（0-1 之间的小数加成） */
  value: number;
}

export interface WeaponGrowth {
  weaponId: string;
  /** 强化等级（0 起，每级 +5% 伤害） */
  level: number;
  /** 进阶等级（0-3，机制效果强化） */
  ascension: number;
  /** 符文等级（0 起，每级 +2% 伤害） */
  rune: number;
  /** 附魔等级（0 起，暴击/攻速，附魔） */
  enchant: number;
  /** 巅峰等级（0 起，伤害/生命/暴击，巅峰突破） */
  pinnacle: number;
  /** 符文词缀（每 2 级符文解锁一个新词缀，词缀体系） */
  affixes: WeaponAffix[];
  /** 武器击杀数（熟练度：每 20 杀 +1 级，每级 +2% 伤害） */
  kills: number;
}

export interface InventoryData {
  materials: Record<string, number>;
  weapons: Record<string, WeaponGrowth>;
  /** 出战背包（武器 id 列表，最多 5 把） */
  loadout: string[];
  /** 金币（副本结算获得） */
  gold: number;
  /** 消耗品（治疗针等） */
  consumables: Record<string, number>;
  /** 天赋点（击杀/通关积累） */
  talentPoints: number;
  /** 角色强化等级（每级技能效果 +15%，最多 5 级） */
  roleLevels: Record<string, number>;
}

const SAVE_KEY = 'ss-rebuild-save-v1';

export class Inventory {
  data: InventoryData;

  constructor() {
    this.data = this.load();
  }

  addMaterial(id: string, amount: number): void {
    this.data.materials[id] = (this.data.materials[id] ?? 0) + amount;
    this.save();
  }

  spendMaterial(id: string, amount: number): boolean {
    const cur = this.data.materials[id] ?? 0;
    if (cur < amount) return false;
    this.data.materials[id] = cur - amount;
    this.save();
    return true;
  }

  material(id: string): number {
    return this.data.materials[id] ?? 0;
  }

  getWeapon(id: string): WeaponGrowth {
    let w = this.data.weapons[id];
    if (!w) {
      w = { weaponId: id, level: 0, ascension: 0, rune: 0, enchant: 0, pinnacle: 0, affixes: [], kills: 0 };
      this.data.weapons[id] = w;
      this.save();
    } else {
      // 旧存档兼容：补齐新字段
      if (typeof w.enchant !== 'number') w.enchant = 0;
      if (typeof w.pinnacle !== 'number') w.pinnacle = 0;
      if (!Array.isArray(w.affixes)) w.affixes = [];
      if (typeof w.kills !== 'number') w.kills = 0;
    }
    return w;
  }

  private save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // localStorage 不可用（隐私模式等）时静默跳过
    }
  }

  /** 强制持久化（强化/进阶后由 upgrade 模块调用） */
  persist(): void {
    this.save();
  }

  private load(): InventoryData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as InventoryData;
        return {
          materials: parsed.materials ?? {},
          weapons: parsed.weapons ?? {},
          loadout: Array.isArray(parsed.loadout) ? parsed.loadout : [],
          gold: parsed.gold ?? 0,
          consumables: parsed.consumables ?? {},
          roleLevels: parsed.roleLevels ?? {},
          talentPoints: parsed.talentPoints ?? 0,
        };
      }
    } catch {
      // 存档损坏时重置
    }
    return { materials: {}, weapons: {}, loadout: [], gold: 0, consumables: {}, talentPoints: 0, roleLevels: {} };
  }

  // ---------- 金币 ----------
  get gold(): number {
    return this.data.gold;
  }

  addGold(amount: number): void {
    this.data.gold += amount;
    this.save();
  }

  spendGold(amount: number): boolean {
    if (this.data.gold < amount) return false;
    this.data.gold -= amount;
    this.save();
    return true;
  }

  // ---------- 消耗品 ----------
  consumable(id: string): number {
    return this.data.consumables[id] ?? 0;
  }

  addConsumable(id: string, amount: number): void {
    this.data.consumables[id] = (this.data.consumables[id] ?? 0) + amount;
    this.save();
  }

  useConsumable(id: string): boolean {
    const cur = this.data.consumables[id] ?? 0;
    if (cur <= 0) return false;
    this.data.consumables[id] = cur - 1;
    this.save();
    return true;
  }

  /** 角色强化等级 */
  roleLevel(id: string): number {
    return this.data.roleLevels[id] ?? 0;
  }

  /** 角色强化：每级 +1（消耗核心晶体，最多 5 级） */
  upgradeRole(id: string): boolean {
    const lvl = this.roleLevel(id);
    if (lvl >= 5) return false;
    const cost = 6 + lvl * 4;
    if (!this.spendMaterial('核心晶体', cost)) return false;
    this.data.roleLevels[id] = lvl + 1;
    this.save();
    return true;
  }

  // ---------- 天赋点 ----------
  get talentPoints(): number {
    return this.data.talentPoints;
  }

  addTalentPoints(amount: number): void {
    this.data.talentPoints += amount;
    this.save();
  }

  spendTalentPoint(): boolean {
    if (this.data.talentPoints <= 0) return false;
    this.data.talentPoints -= 1;
    this.save();
    return true;
  }

  /** 出战背包（武器 id 列表，最多 5 把）；空时由调用方补默认 */
  get loadout(): string[] {
    return this.data.loadout;
  }

  /** 出战武器是否已满 */
  isLoadoutFull(): boolean {
    return this.data.loadout.length >= 5;
  }

  /** 加入出战，满 5 返回 false */
  addToLoadout(id: string): boolean {
    if (this.data.loadout.includes(id) || this.isLoadoutFull()) return false;
    this.data.loadout.push(id);
    this.save();
    return true;
  }

  removeFromLoadout(id: string): void {
    this.data.loadout = this.data.loadout.filter((x) => x !== id);
    this.save();
  }

  reset(): void {
    this.data = { materials: {}, weapons: {}, loadout: [], gold: 0, consumables: {}, talentPoints: 0, roleLevels: {} };
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
  }
}
