/**
 * core/math — 数值工具（纯函数，无副作用）。
 */
export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 角度线性插值（按最短弧，输入输出均为弧度） */
export function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** 将 v 限制在 [min, max]，返回是否发生了截断 */
export function clampWithFlag(v: number, min: number, max: number): { value: number; clamped: boolean } {
  if (v < min) return { value: min, clamped: true };
  if (v > max) return { value: max, clamped: true };
  return { value: v, clamped: false };
}
