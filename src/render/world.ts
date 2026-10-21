/**
 * render/world — 渲染上下文：Renderer / Scene / Camera + 场景构建。
 *
 * 性能原则（本项目第二轮优化）：
 *   1. 静态几何全部按材质合并（1 材质 = 1 draw call），环境装饰走 InstancedMesh；
 *   2. 纹理全局复用（地形细节 / 太阳光晕只生成一次），不是每关重新 canvas 绘制；
 *   3. 只有一个投影阴影光源 + 一个补光，取消所有 PointLight（前向渲染逐片元成本高）；
 *   4. 像素比自适应：先按设备 DPR（上限 1.5）渲染，掉帧自动降采样。
 *
 * 画质原则：
 *   - 地形：顶点位移 + 坡度/高度顶点色 + 细节贴图（bump），边缘隆起成环形山挡住天际线；
 *   - 天空：烘焙等距柱状贴图（渐变 + 云层 + 地平雾霭）+ 对齐光照方向的太阳光晕；
 *   - 光照：半球光 + 暖色主光（带阴影）+ 冷色补光，形成可读的明暗层次。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { solid } from './materials';

/** 简单种子随机（地图布局用，保证同关卡布局一致） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 全局共享纹理缓存：同一份纹理只画一次、上传一次显存 */
const texCache = new Map<string, THREE.Texture>();

function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const tex = make();
  tex.userData.shared = true;
  texCache.set(key, tex);
  return tex;
}

/** 地形细节贴图：灰度噪声 + 碎石 + 草茎（颜色由顶点色决定，贴图只管明暗细节） */
function terrainDetailTexture(): THREE.Texture {
  return cachedTex('terrain-detail', () => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(0, 0, size, size);
    const rnd = mulberry32(20260820);
    // 大尺度斑块（明暗起伏）
    for (let i = 0; i < 90; i++) {
      const r = 18 + rnd() * 70;
      const g = ctx.createRadialGradient(rnd() * size, rnd() * size, 0, rnd() * size, rnd() * size, r);
      const v = Math.floor(120 + rnd() * 110);
      g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    // 碎石点
    for (let i = 0; i < 2200; i++) {
      const v = Math.floor(70 + rnd() * 150);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.2 + rnd() * 0.55})`;
      const s = 1 + rnd() * 3.4;
      ctx.fillRect(rnd() * size, rnd() * size, s, s);
    }
    // 草茎短划
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(150 + rnd() * 90);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.3})`;
      ctx.lineWidth = 1;
      const x = rnd() * size;
      const y = rnd() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 5, y - 3 - rnd() * 6);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    tex.anisotropy = 4;
    return tex;
  });
}

