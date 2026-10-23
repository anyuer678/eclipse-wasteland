/**
 * render/envMount — 开源环境素材（Kenney CC0 nature-kit）的随机落点与实例化。
 *
 * 只负责生成落点并调用注入的 addProps；素材加载是异步的，
 * 关卡切换后通过 ref.current !== group 丢弃过期回调。
 */
import * as THREE from 'three';
import { ENV_MODELS, ENV_TINT } from './envConfig';
import { nearSpawn } from './world';

export interface EnvPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
}

export interface EnvAssetLib {
  load(name: string, done: (src: THREE.Group) => void): void;
}

export interface EnvMountOptions {
  mapRoot: THREE.Group;
  mapId: string;
  assets: EnvAssetLib;
  addProps: (parent: THREE.Object3D, source: THREE.Object3D, placements: EnvPlacement[], tint: number) => void;
  /** 当前挂载目标；异步回调时若不是本组则丢弃 */
  ref: { current: THREE.Group | null };
}

/** 返回本次挂载的容器（该地图无环境配置时返回 null） */
export function mountEnvModels(o: EnvMountOptions): THREE.Group | null {
  const list = ENV_MODELS[o.mapId] ?? [];
  if (list.length === 0) return null;
  const group = new THREE.Group();
  o.ref.current = group;
  o.mapRoot.add(group);
  const hf = (o.mapRoot.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? ((): number => 0);
  const tint = ENV_TINT[o.mapId] ?? 0x5a6a4a;
  for (const spec of list) {
    o.assets.load(spec.name, (src) => {
      if (o.ref.current !== group) return;
      const placements: EnvPlacement[] = [];
      // 大件（树木/巨石）只放场地外圈，避免插进掩体与平台；小草丛可以留在场内
      const big = spec.scale[1] > 1.6;
      for (let i = 0; i < spec.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = big ? 18 + Math.random() * 26 : 4 + Math.random() * 20;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue; // 出生点附近留白，避免开局被灌木/石头糊脸
        if (big && Math.hypot(x, z) < 17) continue;
        placements.push({
          x,
          // 贴合地形高度（固定 y=0 会让坡地装饰浮空）
          y: hf(x, z) + spec.y,
          z,
          scale: (spec.scale[0] + Math.random() * (spec.scale[1] - spec.scale[0])) * (big ? 0.8 : 1),
          rotY: Math.random() * Math.PI * 2,
        });
      }
      // 实例化：每个模型只占 1 个 draw call（每株草一个 Group 会爆 draw call）
      o.addProps(group, src, placements, tint);
    });
  }
  return group;
}
