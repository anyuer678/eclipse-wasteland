/**
 * play/dash — 玩家冲刺的步进移动（纯逻辑）。
 *
 * 不能直接 position += 6m：按 0.25m 步进逐段做活动半径、高台阶与碰撞检查，
 * 撞墙即停，避免穿墙/穿平台。
 */
export interface DashPoint {
  x: number;
  y: number;
  z: number;
}

export interface DashBody {
  position: DashPoint;
  collide(p: DashPoint): void;
}

export interface DashOptions {
  arenaRadius: number;
  terrainHeightAt: (x: number, z: number) => number;
  distance?: number;
  stepSize?: number;
  maxStepUp?: number;
}

/** 返回冲刺实际前进的距离（m），便于特效/音效按距离处理 */
export function dashStep(body: DashBody, yaw: number, o: DashOptions): number {
  const distance = o.distance ?? 6;
  const step = o.stepSize ?? 0.25;
  const maxStepUp = o.maxStepUp ?? 0.55;
  const steps = Math.ceil(distance / step);
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const startX = body.position.x;
  const startZ = body.position.z;
  const probe: DashPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < steps; i++) {
    const nx = body.position.x + dx * step;
    const nz = body.position.z + dz * step;
    if (Math.hypot(nx, nz) > o.arenaRadius - 0.5) break;
    const ng = o.terrainHeightAt(nx, nz);
    if (ng - body.position.y > maxStepUp) break; // 高台阶：冲刺不能上
    probe.x = nx;
    probe.y = body.position.y;
    probe.z = nz;
    body.collide(probe);
    const movedX = probe.x - body.position.x;
    const movedZ = probe.z - body.position.z;
    if (movedX * dx + movedZ * dz < step * 0.25) break; // 撞墙
    body.position.x = probe.x;
    body.position.z = probe.z;
    const gHere = o.terrainHeightAt(body.position.x, body.position.z);
    if (gHere > body.position.y && gHere - body.position.y <= maxStepUp) body.position.y = gHere;
  }
  return Math.hypot(body.position.x - startX, body.position.z - startZ);
}
