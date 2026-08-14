/**
 * core/rng — 确定性伪随机数生成器。
 *
 * 使用种子初始化，同一种子产生同一序列——战斗模拟、掉落、暴击
 * 全部可复现（对平衡测试至关重要）。fork 从种子派生子生成器，
 * 使各系统互不干扰又不破坏可复现性。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 [0, 1) 浮点数 */
  next(): number {
    // xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (x >>> 0) / 4294967296;
  }

  /** 返回 [min, max) 整数 */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** 返回 [min, max) 浮点数 */
  range(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** 以 probability（0..1）概率返回 true */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** 从数组中随机取一个元素 */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** 派生子生成器（同种子同分支则序列一致） */
  fork(label: string): Rng {
    let h = 2166136261;
    for (let i = 0; i < label.length; i++) {
      h ^= label.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= this.state;
    h = Math.imul(h, 16777619);
    return new Rng(h >>> 0);
  }
}
