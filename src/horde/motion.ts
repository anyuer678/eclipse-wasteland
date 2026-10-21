/**
 * horde/motion — 敌人垂直移动与体积分离的纯函数。
 *
 * 旧实现只做「地面更高就抬上去」，导致下坡/走平台边缘时永久悬空，
 * 也会从侧面瞬移爬上 1.2m 平台。这里用台阶上限 + 重力：
 *   - 连续坡道/小台阶：贴地跟随
 *   - 超过 stepUp 的高差：保持原高度（交给水平碰撞推开）
 *   - 地面低于脚下超过 stepUp：进入下落
 */

export const ENEMY_GRAVITY = 22;

export interface VerticalBody {
  y: number;
  vy: number;
  grounded: boolean;
}

export function stepVertical(body: VerticalBody, ground: number, dt: number, stepUp = 0.5): void {
  if (body.grounded) {
    const dy = ground - body.y;
    if (dy > stepUp) {
      // 面前是墙/高台：不要瞬移上去，水平碰撞会处理
      body.vy = 0;
      return;
    }
    if (dy >= -stepUp) {
      body.y = ground;
      body.vy = 0;
      return;
    }
    body.grounded = false;
    body.vy = 0;
  }
  body.vy -= ENEMY_GRAVITY * dt;
  body.y += body.vy * dt;
  if (body.y <= ground) {
    body.y = ground;
    body.vy = 0;
    body.grounded = true;
  }
}

/** 两个圆柱体的水平重叠量（<=0 表示没重叠） */
export function overlapDepth(ax: number, az: number, ar: number, bx: number, bz: number, br: number): number {
  return ar + br - Math.hypot(ax - bx, az - bz);
}

/**
 * 写出一对重叠单位的分离位移（各自一半，带松弛系数）。
 * 完全重合时用 fallbackAngle 给出确定方向，避免同点抖动。
 */
export function separationDelta(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
  out: { x: number; z: number },
  fallbackAngle = 0,
  relax = 0.55
): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  const min = ar + br;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) {
    out.x = 0;
    out.z = 0;
    return false;
  }
  const d = Math.sqrt(d2);
  let nx = 0;
  let nz = 0;
  if (d > 1e-5) {
    nx = dx / d;
    nz = dz / d;
  } else {
    nx = Math.cos(fallbackAngle);
    nz = Math.sin(fallbackAngle);
  }
  const push = (min - d) * 0.5 * relax;
  out.x = nx * push;
  out.z = nz * push;
  return true;
}
