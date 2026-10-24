/**
 * play/weakpoint — 弱点判定：瞄准线在目标中心处的通过高度明显高于中心即为弱点。
 * 用“最近点高度”而不是命中球面点，避免大体型目标（BOSS）永远判不到头。
 */
export const WEAKPOINT_THRESHOLD = 0.35;
export const WEAKPOINT_MULT = 1.5;

export interface WpVec {
  x: number;
  y: number;
  z: number;
}

export function weakpointMultiplier(aimY: number, targetCenterY: number): number {
  return aimY - targetCenterY >= WEAKPOINT_THRESHOLD ? WEAKPOINT_MULT : 1;
}

export function weakpointFromAim(origin: WpVec, dir: WpVec, center: WpVec): number {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  const aimY = origin.y + dir.y * Math.max(0, t);
  return weakpointMultiplier(aimY, center.y);
}
