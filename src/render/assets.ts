/**
 * render/assets — 开源模型加载器。
 *
 * 从 public/models 加载 CC0/开源 GLB 模型（Three.js 官方示例），
 * 缓存克隆供敌人/BOSS 复用；加载失败时调用方回退程序化模型。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtilsModule from 'three/examples/jsm/utils/SkeletonUtils.js';
const SkeletonUtils = (SkeletonUtilsModule as { SkeletonUtils?: typeof import('three/examples/jsm/utils/SkeletonUtils.js') }).SkeletonUtils ?? SkeletonUtilsModule;

export interface AssetLib {
  /** 获取模型克隆；未加载完成返回 null */
  get: (name: string) => THREE.Group | null;
  /** 加载指定模型，完成回调 */
  load: (name: string, onDone?: (group: THREE.Group) => void) => void;
}

export function createAssetLib(base = '/models/'): AssetLib {
  const loader = new GLTFLoader();
  const cache: Record<string, THREE.Group> = {};
  const pending = new Map<string, ((g: THREE.Group) => void)[]>();

  const get = (name: string): THREE.Group | null => {
    const src = cache[name];
    if (!src) return null;
    // SkeletonUtils.clone 正确处理 SkinnedMesh（骨骼绑定），避免残损/不可见
    const clone = SkeletonUtils.clone(src) as THREE.Group;
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material;
        if (Array.isArray(m)) {
          (o as THREE.Mesh).material = m.map((x) => x.clone());
        } else if (m) {
          (o as THREE.Mesh).material = (m as THREE.Material).clone();
        }
      }
    });
    return clone;
  };

  const load = (name: string, onDone?: (group: THREE.Group) => void): void => {
    if (cache[name]) {
      onDone?.(cache[name]);
      return;
    }
    if (onDone) {
      let list = pending.get(name);
      if (!list) {
        list = [];
        pending.set(name, list);
      }
      list.push(onDone);
    }
    loader.load(
      base + name + '.glb',
      (gltf) => {
        cache[name] = gltf.scene;
        const list = pending.get(name);
        pending.delete(name);
        if (list) for (const cb of list) cb(gltf.scene);
      },
      undefined,
      () => {
        pending.delete(name);
      }
    );
  };

  return { get, load };
}
