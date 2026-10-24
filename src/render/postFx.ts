/**
 * render/postFx — 轻量后处理（Bloom）。
 *
 * 提高弹道/命中/技能特效与高光的体积感；低画质档由调用方直接走 renderer.render，
 * 不承担额外 RT 成本。Bloom 只对超过阈值的亮部生效，避免整屏发灰。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostFxOptions {
  width: number;
  height: number;
  strength: number;
  radius?: number;
  threshold?: number;
}

export class PostFx {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private dpr = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: PostFxOptions) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(opts.width, opts.height),
      opts.strength,
      opts.radius ?? 0.5,
      opts.threshold ?? 1.1
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize(opts.width, opts.height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    // Bloom 用半分辨率：视觉几乎无损，但省掉 ~4x 的模糊采样成本
    this.bloom.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  setPixelRatio(dpr: number): void {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.composer.setPixelRatio(dpr);
  }

  setStrength(strength: number): void {
    this.bloom.strength = strength;
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
