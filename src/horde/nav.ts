/**
 * horde/nav — 小怪寻路网格（流场 + 视线平滑）。
 *
 * 地图碰撞体是静态 AABB（含平台顶面高度），因此启动/换图时烘焙一张
 * 2.5D 网格：格子中心的地面高度决定它是否可站（平台顶可走、侧壁不可走、
 * 斜坡与平台顶的高差不超过 stepHeight 时连通）。每次玩家跨格才重算一次
 * 到玩家的 BFS 流场，单个敌人寻路只做 O(1) 采样 + 若干次视线检查。
 *
 * 纯函数/纯数据模块：不依赖 three，方便直接单元测试。
 */

export interface NavObstacle {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** 碰撞体顶面绝对高度（世界坐标 y） */
  top: number;
  /** 可破坏木箱：击碎后从障碍/导航中移除；射线命中时可结算木箱伤害 */
  crate?: boolean;
}

export interface NavPoint {
  x: number;
  z: number;
  y: number;
}

export interface NavBuildOptions {
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  cell?: number;
  /** 按最大兵种半径外扩，避免贴墙卡脚 */
  agentRadius?: number;
  stepHeight?: number;
  /** 可活动圆形边界半径 */
  walkRadius?: number;
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 线段与 AABB 是否相交（slab 法） */
function segmentHitsBox(ax: number, az: number, bx: number, bz: number, minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - minX, maxX - ax, az - minZ, maxZ - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

export class NavField {
  cell = 0.7;
  minX = -39;
  maxX = 39;
  minZ = -39;
  maxZ = 39;
  agentRadius = 0.62;
  stepHeight = 0.5;
  walkRadius = 38.5;

  cols = 0;
  rows = 0;
  private obstaclesData: NavObstacle[] = [];
  get obstacles(): readonly NavObstacle[] {
    return this.obstaclesData;
  }
  private floor = new Float32Array(0);
  private walk = new Uint8Array(0);
  private dist = new Int32Array(0);
  private queue = new Int32Array(0);
  /** 最大连通区域（主战场）：刷怪点必须落在这里，避免刷在无坡平台的孤岛上 */
  private main = new Uint8Array(0);
  private heightAt: (x: number, z: number) => number = () => 0;

  private goalCell = -1;
  private goalX = 0;
  private goalZ = 0;
  private flowReady = false;

  build(obstacles: readonly NavObstacle[], heightAt: (x: number, z: number) => number, opts?: NavBuildOptions): void {
    this.cell = opts?.cell ?? 0.7;
    this.minX = opts?.minX ?? -39;
    this.maxX = opts?.maxX ?? 39;
    this.minZ = opts?.minZ ?? -39;
    this.maxZ = opts?.maxZ ?? 39;
    this.agentRadius = opts?.agentRadius ?? 0.62;
    this.stepHeight = opts?.stepHeight ?? 0.5;
    this.walkRadius = opts?.walkRadius ?? 38.5;
    this.heightAt = heightAt;
    this.obstaclesData = obstacles.slice();

    this.cols = Math.ceil((this.maxX - this.minX) / this.cell);
    this.rows = Math.ceil((this.maxZ - this.minZ) / this.cell);
    const n = this.cols * this.rows;
    this.floor = new Float32Array(n);
    this.walk = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.goalCell = -1;
    this.flowReady = false;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        const cx = this.cellX(col);
        const cz = this.cellZ(row);
        const h = heightAt(cx, cz);
        this.floor[i] = h;
        if (Math.hypot(cx, cz) > this.walkRadius) continue;
        this.walk[i] = 1;
        for (const o of this.obstacles) {
          if (Math.abs(cx - o.x) > o.hw + this.agentRadius || Math.abs(cz - o.z) > o.hd + this.agentRadius) continue;
          // 已站上顶面（平台/高地）：可走
          if (h >= o.top - 0.1) continue;
          // 斜坡贴近顶面的收口处：高差在可跨越范围内，可走
          if (h >= o.top - this.stepHeight - 0.08) continue;
          this.walk[i] = 0;
          break;
        }
      }
    }
    this.bakeMain();
  }

