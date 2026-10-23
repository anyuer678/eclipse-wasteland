/**
 * horde/spatialHash — 敌人分离用的均匀网格（空间哈希）。
 *
 * 修复前每帧对全场敌人做 O(n²) 两两检测；战场扩大、波次加密后，
 * 同屏 40+ 时开销明显。这里按 1.5m 网格分桶，只检查同格与邻格，
 * 输出的 (i, j) 对满足 i < j 且可能重叠（精确判定仍由 separationDelta 做）。
 */
export class SpatialHash {
  private readonly cell: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly pairBuf: number[] = [];

  constructor(cell = 1.5) {
    this.cell = cell;
  }

  clear(): void {
    this.buckets.clear();
    this.pairBuf.length = 0;
  }

  insert(index: number, x: number, z: number): void {
    const key = this.key(this.col(x), this.row(z));
    const list = this.buckets.get(key);
    if (list) list.push(index);
    else this.buckets.set(key, [index]);
  }

  /** 返回所有 i<j 的候选对（扁平数组 [i0,j0,i1,j1,...]） */
  pairs(): number[] {
    this.pairBuf.length = 0;
    for (const [key, list] of this.buckets) {
      // 同格内两两
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const i = list[a];
          const j = list[b];
          this.pairBuf.push(i < j ? i : j, i < j ? j : i);
        }
      }
      // 与“右/下”半平面的邻格（避免重复）
      const col = Math.floor(key / 100000) - 200;
      for (const [dc, dr] of [[1, -1], [1, 0], [1, 1], [0, 1]] as const) {
        const other = this.buckets.get(this.key(col + dc, this.rowFromKey(key) + dr));
        if (!other) continue;
        for (const i of list) {
          for (const j of other) this.pairBuf.push(i < j ? i : j, i < j ? j : i);
        }
      }
    }
    return this.pairBuf;
  }

  private col(x: number): number {
    return Math.floor(x / this.cell);
  }

  private row(z: number): number {
    return Math.floor(z / this.cell);
  }

  private key(c: number, r: number): number {
    // 偏移到非负，避免负数哈希碰撞（c/r 范围 ±80 → 偏移 200 足够）
    return (c + 200) * 100000 + (r + 200);
  }

  private rowFromKey(key: number): number {
    return (key % 100000) - 200;
  }
}