/** 建筑/道具通用细节贴图：4×4 分块面板 + 铆钉 + 污渍（灰度，颜色由材质 tint 决定） */
function propTexture(): THREE.Texture {
  return cachedTex('prop-detail', () => {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const rnd = mulberry32(20260901);
    ctx.fillStyle = '#cfcfcf';
    ctx.fillRect(0, 0, size, size);
    // 污渍/锈斑
    for (let i = 0; i < 70; i++) {
      const v = Math.floor(90 + rnd() * 90);
      const g = ctx.createRadialGradient(rnd() * size, rnd() * size, 0, rnd() * size, rnd() * size, 20 + rnd() * 70);
      g.addColorStop(0, `rgba(${v},${v},${v},${0.10 + rnd() * 0.18})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    // 面板分缝
    const step = size / 4;
    ctx.strokeStyle = 'rgba(60,60,60,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
    // 每块面板内部高光/暗边（伪造厚度）
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        ctx.strokeRect(gx * step + 5, gy * step + 5, step - 10, step - 10);
      }
    }
    // 铆钉
    ctx.fillStyle = 'rgba(40,40,40,0.5)';
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        for (const [ox, oy] of [[12, 12], [step - 12, 12], [12, step - 12], [step - 12, step - 12]] as const) {
          ctx.beginPath();
          ctx.arc(gx * step + ox, gy * step + oy, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // 细颗粒
    for (let i = 0; i < 2600; i++) {
      const v = Math.floor(150 + rnd() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v},${0.08 + rnd() * 0.2})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  });
}

/** 太阳光晕贴图（径向渐变，加法混合） */
function glowTexture(): THREE.Texture {
  return cachedTex('sun-glow', () => {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,246,214,0.55)');
    g.addColorStop(0.55, 'rgba(255,226,170,0.16)');
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  });
}

/** 天空贴图：等距柱状（上天下地），含渐变 + 云层 + 地平雾霭 */
function skyTexture(pal: Palette): THREE.Texture {
  const key = `sky-${pal.skyTop}-${pal.skyHorizon}-${pal.fog}`;
  return cachedTex(key, () => {
    const w = 1024;
    const h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
    // 垂直渐变：天顶 → 地平 → 地面（地图外圈用雾色收口）
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, hex(pal.skyTop));
    grad.addColorStop(0.36, hex(mixHex(pal.skyTop, pal.skyHorizon, 0.62)));
    grad.addColorStop(0.5, hex(pal.fog));
    grad.addColorStop(0.62, hex(mixHex(pal.fog, pal.ground, 0.55)));
    grad.addColorStop(1, hex(pal.ground));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 云层（只在上半天空）：多层柔边椭圆
    const rnd = mulberry32(pal.skyTop + pal.fog);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 46; i++) {
      const cx = rnd() * w;
      const cy = 20 + rnd() * (h * 0.36);
      const rx = 40 + rnd() * 130;
      const ry = 8 + rnd() * 26;
      const a = 0.05 + rnd() * 0.16;
      const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g2.addColorStop(0, `rgba(255,255,255,${a})`);
      g2.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 地平雾霭（压暗地面方向，视觉上把远景收进雾里）
    const haze = ctx.createLinearGradient(0, h * 0.44, 0, h * 0.56);
    haze.addColorStop(0, 'rgba(255,255,255,0)');
    haze.addColorStop(0.5, `rgba(255,255,255,${pal.haze})`);
    haze.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.4, w, h * 0.2);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

interface Palette {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  sun: number;
  ground: number;
  groundDark: number;
  rock: number;
  accent: number;
  /** 太阳方位角 / 高度角（弧度） */
  sunAz: number;
  sunEl: number;
  /** 地平雾霭强度 */
  haze: number;
}

const PALETTES: Record<string, Palette> = {
  facility: {
    skyTop: 0x2f6ea8, skyHorizon: 0xbcd2e0, fog: 0xc3d6e2, sun: 0xfff0cf,
    ground: 0x53702f, groundDark: 0x33471f, rock: 0x7a7263, accent: 0x7fd44a,
    sunAz: 0.8, sunEl: 0.62, haze: 0.35,
  },
  quarry: {
    skyTop: 0x3b7ab0, skyHorizon: 0xd6c9a4, fog: 0xd2cdad, sun: 0xffe6b4,
    ground: 0x7a6438, groundDark: 0x4d3f24, rock: 0x8a7d63, accent: 0xffb04a,
    sunAz: 1.7, sunEl: 0.55, haze: 0.4,
  },
  lab: {
    skyTop: 0x2b5f7a, skyHorizon: 0xa8c8c4, fog: 0xb0cfc9, sun: 0xe8fff4,
    ground: 0x3f6a4a, groundDark: 0x27412d, rock: 0x5f6b62, accent: 0x46d69a,
    sunAz: 2.6, sunEl: 0.6, haze: 0.42,
  },
  volcano: {
    skyTop: 0x1b0d12, skyHorizon: 0x5a2418, fog: 0x40201a, sun: 0xff7a3a,
    ground: 0x2a1d18, groundDark: 0x150d0a, rock: 0x3b2a22, accent: 0xff4a12,
    sunAz: 0.3, sunEl: 0.32, haze: 0.5,
  },
  ice: {
    skyTop: 0x557fae, skyHorizon: 0xd2e4f6, fog: 0xcfe0f0, sun: 0xfffff4,
    ground: 0x93aec4, groundDark: 0x6b849a, rock: 0x8a9bab, accent: 0x62c8ff,
    sunAz: 3.5, sunEl: 0.4, haze: 0.55,
  },
};

/** 把一批几何按材质合并成极少的 draw call */
class Merger {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4): void {
    // 统一成非索引几何（不同图元索引状态不一致会导致 merge 失败）
    let g: THREE.BufferGeometry;
    if (geo.index) {
      g = geo.toNonIndexed();
      geo.dispose();
    } else {
      g = geo;
    }
    g.applyMatrix4(matrix);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
  }

  /** 轴对齐盒（可绕 Y 旋转） */
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rotY = 0): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, rotY),
      new THREE.Vector3(1, 1, 1)
    );
    this.add(new THREE.BoxGeometry(w, h, d), mat, m);
  }

  /** 圆柱（可绕 X / Z 旋转，用于管道、立柱） */
  cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, mat: THREE.Material, rotX = 0, rotZ = 0): void {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, m);
  }

  /** 任意几何 + 位移/旋转/缩放 */
  shape(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, scale = 1): void {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
    this.add(geo, mat, m);
  }

  build(parent: THREE.Object3D, cast = true, receive = true): void {
    for (const [mat, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
    this.buckets.clear();
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** 出生点（游戏内 player.position 初始值）。装饰物要避开这里，保证开局视野干净 */
export const SPAWN_POINT = { x: 0, z: 6 };
const SPAWN_CLEAR = 5.5;

/** 是否落在出生点清空区内 */
export function nearSpawn(x: number, z: number, radius = SPAWN_CLEAR): boolean {
  const dx = x - SPAWN_POINT.x;
  const dz = z - SPAWN_POINT.z;
  return dx * dx + dz * dz < radius * radius;
}

export interface WorldOptions {
  mount: HTMLElement;
  fov?: number;
  near?: number;
  far?: number;
  background?: number;
  fogNear?: number;
  fogFar?: number;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly mount: HTMLElement;
  /** 阴影主光（跟随玩家移动，保证阴影贴图分辨率集中在战斗区） */
  private sun: THREE.DirectionalLight | null = null;
  private fill: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private sunGlow: THREE.Sprite | null = null;
  private readonly shadowTarget = new THREE.Object3D();
  /** 画质档位：high=阴影+地形凹凸+太阳光晕 / medium=阴影+光晕 / low=纯平光 */
  quality: 'low' | 'medium' | 'high' = 'medium';
  /** 是否允许根据帧时自动升降档（手动 setQuality 后关闭） */
  autoQuality = true;
  /** 自适应像素比状态 */
  private maxDpr = 1.5;
  private frameAccum = 0;
  private frameCount = 0;
  private lastFrameStamp = 0;

  constructor(opts: WorldOptions) {
    this.mount = opts.mount;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(Math.min(this.maxDpr, 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.background ?? 0x8fb4d0);
    this.scene.fog = new THREE.Fog(opts.background ?? 0x8fb4d0, opts.fogNear ?? 30, opts.fogFar ?? 120);

    this.camera = new THREE.PerspectiveCamera(
      opts.fov ?? 60,
      window.innerWidth / window.innerHeight,
      opts.near ?? 0.1,
      opts.far ?? 220
    );

    // 基础光照（buildMap 会按地图重调色）
    const hemi = new THREE.HemisphereLight(0xbcd8f0, 0x40402e, 1.15);
    this.scene.add(hemi);
    this.hemi = hemi;
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.5);
    sun.position.set(18, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 110;
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(this.shadowTarget);
    sun.target = this.shadowTarget;
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0x9fb8d8, 0.5);
    fill.position.set(-16, 10, -14);
    this.scene.add(fill);
    this.fill = fill;

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  add(obj: THREE.Object3D): void {
    this.scene.add(obj);
  }

  remove(obj: THREE.Object3D): void {
    this.scene.remove(obj);
  }

  /** 阴影跟随焦点（战斗时传玩家位置，让 26m 阴影框始终罩住战斗区） */
  focusShadow(x: number, y: number, z: number): void {
    if (!this.sun) return;
    this.shadowTarget.position.set(x, y, z);
    this.shadowTarget.updateMatrixWorld();
    const d = this.sun.position;
    d.set(x + 18, y + 26, z + 12);
  }

  render(): void {
    this.autoTune();
    this.renderer.render(this.scene, this.camera);
  }

  /** 画质分档：手动设置后关闭自动升降档（供设置项与压测使用） */
  setQuality(level: 'low' | 'medium' | 'high', auto = false): void {
    this.quality = level;
    this.autoQuality = auto;
    this.renderer.shadowMap.enabled = level !== 'low';
    if (this.groundMat) {
      this.groundMat.bumpMap = level === 'high' ? terrainDetailTexture() : null;
      this.groundMat.needsUpdate = true;
    }
    if (this.sunGlow) this.sunGlow.visible = level !== 'low';
    if (this.fill) this.fill.visible = level !== 'low';
    if (this.hemi) this.hemi.intensity = level === 'low' ? 1.45 : 1.15;
    // 阴影开关切换后需要重建程序
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
    });
  }

  /**
   * 自适应：连续掉帧先降画质档，再降像素比；余量充足时回填。
   * 每 90 帧评估一次，避免抖动。
   */
  private autoTune(): void {
    const now = performance.now();
    if (this.lastFrameStamp === 0) {
      this.lastFrameStamp = now;
      return;
    }
    const dt = now - this.lastFrameStamp;
    this.lastFrameStamp = now;
    if (dt <= 0 || dt > 500) return; // 切标签页/断点后不采样
    this.frameAccum += dt;
    this.frameCount += 1;
    if (this.frameCount < 90) return;
    const avg = this.frameAccum / this.frameCount;
    this.frameAccum = 0;
    this.frameCount = 0;
    const dpr = this.renderer.getPixelRatio();
    if (avg > 20) {
      // 优先降画质（省逐像素成本），其次降分辨率
      if (this.autoQuality && this.quality === 'high') this.setQuality('medium', true);
      else if (this.autoQuality && this.quality === 'medium') this.setQuality('low', true);
      else if (dpr > 0.7) {
        this.renderer.setPixelRatio(Math.max(0.7, dpr * 0.87));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    } else if (avg < 10.5) {
      if (this.autoQuality && this.quality === 'low') this.setQuality('medium', true);
      else if (this.autoQuality && this.quality === 'medium') this.setQuality('high', true);
      else if (dpr < this.maxDpr) {
        this.renderer.setPixelRatio(Math.min(this.maxDpr, dpr * 1.06));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }
  }

  /** 释放地图自建资源（共享纹理/全局材质跳过） */
  static disposeMap(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (o as THREE.Sprite).isSprite) {
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) {
          if (mm.userData.shared) continue;
          for (const key of ['map', 'bumpMap', 'normalMap', 'emissiveMap'] as const) {
            const tex = (mm as unknown as Record<string, THREE.Texture | null>)[key];
            if (tex && !tex.userData.shared) tex.dispose();
          }
          mm.dispose();
        }
      }
    });
  }

  /** 竞技场地面（调试/兼容保留）：贴合地形的圆盘 + 边界警示环 */
  addArena(radius = 22): THREE.Group {
    const g = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshStandardMaterial({ color: 0x24292f, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.2, radius - 0.05, 64),
      new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    this.add(g);
    return g;
  }

  /**
   * 关卡地图：地形 + 天空 + 光照 + 障碍布局。
   * 返回障碍物根节点（切换关卡时移除）；平台/斜坡/箱/毒池数据挂在 userData。
   */
  buildMap(mapId: 'facility' | 'quarry' | 'lab' | 'volcano' | 'ice'): THREE.Group {
    const root = new THREE.Group();
    const rng = mulberry32(mapId.length * 1337 + mapId.charCodeAt(0));
    const pal = PALETTES[mapId] ?? PALETTES.facility;
    const platforms: { x: number; z: number; w: number; d: number; h: number }[] = [];
    const ramps: { x: number; z: number; w: number; d: number; h0: number; h1: number; along: 'x' | 'z' }[] = [];
    const crates: { x: number; z: number }[] = [];
    const pools: { x: number; z: number; r: number }[] = [];

    // ---------- 天空 & 雾 ----------
    this.scene.background = new THREE.Color(pal.fog);
    this.scene.fog = new THREE.Fog(pal.fog, 34, 118);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture(pal),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 20), skyMat);
    sky.matrixAutoUpdate = false;
    sky.updateMatrix();
    root.add(sky);

    // ---------- 太阳光晕（与主光方向一致） ----------
    const sunDir = new THREE.Vector3(
      Math.cos(pal.sunEl) * Math.cos(pal.sunAz),
      Math.sin(pal.sunEl),
      Math.cos(pal.sunEl) * Math.sin(pal.sunAz)
    ).normalize();
    const sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: pal.sun,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
        opacity: 0.34,
      })
    );
    sunGlow.position.copy(sunDir).multiplyScalar(120);
    sunGlow.scale.setScalar(mapId === 'volcano' ? 15 : 21);
    sunGlow.renderOrder = -1;
    sunGlow.visible = this.quality !== 'low';
    root.add(sunGlow);
    this.sunGlow = sunGlow;
    if (this.sun) {
      this.sun.color.setHex(pal.sun);
      this.sun.intensity = mapId === 'volcano' ? 2.1 : 2.5;
      this.sun.position.copy(sunDir).multiplyScalar(46);
      this.sun.shadow.intensity = mapId === 'volcano' ? 0.75 : 1;
    }
    if (this.fill) {
      this.fill.color.setHex(mixHex(pal.fog, 0xffffff, 0.35));
      this.fill.intensity = 0.45 + pal.haze * 0.3;
    }
    if (this.hemi) {
      this.hemi.color.setHex(mixHex(pal.skyHorizon, 0xffffff, 0.35));
      this.hemi.groundColor.setHex(mixHex(pal.ground, 0x000000, 0.35));
      this.hemi.intensity = this.quality === 'low' ? 1.45 : mapId === 'volcano' ? 0.95 : 1.15;
    }

    // ---------- 高度场 ----------
    const heightfield = makeHeightfield(mapId.length * 977 + mapId.charCodeAt(0) * 31);
    root.userData.heightfield = heightfield;

    // ---------- 地形网格 ----------
    const SEG = 128;
    const SIZE = 176;
    const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightfield(pos.getX(i), pos.getZ(i)));
    }
    groundGeo.computeVertexNormals();
    // 顶点色：坡度分三段（草 → 泥土 → 岩石），叠加大尺度噪声打破色块
    const colors = new Float32Array(pos.count * 3);
    const nrm = groundGeo.attributes.normal as THREE.BufferAttribute;
    const cGrass = new THREE.Color(pal.ground);
    const cDirt = new THREE.Color(mixHex(pal.groundDark, pal.rock, 0.45));
    const cRock = new THREE.Color(pal.rock);
    const tmpC = new THREE.Color();
    const smooth01 = (t: number): number => {
      const k = Math.min(1, Math.max(0, t));
      return k * k * (3 - 2 * k);
    };
    for (let i = 0; i < pos.count; i++) {
      const slope = 1 - nrm.getY(i); // 0=平地 1=陡壁
      const hh = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // 低洼处偏暗土、陡坡偏岩石；两段都用 smoothstep 过渡避免出现硬边
      const dirtK = smooth01((slope - 0.06) / 0.20) * 0.7 + smooth01((1.1 - hh) / 1.6) * 0.22;
      // 陡坡 + 高处都露岩（荒原的坡面不该还是一整片草绿）
      const rockK = Math.min(1, smooth01((slope - 0.16) / 0.26) + smooth01((hh - 4) / 12) * 0.55);
      tmpC.copy(cGrass).lerp(cDirt, Math.min(1, dirtK)).lerp(cRock, rockK);
      // 大尺度色斑 + 细碎噪声（打散大面积同色）
      const macro = Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.19 - x * 0.07) * 0.05;
      const micro = (Math.sin(x * 1.7) * Math.cos(z * 1.5)) * 0.022;
      const n = macro + micro;
      colors[i * 3] = Math.max(0, tmpC.r + n);
      colors[i * 3 + 1] = Math.max(0, tmpC.g + n);
      colors[i * 3 + 2] = Math.max(0, tmpC.b + n);
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const detail = terrainDetailTexture();
    const groundMat = new THREE.MeshStandardMaterial({
      map: detail,
      bumpMap: this.quality === 'high' ? detail : null,
      bumpScale: 0.14,
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    root.add(ground);
    this.groundMat = groundMat;

    // ---------- 共享材质（每张图一套，切换关卡即释放） ----------
    const propTex = propTexture();
    const matStone = solid(pal.rock, { roughness: 0.92 });
    matStone.map = propTex;
    const matWood = solid(mixHex(pal.ground, 0x8a6a3a, 0.55), { roughness: 0.9 });
    matWood.map = propTex;
    const matMetal = solid(mixHex(pal.rock, 0x9aa0a8, 0.5), { roughness: 0.55, metalness: 0.45 });
    matMetal.map = propTex;
    const matDark = solid(mixHex(pal.groundDark, 0x000000, 0.25), { roughness: 0.95 });
    matDark.map = propTex;
    const glowMat = new THREE.MeshBasicMaterial({ color: pal.accent, fog: false });
    const matTop = solid(mixHex(pal.rock, 0xffffff, 0.22), { roughness: 0.88 });
    matTop.map = propTex;

    const bag = new Merger();

    // ---------- 碰撞体（玩家/敌人共用，杜绝穿模） ----------
    const obstacles: { x: number; z: number; hw: number; hd: number; top: number }[] = [];
    const addObstacle = (x: number, z: number, w: number, d: number, top: number): void => {
      obstacles.push({ x, z, hw: w / 2, hd: d / 2, top });
    };

    // ---------- 布局辅助（写进合并桶，不产生独立 Mesh） ----------
    const addBox = (w: number, h: number, d: number, x: number, z: number, m: THREE.Material, rotY = 0): void => {
      const baseY = heightfield(x, z);
      bag.box(w, h, d, x, baseY + h / 2, z, m, rotY);
      // 矮墙/集装箱都参与碰撞（旋转过的按外接矩形近似）
      const c = Math.abs(Math.cos(rotY));
      const s = Math.abs(Math.sin(rotY));
      addObstacle(x, z, c * w + s * d, s * w + c * d, baseY + h);
    };
    const addPlatform = (x: number, z: number, w: number, d: number, h: number): void => {
      platforms.push({ x, z, w, d, h });
      const baseY = heightfield(x, z);
      // 埋入地下 0.9m，避免与起伏地形之间出现缝隙
      bag.box(w, h + 0.9, d, x, baseY + h / 2 - 0.45, z, matStone);
      // 顶部甲板（略内缩、略亮，读起来是"平台"而不是"洞"）
      bag.box(w - 0.12, 0.06, d - 0.12, x, baseY + h + 0.03, z, matTop);
      addObstacle(x, z, w, d, baseY + h + 0.06);
    };
    const addRamp = (x: number, z: number, w: number, d: number, h0: number, h1: number, along: 'x' | 'z'): void => {
      ramps.push({ x, z, w, d, h0, h1, along });
      const len = along === 'z' ? d : w;
      const wid = along === 'z' ? w : d;
      const ang = Math.atan2(Math.abs(h1 - h0), len);
      const baseY = heightfield(x, z);
      const mid = baseY + (h0 + h1) / 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, mid, z),
        new THREE.Quaternion().setFromEuler(
          along === 'z' ? new THREE.Euler(h1 > h0 ? -ang : ang, 0, 0) : new THREE.Euler(0, 0, h1 > h0 ? ang : -ang)
        ),
        new THREE.Vector3(1, 1, 1)
      );
      bag.add(new THREE.BoxGeometry(wid, 0.3, len), matStone, m);
    };
    /** 可破坏箱单独建 Mesh（击碎时要隐藏），共享几何与材质 */
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = solid(0x7a5f38, { roughness: 0.88 });
    crateMat.map = propTex;
    const crateGroup = new THREE.Group();
    const addCrate = (x: number, z: number): void => {
      crates.push({ x, z });
      const s = 0.72 + rng() * 0.26;
      const baseY = heightfield(x, z);
      const box = new THREE.Mesh(crateGeo, crateMat);
      box.scale.setScalar(s);
      box.position.set(x, baseY + s / 2, z);
      box.rotation.y = rng() * Math.PI;
      box.castShadow = true;
      box.receiveShadow = true;
      crateGroup.add(box);
    };
    const addPillar = (x: number, z: number, h = 2.8): void => {
      const baseY = heightfield(x, z);
      bag.cyl(0.16, 0.2, h, 8, x, baseY + h / 2, z, matMetal);
      bag.shape(new THREE.SphereGeometry(0.13, 8, 6), glowMat, x, baseY + h + 0.08, z);
    };

    // ---------- 各图布局 ----------
    if (mapId === 'facility') {
      // 十字掩体墙
      addBox(5.4, 1.15, 0.5, -7, 0, matStone);
      addBox(5.4, 1.15, 0.5, 7, 0, matStone);
      addBox(0.5, 1.15, 5.4, 0, -7, matStone);
      addBox(0.5, 1.15, 5.4, 0, 7, matStone);
      // 集装箱堆（避开出生点正前方视线）
      addBox(2.4, 1.6, 1.6, -3.6, -1.4, matMetal, 0.5);
      addBox(1.8, 1.3, 1.3, -10.5, 7, matMetal, 0.3);
      addBox(1.8, 1.3, 1.3, 11, -8, matMetal, -0.4);
      // 横置管道
      bag.cyl(0.24, 0.24, 6, 10, -11, heightfield(-11, -5) + 1.6, -5, matMetal, 0, Math.PI / 2);
      bag.cyl(0.19, 0.19, 5, 10, 10.5, heightfield(10.5, 7) + 1.2, 7, matMetal, 0, Math.PI / 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        addPillar(Math.cos(a) * 13, Math.sin(a) * 13);
      }
      addPlatform(-6, 6, 2.8, 2.4, 0.9);
      addPlatform(6, -6, 2.8, 2.4, 0.9);
      addPlatform(0, -9, 3.6, 2.8, 1.2);
      addRamp(-4.8, -9, 6, 2.8, 0, 1.2, 'x');
      addCrate(-8, 2); addCrate(8, 3); addCrate(-3, 9); addCrate(5, -8);
      // 废弃小屋
      for (const [hx, hz] of [[-12, -8], [12, 8], [-13, 7]] as const) {
        const baseY = heightfield(hx, hz);
        bag.box(3.2, 2.3, 2.8, hx, baseY + 1.15, hz, matWood, 0.2);
        bag.shape(new THREE.ConeGeometry(2.7, 1.4, 4), matDark, hx, baseY + 3.0, hz, 0, Math.PI / 4, 0);
        addObstacle(hx, hz, 3.4, 3.0, baseY + 2.3);
      }
      // 中央地面标识环（替代原来那根 4cm 的"绿棍子"光柱）
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 1.72, 40),
        new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.34, depthWrite: false })
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(0, heightfield(0, 0) + 0.04, 0);
      root.add(mark);
    } else if (mapId === 'quarry') {
      // 岩壁弧墙（合并成几段低多边形岩壁）
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * Math.PI * 2;
        const rad = 17 + rng() * 1.6;
        const h = 1.8 + rng() * 1.8;
        const bx = Math.cos(a0) * rad;
        const bz = Math.sin(a0) * rad;
        const baseY = heightfield(bx, bz);
        bag.shape(new THREE.DodecahedronGeometry(1.5 + rng() * 0.7, 0), matStone, bx, baseY + h * 0.45, bz, rng() * 3, rng() * 3, rng() * 3);
      }
      // 巨石群
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const d = 3.5 + rng() * 11;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue;
        const s = 0.9 + rng() * 1.3;
        bag.shape(new THREE.DodecahedronGeometry(s, 0), matStone, x, heightfield(x, z) + s * 0.55, z, rng() * 3, rng() * 3, rng() * 3);
      }
      // 矿堆 + 晶簇
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2;
        const d = 6 + rng() * 8;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue;
        bag.shape(new THREE.ConeGeometry(0.85, 0.7, 7), matStone, x, heightfield(x, z) + 0.3, z);
        bag.shape(new THREE.OctahedronGeometry(0.24, 0), glowMat, x, heightfield(x, z) + 0.8, z, 0, rng() * 3, 0);
      }
      addBox(3.6, 1.2, 3.6, 0, 0, matStone);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        addBox(2.6, 0.7, 2.6, Math.cos(a) * 10, Math.sin(a) * 10, matStone);
      }
      addPlatform(-8, 6, 2.6, 2.6, 1.0);
      addPlatform(8, -7, 2.6, 2.6, 1.0);
      addPlatform(0, -9, 3.2, 2.8, 1.3);
      addRamp(-4.8, -9, 6, 2.8, 0, 1.3, 'x');
      addPlatform(4, 8, 2.4, 2.4, 1.2);
      addCrate(-10, -4); addCrate(10, 4); addCrate(0, -10);
    } else {
      // 实验室 / 火山 / 冰原 共用骨架：网格矮墙 + 设备柜 + 中央舱体
      for (let i = -1; i <= 1; i++) {
        addBox(0.55, 1.2, 15, i * 7, 0, matMetal);
        addBox(15, 0.6, 0.55, 0, i * 7, matMetal);
      }
      for (let i = 0; i < 6; i++) {
        const x = (rng() - 0.5) * 18;
        const z = (rng() - 0.5) * 18;
        if (nearSpawn(x, z, 4)) continue;
        // 西侧高台斜坡走廊与平台顶面禁放随机设备柜：否则会堵死小怪上坡的唯一入口
        if (x > -8.6 && x < -1.0 && z > -11 && z < -7.2) continue;
        if (Math.abs(x) < 2.1 && Math.abs(z + 9) < 1.8) continue;
        addBox(0.95, 0.85, 0.95, x, z, matWood);
        bag.shape(new THREE.SphereGeometry(0.07, 6, 5), glowMat, x, heightfield(x, z) + 0.98, z);
      }
      // 中央培养舱：底座 + 金属环 + 玻璃柱 + 顶部封盖 + 内部核心
      const podBase = heightfield(0, 0);
      bag.cyl(1.12, 1.2, 0.28, 16, 0, podBase + 0.14, 0, matStone);
      bag.cyl(0.86, 0.92, 0.22, 16, 0, podBase + 0.36, 0, matMetal);
      bag.cyl(0.7, 0.7, 2.0, 16, 0, podBase + 1.46, 0, matMetal);
      bag.cyl(0.72, 0.72, 0.12, 16, 0, podBase + 1.3, 0, matDark);
      bag.cyl(0.72, 0.72, 0.12, 16, 0, podBase + 2.0, 0, matDark);
      bag.cyl(0.86, 0.78, 0.24, 16, 0, podBase + 2.56, 0, matMetal);
      bag.shape(new THREE.SphereGeometry(0.42, 12, 10), glowMat, 0, podBase + 1.62, 0);
      addObstacle(0, 0, 2.2, 2.2, podBase + 2.7);

      addPlatform(-7, -6, 2.4, 2.4, 0.9);
      addPlatform(7, -6, 2.4, 2.4, 0.9);
      addPlatform(0, -9, 3.4, 2.6, 1.2);
      addRamp(-4.8, -9, 6, 2.8, 0, 1.2, 'x');
      addCrate(-8, 4); addCrate(8, -4); addCrate(0, -9); addCrate(9, 6);
    }

    // ---------- 地图专属装饰 ----------
    if (mapId === 'volcano') {
      const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5410, fog: true });
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const d = 3 + rng() * 11;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, heightfield(x, z) + 0.03, z),
          new THREE.Quaternion().setFromAxisAngle(UP, a),
          new THREE.Vector3(1, 1, 1)
        );
        bag.add(new THREE.BoxGeometry(0.18 + rng() * 0.25, 0.03, 2 + rng() * 3.5), lavaMat, m);
      }
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        const d = 6 + rng() * 9;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue;
        const h = 1.6 + rng() * 2.2;
        bag.cyl(0.26, 0.55, h, 7, x, heightfield(x, z) + h / 2, z, matDark);
      }
    }
    if (mapId === 'ice') {
      const iceMat = solid(0xa8d4f0, { roughness: 0.15, metalness: 0.25 });
      iceMat.emissive = new THREE.Color(0x1d3f66);
      iceMat.emissiveIntensity = 0.35;
      for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2;
        const d = 4 + rng() * 11;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue;
        const h = 1.6 + rng() * 3.2;
        bag.shape(new THREE.ConeGeometry(0.3, h, 5), iceMat, x, heightfield(x, z) + h / 2, z, (rng() - 0.5) * 0.3, rng() * 3, (rng() - 0.5) * 0.3);
      }
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2;
        const d = 3 + rng() * 12;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (nearSpawn(x, z)) continue;
        bag.shape(new THREE.SphereGeometry(0.6 + rng() * 0.5, 8, 6), matDark, x, heightfield(x, z) + 0.12, z, 0, 0, 0, 1);
      }
    }

    // ---------- 毒池 ----------
    const poolMat = new THREE.MeshBasicMaterial({ color: 0x3ea055, transparent: true, opacity: 0.55, depthWrite: false });
    const poolRim = new THREE.MeshBasicMaterial({ color: 0x8ef08e, transparent: true, opacity: 0.5, depthWrite: false });
    const poolGeo = new THREE.CircleGeometry(1, 28);
    poolGeo.rotateX(-Math.PI / 2);
    const rimGeo = new THREE.RingGeometry(0.94, 1, 28);
    rimGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const d = 10 + rng() * 8;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      const pr = 2 + rng() * 1.2;
      pools.push({ x: px, z: pz, r: pr });
      const py = heightfield(px, pz) + 0.04;
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.position.set(px, py, pz);
      pool.scale.setScalar(pr);
      root.add(pool);
      const rim = new THREE.Mesh(rimGeo, poolRim);
      rim.position.set(px, py + 0.01, pz);
      rim.scale.setScalar(pr);
      root.add(rim);
    }

    // ---------- 落地：合并桶一次性产出（通常 4~8 个 draw call） ----------
    bag.build(root, true, true);
    root.add(crateGroup);

    root.userData.obstacles = obstacles;
    root.userData.platforms = platforms;
    root.userData.ramps = ramps;
    root.userData.crates = crates;
    root.userData.poisonPools = pools;
    root.userData.crateGroup = crateGroup;

    this.add(root);
    return root;
  }

  /**
   * 环境装饰实例化：把一个 GLB 源模型的所有 Mesh 转成 InstancedMesh。
   * 旧实现每个实例 clone 一整棵 Group，几十个物件就是上百 draw call；
   * 这里每个 Mesh 只占 1 个 draw call（同一模型通常 1~3 个 Mesh）。
   */
  addInstancedProps(
    parent: THREE.Object3D,
    source: THREE.Object3D,
    placements: { x: number; y: number; z: number; scale: number; rotY: number }[],
    tint?: number
  ): void {
    if (placements.length === 0) return;
    source.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    source.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    // 模型原点未必在底部：取包围盒最低点做落地偏移，否则装饰会悬空
    const srcBox = new THREE.Box3().setFromObject(source);
    const baseMinY = Number.isFinite(srcBox.min.y) ? srcBox.min.y : 0;
    // 开源素材配色偏艳：按地图调色板往灰绿方向压一档，避免"荧光树"
    const tintColor = tint === undefined ? null : new THREE.Color(tint);
    for (const mesh of meshes) {
      let mat = mesh.material as THREE.Material;
      if (tintColor) {
        const src = mat as THREE.MeshStandardMaterial;
        const cloned = src.clone();
        if (cloned.color) cloned.color.lerp(tintColor, 0.78);
        cloned.roughness = 1;
        cloned.metalness = 0;
        mat = cloned;
      }
      const inst = new THREE.InstancedMesh(mesh.geometry, mat, placements.length);
      const local = new THREE.Matrix4().copy(mesh.matrixWorld);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        q.setFromAxisAngle(UP, p.rotY);
        m.compose(new THREE.Vector3(p.x, p.y - baseMinY * p.scale, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
        m.multiply(local);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.userData.envProp = true;
      parent.add(inst);
    }
  }
}

/**
 * 自然地形高度场（三层结构）：
 *   1) 场内沙丘：±0.6m 缓慢起伏，让战斗区不再是一块白板；
 *   2) 中景丘陵：r 14~36 的缓坡丘陵（2~6m），形成层次；
 *   3) 外圈山脊：r 36~64 抬升 10~26m，山脊线随方位角起伏（不是一圈等高的墙）。
 * 出生点与主斜坡（z≈-7）附近额外压平，保证走位与掩体贴合。
 */
function makeHeightfield(seed: number): (x: number, z: number) => number {
  const rnd = mulberry32(seed);
  const dunes = { f1: 0.21 + rnd() * 0.08, f2: 0.13 + rnd() * 0.05, p: rnd() * Math.PI * 2 };
  // 中景丘陵：分布在场地外圈，避免压住竞技场
  const hills = Array.from({ length: 10 }, () => {
    const a = rnd() * Math.PI * 2;
    const d = 16 + rnd() * 20;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, r: 7 + rnd() * 8, h: 1.6 + rnd() * 4.2 };
  });
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const smooth = (a: number, b: number, t: number): number => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  return (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    // 1) 场内沙丘（范围内 100%，r>16 淡出）
    const arenaMask = 1 - smooth(10, 17, r);
    const dune =
      (Math.sin(x * dunes.f1 + dunes.p) * Math.cos(z * dunes.f2) * 0.44 +
        Math.sin((x + z) * 0.095 + dunes.p) * 0.2 +
        Math.sin(x * 0.47) * Math.cos(z * 0.41) * 0.07) *
      arenaMask;
    let h = dune;
    // 2) 中景丘陵
    for (const hill of hills) {
      const dx = x - hill.x;
      const dz = z - hill.z;
      const d2 = dx * dx + dz * dz;
      const r2 = hill.r * hill.r;
      if (d2 < r2) h += hill.h * (1 - Math.sqrt(d2) / hill.r) * 0.9;
    }
    // 2.5) 侵蚀细节：只在场地外叠加（场内保持可走，不破坏掩体贴合）
    const rough = smooth(13, 26, r);
    h += (Math.sin(x * 0.87 + z * 0.61) * Math.cos(x * 0.53 - z * 0.79) * 0.42 +
      Math.sin(x * 1.9 - z * 1.5) * 0.12) * rough;
    // 3) 外圈山脊：山脊线随方位角起伏 + 内外侧都平滑收口
    const ang = Math.atan2(z, x);
    const ridge = 9 + 6 * Math.sin(ang * 2.7 + p1) + 4.5 * Math.sin(ang * 5.3 + p2) + 2.5 * Math.sin(ang * 11 + p1 * 2);
    const rise = smooth(34, 50, r);
    const fall = 1 - smooth(62, 82, r);
    h += Math.max(0, ridge) * rise * fall;
    // 出生点 + 高台斜坡走廊压平（避免掩体/斜坡与地面出现缝隙）。
    // 斜坡在高台西侧（x≈-4.8, z≈-9），不能放在十字掩体墙上。
    const spawnFlat = Math.exp(-(x * x + (z - 6) * (z - 6)) / 34);
    const rampFlat = Math.exp(-(((x + 4.8) / 4.0) ** 2 + ((z + 9) / 1.8) ** 2));
    h *= 1 - 0.85 * Math.max(spawnFlat, rampFlat);
    return Math.max(0, h);
  };
}
