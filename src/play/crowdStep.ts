/**
 * play/crowdStep — 敌人群体分离（每次两个松弛迭代）。
 *
 * 从 game.ts 抽出：只依赖空间哈希与 separationDelta，便于单测与复用。
 */
import { SpatialHash, separationDelta } from '../horde';

export interface CrowdEnemy {
  alive: boolean;
  def: { radius: number };
  root: { position: { x: number; y: number; z: number } };
}

export function separateCrowd(
  crowd: readonly CrowdEnemy[],
  hash: SpatialHash,
  sep: { x: number; z: number },
  relax = 0.6
): void {
  for (let iter = 0; iter < 2; iter++) {
    hash.clear();
    for (let i = 0; i < crowd.length; i++) {
      const a = crowd[i];
      if (a.alive) hash.insert(i, a.root.position.x, a.root.position.z);
    }
    const pairs = hash.pairs();
    for (let p = 0; p < pairs.length; p += 2) {
      const i = pairs[p];
      const j = pairs[p + 1];
      const a = crowd[i];
      const b = crowd[j];
      if (!a.alive || !b.alive) continue;
      if (Math.abs(a.root.position.y - b.root.position.y) > 1.4) continue;
      if (
        separationDelta(
          a.root.position.x,
          a.root.position.z,
          a.def.radius + 0.06,
          b.root.position.x,
          b.root.position.z,
          b.def.radius + 0.06,
          sep,
          ((i * 7 + j) * 2.399) % (Math.PI * 2),
          relax
        )
      ) {
        a.root.position.x += sep.x;
        a.root.position.z += sep.z;
        b.root.position.x -= sep.x;
        b.root.position.z -= sep.z;
      }
    }
  }
}
