/**
 * growth/save — 存档版本与迁移（纯函数，便于单测）。
 *
 * 旧存档是「扁平 InventoryData」；v2 起包成 { version, data }。
 * 读取时任何缺失/损坏字段都用默认值兜底，避免坏档把游戏卡死。
 */
import type { InventoryData, WeaponAffix, WeaponGrowth } from './inventory';
import { MAX_ASCENSION, MAX_ENCHANT, MAX_PINNACLE, MAX_RUNE } from './upgrade';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'ss-rebuild-save-v1';
export const SAVE_BACKUP_KEY = 'ss-rebuild-save-v1-backup';

const AFFIX_KINDS: WeaponAffix['kind'][] = ['atk', 'crit', 'spd', 'energy', 'vamp'];

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const countMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const n = Math.floor(num(val));
      if (n > 0) out[k] = n;
    }
  }
  return out;
};

const sanitizeWeapon = (id: string, raw: unknown): WeaponGrowth => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const affixes: WeaponAffix[] = Array.isArray(r.affixes)
    ? r.affixes
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .filter((a) => AFFIX_KINDS.includes(a.kind as WeaponAffix['kind']))
        .map((a) => ({ kind: a.kind as WeaponAffix['kind'], value: Math.max(0, Math.min(1, num(a.value))) }))
    : [];
  return {
    weaponId: id,
    level: Math.max(0, Math.floor(num(r.level))),
    ascension: Math.max(0, Math.min(MAX_ASCENSION, Math.floor(num(r.ascension)))),
    rune: Math.max(0, Math.min(MAX_RUNE, Math.floor(num(r.rune)))),
    enchant: Math.max(0, Math.min(MAX_ENCHANT, Math.floor(num(r.enchant)))),
    pinnacle: Math.max(0, Math.min(MAX_PINNACLE, Math.floor(num(r.pinnacle)))),
    affixes,
    kills: Math.max(0, Math.floor(num(r.kills))),
  };
};

/** 读取任意版本存档 → 当前结构；migrated=true 表示来自旧版本/扁平结构 */
export function migrateSave(raw: unknown): { data: InventoryData; migrated: boolean } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const version = Math.floor(num(obj.version, 1));
  // v2 起数据在 data 字段；旧档直接把字段放在顶层
  const src = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>;
  const weapons: Record<string, WeaponGrowth> = {};
  if (src.weapons && typeof src.weapons === 'object') {
    for (const [id, w] of Object.entries(src.weapons as Record<string, unknown>)) weapons[id] = sanitizeWeapon(id, w);
  }
  const loadoutRaw = Array.isArray(src.loadout) ? src.loadout.filter((x): x is string => typeof x === 'string') : [];
  const loadout = [...new Set(loadoutRaw)].slice(0, 5);
  return {
    data: {
      materials: countMap(src.materials),
      weapons,
      loadout,
      gold: Math.max(0, Math.floor(num(src.gold))),
      consumables: countMap(src.consumables),
      talentPoints: Math.max(0, Math.floor(num(src.talentPoints))),
      roleLevels: countMap(src.roleLevels),
    },
    migrated: version < SAVE_VERSION,
  };
}

export function serializeSave(data: InventoryData): string {
  return JSON.stringify({ version: SAVE_VERSION, data });
}
