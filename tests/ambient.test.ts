import { describe, expect, it } from 'vitest';
import { createAmbientField, wrapAxis } from '../src/render/ambient';

describe('render/ambient', () => {
  it('wrapAxis 把越界值折回盒内', () => {
    expect(wrapAxis(0, 40)).toBe(0);
    expect(wrapAxis(19, 40)).toBe(19);
    expect(wrapAxis(21, 40)).toBe(-19);
    expect(wrapAxis(-21, 40)).toBe(19);
    expect(wrapAxis(61, 40)).toBe(-19);
    expect(wrapAxis(-61, 40)).toBe(19);
  });

  it('未知地图返回 null，已知地图返回粒子场', () => {
    expect(createAmbientField('nowhere')).toBeNull();
    for (const id of ['facility', 'quarry', 'lab', 'volcano', 'ice', 'canyon']) {
      const f = createAmbientField(id);
      expect(f).not.toBeNull();
      f!.dispose();
    }
  });

  it('update 后粒子始终回绕到相机盒内', () => {
    const f = createAmbientField('ice')!;
    f.update(2.5, 100, 2, -50);
    const arr = f.points.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      expect(Math.abs(arr[i] - 100)).toBeLessThanOrEqual(20.01);
      expect(Math.abs(arr[i + 1] - 2)).toBeLessThanOrEqual(7.01);
      expect(Math.abs(arr[i + 2] + 50)).toBeLessThanOrEqual(20.01);
    }
    f.dispose();
  });

  it('fall 行为整体向下漂移（雪）', () => {
    const f = createAmbientField('ice')!;
    const arr = f.points.geometry.attributes.position.array as Float32Array;
    const before = arr.slice();
    f.update(0.5, 0, 0, 0);
    let down = 0;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] < before[i + 1]) down++;
    }
    expect(down).toBeGreaterThan((arr.length / 3) * 0.8);
    f.dispose();
  });

  it('rise 行为整体向上漂移（火星）', () => {
    const f = createAmbientField('volcano')!;
    const arr = f.points.geometry.attributes.position.array as Float32Array;
    const before = arr.slice();
    f.update(0.5, 0, 0, 0);
    let up = 0;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] > before[i + 1]) up++;
    }
    expect(up).toBeGreaterThan((arr.length / 3) * 0.8);
    f.dispose();
  });
});
