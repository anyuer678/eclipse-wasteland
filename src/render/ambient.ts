/**
 * render/ambient — 每张地图一层氛围粒子（单 Points draw call）。
 *
 * 粒子分布在一个跟随相机的立方体盒里，出界按轴回绕（wrap），移动时永远有粒子；
 * 冰原落雪 / 火山升腾火星 / 峡谷沙尘 / 其余尘屑缓漂，让每张图的"空气"不一样。
 */
import * as THREE from 'three';

type Behavior = 'fall' | 'rise' | 'drift';

interface Preset {
  color: number;
  count: number;
  size: number;
  opacity: number;
  behavior: Behavior;
  /** 风向（x, z） */
  wind: [number, number];
}

const PRESETS: Record<string, Preset> = {
  facility: { color: 0xd8e2ec, count: 130, size: 0.05, opacity: 0.42, behavior: 'drift', wind: [0.35, 0.12] },
  quarry: { color: 0xd9c9a2, count: 150, size: 0.06, opacity: 0.5, behavior: 'drift', wind: [0.5, 0.2] },
  lab: { color: 0xa8ecd8, count: 110, size: 0.05, opacity: 0.4, behavior: 'drift', wind: [0.15, 0.25] },
  volcano: { color: 0xff8a3a, count: 160, size: 0.075, opacity: 0.8, behavior: 'rise', wind: [0.2, 0.1] },
  ice: { color: 0xeef6ff, count: 200, size: 0.075, opacity: 0.9, behavior: 'fall', wind: [0.45, 0.15] },
  canyon: { color: 0xdcbc8e, count: 150, size: 0.065, opacity: 0.55, behavior: 'drift', wind: [0.7, 0.3] },
};

/** 粒子盒尺寸（相对相机中心） */
const SPAN_X = 40;
const SPAN_Y = 14;
const SPAN_Z = 40;

export interface AmbientField {
  points: THREE.Points;
  update(dt: number, camX: number, camY: number, camZ: number): void;
  dispose(): void;
}

/** 轴回绕：把 v 折回 [-span/2, span/2] */
export function wrapAxis(v: number, span: number): number {
  const half = span / 2;
  if (v > half) return v - span * Math.ceil((v - half) / span);
  if (v < -half) return v + span * Math.ceil((-v - half) / span);
  return v;
}

export function createAmbientField(mapId: string): AmbientField | null {
  const p = PRESETS[mapId];
  if (!p) return null;
  const n = p.count;
  const pos = new Float32Array(n * 3);
  const speed = new Float32Array(n);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * SPAN_X;
    pos[i * 3 + 1] = (Math.random() - 0.5) * SPAN_Y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * SPAN_Z;
    speed[i] = 0.6 + Math.random() * 0.9;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: p.color,
    size: p.size,
    transparent: true,
    opacity: p.opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let t = 0;
  return {
    points,
    update(dt, camX, camY, camZ) {
      t += dt;
      const arr = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const s = speed[i];
        if (p.behavior === 'fall') {
          arr[ix + 1] -= dt * (1.1 + s * 0.9);
          arr[ix] += dt * (p.wind[0] * s + Math.sin(t * 1.3 + phase[i]) * 0.3);
          arr[ix + 2] += dt * p.wind[1] * s;
        } else if (p.behavior === 'rise') {
          arr[ix + 1] += dt * (0.8 + s * 1.1);
          arr[ix] += dt * (Math.sin(t * 0.9 + phase[i]) * 0.35 + p.wind[0] * s * 0.4);
          arr[ix + 2] += dt * (Math.cos(t * 0.8 + phase[i]) * 0.35 + p.wind[1] * s * 0.4);
        } else {
          arr[ix] += dt * (p.wind[0] * s * 0.5 + Math.sin(t * 0.5 + phase[i]) * 0.12);
          arr[ix + 1] += dt * Math.sin(t * 0.7 + phase[i] * 2) * 0.1;
          arr[ix + 2] += dt * (p.wind[1] * s * 0.5 + Math.cos(t * 0.4 + phase[i]) * 0.12);
        }
        arr[ix] = camX + wrapAxis(arr[ix] - camX, SPAN_X);
        arr[ix + 1] = camY + wrapAxis(arr[ix + 1] - camY, SPAN_Y);
        arr[ix + 2] = camZ + wrapAxis(arr[ix + 2] - camZ, SPAN_Z);
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