  /** 标记最大的连通区域为主战场（平台顶/封闭山坳等孤岛不算） */
  private bakeMain(): void {
    const n = this.walk.length;
    this.main = new Uint8Array(n);
    const comp = new Int32Array(n).fill(-1);
    const q = this.queue;
    let bestLabel = -1;
    let bestSize = 0;
    let label = 0;
    for (let s = 0; s < n; s++) {
      if (this.walk[s] !== 1 || comp[s] !== -1) continue;
      let head = 0;
      let tail = 0;
      let size = 0;
      comp[s] = label;
      q[tail++] = s;
      while (head < tail) {
        const cur = q[head++];
        size += 1;
        const cc = cur % this.cols;
        const cr = (cur / this.cols) | 0;
        for (const [dc, dr] of DIRS) {
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.inBounds(nc, nr)) continue;
          const ni = nr * this.cols + nc;
          if (this.walk[ni] !== 1 || comp[ni] !== -1) continue;
          if (Math.abs(this.floor[ni] - this.floor[cur]) > this.stepHeight) continue;
          if (dc !== 0 && dr !== 0) {
            if (this.walk[cr * this.cols + nc] !== 1 || this.walk[nr * this.cols + cc] !== 1) continue;
          }
          comp[ni] = label;
          q[tail++] = ni;
        }
      }
      if (size > bestSize) {
        bestSize = size;
        bestLabel = label;
      }
      label += 1;
    }
    if (bestLabel < 0) return;
    for (let i = 0; i < n; i++) {
      if (comp[i] === bestLabel) this.main[i] = 1;
    }
  }

  /** 是否位于最大连通区域（主战场） */
  inMain(x: number, z: number): boolean {
    const i = this.indexOf(x, z);
    return i >= 0 && this.main[i] === 1;
  }

  get ready(): boolean {
    return this.walk.length > 0;
  }

  cellX(col: number): number {
    return this.minX + (col + 0.5) * this.cell;
  }

  cellZ(row: number): number {
    return this.minZ + (row + 0.5) * this.cell;
  }

  colOf(x: number): number {
    return Math.floor((x - this.minX) / this.cell);
  }

  rowOf(z: number): number {
    return Math.floor((z - this.minZ) / this.cell);
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  indexOfCell(col: number, row: number): number {
    return this.inBounds(col, row) ? row * this.cols + col : -1;
  }

  indexOf(x: number, z: number): number {
    return this.indexOfCell(this.colOf(x), this.rowOf(z));
  }

  isWalkable(x: number, z: number): boolean {
    const i = this.indexOf(x, z);
    return i >= 0 && this.walk[i] === 1;
  }

  groundAt(x: number, z: number): number {
    const i = this.indexOf(x, z);
    return i >= 0 ? this.floor[i] : this.heightAt(x, z);
  }

  /** updateTarget 后，该点到目标格是否存在流场路径 */
  reachable(x: number, z: number): boolean {
    const i = this.indexOf(x, z);
    return i >= 0 && this.walk[i] === 1 && this.dist[i] >= 0;
  }

  /** 调试：流场步数 / 未经平滑的邻格方向 */
  distanceAt(x: number, z: number): number {
    const i = this.indexOf(x, z);
    return i >= 0 ? this.dist[i] : -1;
  }

  rawFlow(x: number, z: number, out: { x: number; z: number }): boolean {
    const i = this.indexOf(x, z);
    if (i < 0 || this.dist[i] < 0 || this.walk[i] !== 1) return false;
    const n = this.bestNext(i);
    if (n < 0) return false;
    out.x = this.cellX(n % this.cols) - this.cellX(i % this.cols);
    out.z = this.cellZ((n / this.cols) | 0) - this.cellZ((i / this.cols) | 0);
    return true;
  }

  /** 最近可走格（螺旋搜索；找不到返回 -1） */
  nearestWalkable(col: number, row: number, maxRing = 12): number {
    const c0 = Math.max(0, Math.min(this.cols - 1, col));
    const r0 = Math.max(0, Math.min(this.rows - 1, row));
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          const i = this.indexOfCell(c, r);
          if (i >= 0 && this.walk[i] === 1) return i;
        }
      }
    }
    return -1;
  }

  /**
   * 最近的可走且可达、并且地面不高于当前脚面 + 台阶的格子。
   * 被挤进墙里时不能直接吸到高台顶面（那会让人贴着侧壁原地抖）。
   */
  nearestWalkableNear(col: number, row: number, feetY: number, maxRing = 16): number {
    const c0 = Math.max(0, Math.min(this.cols - 1, col));
    const r0 = Math.max(0, Math.min(this.rows - 1, row));
    const maxFloor = feetY + this.stepHeight + 0.05;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          const i = this.indexOfCell(c, r);
          if (i < 0 || this.walk[i] !== 1 || this.dist[i] < 0) continue;
          if (this.floor[i] > maxFloor) continue;
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * 目标格变化时重算 BFS 流场。玩家所在格不可走时退到最近可走格，
   * 敌人会汇集到该点而不是贴着墙抖。
   */
  updateTarget(tx: number, tz: number): void {
    this.goalX = tx;
    this.goalZ = tz;
    if (!this.ready) return;
    const col = this.colOf(tx);
    const row = this.rowOf(tz);
    let start = this.indexOfCell(col, row);
    if (start < 0 || this.walk[start] !== 1) start = this.nearestWalkable(col, row);
    if (start === this.goalCell && this.flowReady) return;
    this.goalCell = start;
    this.flowReady = true;
    this.dist.fill(-1);
    if (start < 0) return;
    const q = this.queue;
    let head = 0;
    let tail = 0;
    this.dist[start] = 0;
    q[tail++] = start;
    while (head < tail) {
      const cur = q[head++];
      const cc = cur % this.cols;
      const cr = (cur / this.cols) | 0;
      const d = this.dist[cur];
      for (const [dc, dr] of DIRS) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (!this.inBounds(nc, nr)) continue;
        const ni = nr * this.cols + nc;
        if (this.walk[ni] !== 1 || this.dist[ni] >= 0) continue;
        // 相邻格高差过大不可通行：否则流场会把小怪直接导到斜坡/平台侧壁上
        if (Math.abs(this.floor[ni] - this.floor[cur]) > this.stepHeight) continue;
        if (dc !== 0 && dr !== 0) {
          // 不允许擦角，否则大体积单位会卡在墙角
          if (this.walk[cr * this.cols + nc] !== 1 || this.walk[nr * this.cols + cc] !== 1) continue;
        }
        this.dist[ni] = d + 1;
        q[tail++] = ni;
      }
    }
  }

  /** 在当前脚下高度下，两点之间能否直线通行（障碍物按 agentRadius 外扩） */
  lineClear(ax: number, az: number, bx: number, bz: number, feetY: number, margin = this.agentRadius): boolean {
    for (const o of this.obstacles) {
      // 障碍顶面在脚下（或只差一个可跨台阶）时不挡路
      if (o.top <= feetY + this.stepHeight) continue;
      if (
        segmentHitsBox(
          ax,
          az,
          bx,
          bz,
          o.x - o.hw - margin,
          o.x + o.hw + margin,
          o.z - o.hd - margin,
          o.z + o.hd + margin
        )
      ) {
        return false;
      }
    }
    // 高度连续性：直线不能跨沟/跨陡坎（否则敌人会走下坎后再也爬不回来）
    const len = Math.hypot(bx - ax, bz - az);
    if (len > 0.9) {
      const samples = Math.min(12, Math.ceil(len / Math.max(0.4, this.cell * 0.8)));
      let prev = this.heightAt(ax, az);
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const h = this.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
        if (Math.abs(h - prev) > this.stepHeight) return false;
        prev = h;
      }
    }
    return true;
  }

  /**
   * 地形遮挡：沿线段按格查烘焙地面高度，返回首个遮挡点的 3D 距离（无遮挡返回 null）。
   * 两端各留 0.6m，脚下斜坡/平台边缘不会被误判成挡墙；0.12m 余量用于吞掉网格量化误差。
   */
  terrainRayDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1.2) return null;
    const segLen = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.min(48, Math.ceil(horiz / 0.9)));
    const endPad = 0.6 / horiz;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (t < endPad || t > 1 - endPad) continue;
      const x = ax + dx * t;
      const z = az + dz * t;
      const gi = this.indexOf(x, z);
      const ground = gi >= 0 ? this.floor[gi] : this.heightAt(x, z);
      if (ground > ay + dy * t + 0.12) return segLen * t;
    }
    return null;
  }

  /**
   * 弹道/攻击视线：精确 3D 线段-AABB 求交 + 地形高度遮挡。
   * 障碍从地面延伸到 top，低于 top-0.05 的穿越算遮挡；
   * 比固定步数采样可靠，细墙在远距离也不会被跨过。
   */
  hasLineOfSight3D(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const o of this.obstacles) {
      const minX = o.x - o.hw;
      const maxX = o.x + o.hw;
      const minZ = o.z - o.hd;
      const maxZ = o.z + o.hd;
      const top = o.top - 0.05;
      let t0 = 0;
      let t1 = 1;
      if (Math.abs(dx) < 1e-9) {
        if (ax < minX || ax > maxX) continue;
      } else {
        let ta = (minX - ax) / dx;
        let tb = (maxX - ax) / dx;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) {
        if (az < minZ || az > maxZ) continue;
      } else {
        let ta = (minZ - az) / dz;
        let tb = (maxZ - az) / dz;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dy) < 1e-9) {
        if (ay > top) continue;
      } else {
        const ty = (top - ay) / dy;
        if (dy > 0) {
          if (ty < t1) t1 = ty;
        } else {
          if (ty > t0) t0 = ty;
        }
        if (t0 > t1) continue;
      }
      return false;
    }
    return this.terrainRayDistance(ax, ay, az, bx, by, bz) === null;
  }

  /** 沿流场选一个尽量远的、可直视的路径点；返回是否找到方向 */
  steer(x: number, z: number, feetY: number, out: { x: number; z: number }): boolean {
    if (!this.ready) return false;
    if (!this.flowReady) this.updateTarget(this.goalX, this.goalZ);

    const dxGoal = this.goalX - x;
    const dzGoal = this.goalZ - z;
    const dGoal = Math.hypot(dxGoal, dzGoal);
    if (dGoal < 0.08) {
      out.x = 0;
      out.z = 0;
      return true;
    }
    // 能直视玩家且目标不在高处就直冲（流场只负责绕障/爬坡）
    const goalGround = this.groundAt(this.goalX, this.goalZ);
    if (goalGround - feetY <= this.stepHeight && this.lineClear(x, z, this.goalX, this.goalZ, feetY, this.agentRadius * 0.9)) {
      out.x = dxGoal / dGoal;
      out.z = dzGoal / dGoal;
      return true;
    }

    let start = this.indexOf(x, z);
    if (start < 0 || this.walk[start] !== 1 || this.dist[start] < 0) {
      start = this.nearestWalkableNear(this.colOf(x), this.rowOf(z), feetY, 16);
    }
    if (start >= 0 && this.dist[start] >= 0) {
      let cur = start;
      let way = -1;
      let first = -1;
      for (let step = 0; step < 10; step++) {
        const next = this.bestNext(cur);
        if (next < 0) break;
        if (first < 0) first = next;
        const nx = this.cellX(next % this.cols);
        const nz = this.cellZ((next / this.cols) | 0);
        if (this.lineClear(x, z, nx, nz, feetY, this.agentRadius * 0.55)) way = next;
        else break;
        cur = next;
        if (next === this.goalCell) break;
      }
      if (way < 0) way = first >= 0 ? first : start;
      const wx = this.cellX(way % this.cols) - x;
      const wz = this.cellZ((way / this.cols) | 0) - z;
      const wl = Math.hypot(wx, wz);
      if (wl > 0.05) {
        out.x = wx / wl;
        out.z = wz / wl;
        return true;
      }
    }

    out.x = dxGoal / dGoal;
    out.z = dzGoal / dGoal;
    return true;
  }

  /** 从当前格向目标下降最快的邻格（平局时偏向玩家方向，避免来回横跳） */
  private bestNext(i: number): number {
    const cc = i % this.cols;
    const cr = (i / this.cols) | 0;
    const cx = this.cellX(cc);
    const cz = this.cellZ(cr);
    let gx = this.goalX - cx;
    let gz = this.goalZ - cz;
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-6) {
      gx /= gl;
      gz /= gl;
    } else {
      gx = 0;
      gz = 0;
    }
    const d = this.dist[i];
    let best = -1;
    let bestScore = Infinity;
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!this.inBounds(nc, nr)) continue;
      const ni = nr * this.cols + nc;
      if (this.walk[ni] !== 1 || this.dist[ni] < 0) continue;
      if (this.dist[ni] >= d) continue;
      if (Math.abs(this.floor[ni] - this.floor[i]) > this.stepHeight) continue;
      if (dc !== 0 && dr !== 0) {
        if (this.walk[cr * this.cols + nc] !== 1 || this.walk[nr * this.cols + cc] !== 1) continue;
      }
      const len = Math.hypot(dc, dr);
      const dot = (dc * gx + dr * gz) / len;
      const score = this.dist[ni] + (1 - dot) * 0.25;
      if (score < bestScore) {
        bestScore = score;
        best = ni;
      }
    }
    return best;
  }

  /**
   * 找一个可刷怪点：在中心周围 [minR, maxR] 的圆环内，落点可站立，
   * 且与已放置点保持间距。找不到返回 null。
   */
  findSpawnPoint(
    random: () => number,
    cx: number,
    cz: number,
    minR: number,
    maxR: number,
    placed: readonly { x: number; z: number; r: number }[] = [],
    minGap = 1.4
  ): NavPoint | null {
    if (!this.ready) return null;
    const gapOk = (x: number, z: number): boolean => {
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < minGap + p.r) return false;
      }
      return true;
    };
    for (let attempt = 0; attempt < 72; attempt++) {
      const angle = random() * Math.PI * 2;
      const dist = minR + random() * Math.max(0, maxR - minR);
      const x = cx + Math.cos(angle) * dist;
      const z = cz + Math.sin(angle) * dist;
      if (Math.hypot(x, z) > this.walkRadius - 4) continue;
      if (!this.isWalkable(x, z)) continue;
      const i = this.indexOf(x, z);
      if (i < 0 || this.walk[i] !== 1) continue;
      if (this.main[i] !== 1) continue;
      if (!gapOk(x, z)) continue;
      return { x, z, y: this.floor[i] };
    }
    // 极端情况（中心贴边/整圈被挡）：在整张网里随机挑一个远离中心的合法格
    let chosen = -1;
    let seen = 0;
    const n = this.walk.length;
    const startIdx = Math.floor(random() * Math.max(1, n));
    for (let k = 0; k < n; k++) {
      const i = (startIdx + k) % n;
      if (this.walk[i] !== 1 || this.main[i] !== 1) continue;
      const x = this.cellX(i % this.cols);
      const z = this.cellZ((i / this.cols) | 0);
      const d = Math.hypot(x - cx, z - cz);
      if (d < minR * 0.7 || d > maxR * 1.5) continue;
      if (!gapOk(x, z)) continue;
      seen += 1;
      if (random() * seen < 1) chosen = i;
    }
    if (chosen < 0) return null;
    return { x: this.cellX(chosen % this.cols), z: this.cellZ((chosen / this.cols) | 0), y: this.floor[chosen] };
  }
}
