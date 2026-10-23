/**
 * shell/radarFeed — 把当前战局实体映射到雷达（每 2 帧调用一次）。
 *
 * 只做只读遍历与点绘制，不改变战斗状态；颜色/点位与 HUD 图例保持一致。
 */
import type { Radar } from './radar';

export interface RadarPointLike {
  x: number;
  z: number;
}

export interface RadarDeps {
  radar: Radar;
  playerX: number;
  playerZ: number;
  yaw: number;
  enemies: readonly { alive: boolean; root: { position: RadarPointLike }; def: { color: number } }[];
  boss: { alive: boolean; root: { position: RadarPointLike } } | null;
  crates: readonly { alive: boolean; x: number; z: number }[];
  chests: readonly { mesh: { position: RadarPointLike } }[];
  orbs: readonly { mesh: { position: RadarPointLike } }[];
  poisonPools: readonly RadarPointLike[];
}

const hex = (color: number): string => '#' + color.toString(16).padStart(6, '0');

export function drawRadar(d: RadarDeps): void {
  d.radar.begin(d.playerX, d.playerZ, d.yaw);
  for (const e of d.enemies) {
    if (!e.alive) continue;
    d.radar.dot(e.root.position.x, e.root.position.z, hex(e.def.color), 3);
  }
  if (d.boss && d.boss.alive) d.radar.dot(d.boss.root.position.x, d.boss.root.position.z, '#ff4400', 5);
  for (const c of d.crates) if (c.alive) d.radar.dot(c.x, c.z, '#d9a44a', 2);
  // 补给宝箱与 BUFF 球也标出来（雷达说明里的“补给”）
  for (const c of d.chests) d.radar.dot(c.mesh.position.x, c.mesh.position.z, '#ffe9a8', 3);
  for (const o of d.orbs) d.radar.dot(o.mesh.position.x, o.mesh.position.z, '#66d9ff', 2);
  for (const pool of d.poisonPools) d.radar.dot(pool.x, pool.z, 'rgba(62,160,85,0.85)', 4);
  d.radar.end();
}
