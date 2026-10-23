/**
 * play/damageTaken — 玩家受伤的减伤计算（纯函数）。
 *
 * 总减伤 = 天赋护甲 + 局内铁壁 + 狂暴抗性，夹取到 85%；
 * 护盾生效时再乘 0.3（即再减免 70%）。等级压制在调用方先乘。
 */
export function mitigatedDamage(
  raw: number,
  armor: number,
  ironWall: number,
  furyResist: number,
  shielded: boolean
): number {
  const mitigation = Math.min(0.85, armor + ironWall + furyResist);
  return raw * (1 - mitigation) * (shielded ? 0.3 : 1);
}
