/**
 * shell/radar — 环形雷达小地图。
 *
 * 玩家居中、随视角旋转（面前朝上）；敌人/BOSS/补给以点标注。
 * 用 push 式 API（begin → dot* → end）避免每帧分配。
 * 绘制频率由调用方控制（建议每 2 帧一次即可）。
 */
export class Radar {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly range: number;
  private px = 0;
  private pz = 0;
  private yaw = 0;

  constructor(size = 148, range = 34) {
    this.size = size;
    this.range = range;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.id = 'ss-radar';
    c.style.cssText = `position:fixed;top:16px;right:16px;z-index:15;pointer-events:none;opacity:0.92;`;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    this.ctx = ctx;
    this.el = c;
    document.body.appendChild(c);
  }

  /** 开始一帧：清屏、画底、记录玩家位置与朝向 */
  begin(px: number, pz: number, yaw: number): void {
    this.px = px;
    this.pz = pz;
    this.yaw = yaw;
    const ctx = this.ctx;
    const s = this.size;
    ctx.clearRect(0, 0, s, s);
    // 底盘
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,12,17,0.6)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(125,134,152,0.5)';
    ctx.stroke();
    // 距离圈
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, (s / 2 - 2) * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(125,134,152,0.22)';
    ctx.stroke();
    // 视线扇形（面前 60°）
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    ctx.arc(s / 2, s / 2, s / 2 - 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(143,180,216,0.14)';
    ctx.fill();
  }

  /** 标注一个点（世界坐标） */
  dot(x: number, z: number, color: string, size: number): void {
    const dx = x - this.px;
    const dz = z - this.pz;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // 玩家坐标系：right = (cos yaw, -sin yaw)，forward = (-sin yaw, -cos yaw)
    const rx = dx * cy - dz * sy;
    const fwd = -(dx * sy + dz * cy);
    const scale = (this.size / 2 - 4) / this.range;
    if (Math.hypot(rx, fwd) * scale > this.size / 2 - 5) return; // 出圈不画
    const sx = this.size / 2 + rx * scale;
    const py = this.size / 2 - fwd * scale; // 面前朝上
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(sx, py, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /** 结束一帧：画玩家箭头 */
  end(): void {
    const ctx = this.ctx;
    const s = this.size;
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fillStyle = '#e8e4da';
    ctx.fill();
    ctx.restore();
  }
}
