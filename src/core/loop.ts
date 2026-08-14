/**
 * core/loop — 固定时间步长游戏循环。
 *
 * 游戏逻辑以固定步长（60Hz）推进，渲染跟随显示帧率（可变）。
 * 累积器模式：渲染帧间隔累加，每满一个 fixedDt 就执行一次逻辑步。
 */
export interface FixedLoopOptions {
  /** 逻辑固定步长（秒） */
  fixedDt: number;
  /** 每步逻辑回调 */
  onFixed: (dt: number, time: number) => void;
  /** 每帧渲染回调（alpha 为渲染帧与最近逻辑帧之间的插值因子 0..1） */
  onRender?: (alpha: number, time: number) => void;
}

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private elapsed = 0;
  private running = false;
  private readonly dt: number;
  private readonly onFixed: (dt: number, time: number) => void;
  private readonly onRender?: (alpha: number, time: number) => void;

  constructor(opts: FixedLoopOptions) {
    this.dt = opts.fixedDt;
    this.onFixed = opts.onFixed;
    this.onRender = opts.onRender;
  }

  /** 用 requestAnimationFrame 驱动 */
  start(raf: (cb: (now: number) => void) => number): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const frame = Math.min((now - this.last) / 1000, 0.25); // 防螺旋：单帧上限 250ms
      this.last = now;
      this.acc += frame;
      while (this.acc >= this.dt) {
        this.elapsed += this.dt;
        this.onFixed(this.dt, this.elapsed);
        this.acc -= this.dt;
      }
      if (this.onRender) {
        this.onRender(this.acc / this.dt, this.elapsed);
      }
      raf(tick);
    };
    raf(tick);
  }

  stop(): void {
    this.running = false;
  }
}
