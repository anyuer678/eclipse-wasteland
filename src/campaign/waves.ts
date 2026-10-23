/**
 * campaign/waves — 波次配表的运行时缩放（纯函数）。
 *
 * 战场从半径 38.5 扩到 52 后，刷怪环最远到 26m，接敌距离变长；
 * 按面积补偿波次人数，同时给单波人数设上限，避免同屏过密。
 */
import type { WaveSpec } from './types';

export const WAVE_DENSITY_SCALE = 1.3;
export const WAVE_ALIVE_CAP = 46;

export function scaleWaveSpec(spec: WaveSpec, k = WAVE_DENSITY_SCALE, cap = WAVE_ALIVE_CAP): WaveSpec {
  if (!Number.isFinite(k) || k <= 1) return { ...spec };
  const n = (v?: number): number => Math.min(cap, Math.round((v ?? 0) * k));
  return {
    chasers: n(spec.chasers),
    boomers: n(spec.boomers),
    spitters: n(spec.spitters),
    guards: n(spec.guards),
    berserkers: n(spec.berserkers),
    casters: n(spec.casters),
  };
}
