/**
 * play/arsenal — 出战武器背包管理。
 *
 * 从武器池（8 把）选择最多 5 把出战，数字键 1-5 / Q 切换。
 * 每把武器独立持有弹药/能量状态；出战配置持久化到 Inventory。
 */
import { ARSENAL, Weapon } from '../arsenal';
import type { WeaponDef } from '../arsenal';
import type { Inventory } from '../growth';
import { damageMultiplier, mechMultiplier } from '../growth';

export class Arsenal {
  weapons: Weapon[];
  defs: WeaponDef[];
  index = 0;
  private inventory: Inventory;

  constructor(inventory: Inventory) {
    this.inventory = inventory;
    const ids = inventory.loadout.length > 0 ? inventory.loadout : ARSENAL.slice(0, 5).map((d) => d.id);
    if (inventory.loadout.length === 0) {
      for (const id of ids) inventory.addToLoadout(id);
    }
    this.defs = ids.map((id) => this.findDef(id));
    this.weapons = this.defs.map((d) => new Weapon(d));
    this.refreshGrowth(inventory);
  }

  private findDef(id: string): WeaponDef {
    const d = ARSENAL.find((w) => w.id === id);
    if (!d) throw new Error(`unknown weapon: ${id}`);
    return d;
  }

  get current(): Weapon {
    return this.weapons[this.index];
  }

  /** 切换到指定槽位（0-4），越界忽略；返回是否切换 */
  select(i: number): boolean {
    if (i < 0 || i >= this.weapons.length || i === this.index) return false;
    this.index = i;
    return true;
  }

  /** 滚轮/按键顺序切换 */
  cycle(dir: 1 | -1): void {
    this.index = (this.index + dir + this.weapons.length) % this.weapons.length;
  }

  /** 将武器加入出战背包（最多 5 把） */
  addToLoadout(id: string): boolean {
    const ok = this.inventory.addToLoadout(id);
    if (ok) this.rebuild();
    return ok;
  }

  /** 将武器移出出战背包 */
  removeFromLoadout(id: string): void {
    this.inventory.removeFromLoadout(id);
    this.rebuild();
  }

  /** 出战武器是否已满 */
  isLoadoutFull(): boolean {
    return this.inventory.isLoadoutFull();
  }

  /** 当前出战武器 id 列表 */
  loadoutIds(): string[] {
    return this.inventory.loadout;
  }

  /** 重建出战武器实例（loadout 变化后） */
  private rebuild(): void {
    this.defs = this.inventory.loadout.map((id) => this.findDef(id));
    this.weapons = this.defs.map((d) => new Weapon(d));
    if (this.index >= this.weapons.length) this.index = 0;
    this.refreshGrowth(this.inventory);
  }

  /** 切枪后刷新成长倍率 */
  refreshGrowth(inventory: Inventory): void {
    for (const w of this.weapons) {
      w.growthDamage = damageMultiplier(w.def, inventory);
      w.growthMech = mechMultiplier(w.def, inventory);
    }
  }
}
