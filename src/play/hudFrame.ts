/**
 * play/hudFrame — 战斗 HUD 每帧数据组装（纯映射，从 game.ts 抽出）。
 *
 * 输入为当帧状态快照，输出直接喂给 Shell 的 HudView.update；
 * 技能面板的行文案（等级/经验/强化/冷却/连杀）在这里统一生成，便于单测。
 */
import { BOOST_POOL, expNeeded } from '../growth';
import type { HudView, SkillLine } from '../shell/hud';

export interface HudFrameDeps {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  weaponName: string;
  weaponLevel: number;
  weaponAsc: number;
  damageMult: number;
  ammo: number;
  mag: number;
  reloading: boolean;
  phase: string;
  wave: number;
  totalWaves: number;
  tower: boolean;
  missionName: string;
  autoPick: string | null;
  monsterLevel: number;
  playerLevel: number;
  runLevel: number;
  runExp: number;
  boosts: Record<string, number>;
  weaponLines: SkillLine[];
  roleName: string;
  roleCooldown: number;
  dashCooldown: number;
  shieldCooldown: number;
  shieldTimer: number;
  killStreak: number;
  slots: { name: string; rarity: string }[];
  slotIndex: number;
}

export function hudFrame(d: HudFrameDeps): Parameters<HudView['update']>[0] {
  const boostText =
    BOOST_POOL.filter((b) => (d.boosts[b.id] ?? 0) > 0)
      .map((b) => `${b.name}×${d.boosts[b.id]}`)
      .join(' ') || '无强化';
  const lines: SkillLine[] = d.weaponLines.concat(
    { key: '局', label: `等级 ${d.runLevel}`, value: `经验 ${d.runExp}/${expNeeded(d.runLevel)} · ${boostText}` },
    { key: 'X', label: d.roleName, value: d.roleCooldown > 0 ? `冷却 ${Math.ceil(d.roleCooldown)}s` : '就绪（大招）' },
    { key: 'F', label: '冲刺', value: d.dashCooldown > 0 ? `冷却 ${d.dashCooldown.toFixed(1)}s` : '就绪' },
    {
      key: 'G',
      label: '护盾',
      value: d.shieldCooldown > 0 ? `冷却 ${d.shieldCooldown.toFixed(1)}s` : d.shieldTimer > 0 ? `生效 ${d.shieldTimer.toFixed(1)}s` : '就绪',
    }
  );
  if (d.killStreak > 0) {
    lines.push({ key: '连杀', label: `${d.killStreak} 连杀`, value: `伤害+${Math.min(d.killStreak, 6) * 5}%` });
  }
  return {
    hp: d.hp,
    maxHp: d.maxHp,
    energy: d.energy,
    maxEnergy: d.maxEnergy,
    weaponName: d.weaponName,
    weaponLevel: d.weaponLevel,
    weaponAsc: d.weaponAsc,
    damageMult: d.damageMult,
    ammo: d.ammo,
    mag: d.mag,
    reloading: d.reloading,
    phase: d.phase,
    wave: d.wave,
    totalWaves: d.totalWaves,
    tower: d.tower,
    missionName: d.missionName,
    autoPick: d.autoPick,
    monsterLevel: d.monsterLevel,
    playerLevel: d.playerLevel,
    skillLines: lines,
    slots: d.slots,
    slotIndex: d.slotIndex,
  };
}
