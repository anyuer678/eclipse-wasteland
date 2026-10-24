import { describe, expect, it } from 'vitest';
import {
  BARREL_BASE_DMG,
  BARREL_CHAIN_DELAY,
  BARREL_HP,
  BARREL_PLAYER_DMG,
  BARREL_RADIUS,
  barrelFalloff,
  collectChainBarrels,
} from '../src/play/barrels';

describe('play/barrels', () => {
  it('衰减：爆心全额、边缘 0.35、圈外为 0.35（调用方先裁剪半径）', () => {
    expect(barrelFalloff(0)).toBe(1);
    expect(barrelFalloff(BARREL_RADIUS / 2)).toBeCloseTo(0.675, 3);
    expect(barrelFalloff(BARREL_RADIUS)).toBeCloseTo(0.35, 3);
    expect(barrelFalloff(-3)).toBe(1);
    expect(barrelFalloff(BARREL_RADIUS * 2)).toBeCloseTo(0.35, 3);
  });

  it('链式候选：只收半径内且存活的桶，排除已爆的引爆桶', () => {
    const barrels = [
      { x: 0, z: 0, alive: false },
      { x: 3, z: 0, alive: true },
      { x: BARREL_RADIUS + 0.1, z: 0, alive: true },
      { x: 0, z: -4, alive: true },
    ];
    const chain = collectChainBarrels(barrels, 0, 0);
    expect(chain.map((b) => `${b.x},${b.z}`)).toEqual(['3,0', '0,-4']);
  });

  it('常量配置符合预期口径', () => {
    expect(BARREL_RADIUS).toBeGreaterThan(3);
    expect(BARREL_BASE_DMG).toBeGreaterThan(80);
    expect(BARREL_PLAYER_DMG).toBeLessThan(BARREL_BASE_DMG);
    expect(BARREL_HP).toBeLessThan(30);
    expect(BARREL_CHAIN_DELAY).toBeLessThan(0.5);
  });
});
