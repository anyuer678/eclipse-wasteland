/**
 * play/weaponBrief — 武器技能面板文案（纯函数，从 game.ts 拆出）。
 *
 * 数值直接取配表，保证 HUD 展示与实际射击参数同源。
 */
import type { WeaponDef } from '../arsenal';
import type { SkillLine } from '../shell';

export function skillLinesFor(def: WeaponDef): SkillLine[] {
  const m = def.mech;
  const lines: SkillLine[] = [];
  if (m.kind === 'energy') {
    lines.push({ key: 'E', label: '过载射击', value: `消耗 ${m.cost} 能量，伤害倍率 ${m.multiplier.toFixed(1)}` });
    lines.push({ key: '左键', label: '充能', value: `每发 +${def.energyGain} 能量` });
  } else if (m.kind === 'overload') {
    lines.push({ key: 'E', label: '过载形态', value: `耗能 ${m.energyPerSec}/s，伤害提升` });
  } else if (m.kind === 'lockon') {
    lines.push({ key: 'E', label: '电弧索敌', value: `范围 ${m.range}m，伤害倍率 ${m.damageFactor.toFixed(1)} · 冷却 ${m.cooldown.toFixed(1)}s` });
  } else if (m.kind === 'slow') {
    lines.push({ key: '命中', label: '霜缓', value: `减速 ${Math.round((1 - m.factor) * 100)}% · ${m.seconds}s` });
  } else if (m.kind === 'charge') {
    lines.push({ key: '左键', label: '蓄力射击', value: `蓄满伤害×${m.maxMult.toFixed(1)}` });
  }
  lines.push({ key: '', label: '', value: `射速 ${def.rpm} · 弹匣 ${def.mag} · 暴击×${def.critMult.toFixed(1)}` });
  return lines;
}
