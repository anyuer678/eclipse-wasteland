/**
 * campaign/spawnZones — 区域刷怪的锚点选择（纯函数）。
 *
 * 波次不再全部围绕玩家均匀刷；改为按“地标/外圈点位”分簇，
 * 每 groupSize 只怪轮换一个锚点，并跳过离玩家过近/过远的锚点。
 */
export interface SpawnAnchor {
  x: number;
  z: number;
}

export function pickSpawnAnchor(
  anchors: readonly SpawnAnchor[],
  seq: number,
  groupSize: number,
  px: number,
  pz: number,
  minDist = 12,
  maxDist = 40
): SpawnAnchor | null {
  if (anchors.length === 0) return null;
  const usable = anchors.filter((a) => {
    const d = Math.hypot(a.x - px, a.z - pz);
    return d >= minDist && d <= maxDist;
  });
  if (usable.length === 0) return null;
  const group = Math.floor(Math.max(0, seq) / Math.max(1, groupSize));
  return usable[group % usable.length];
}
