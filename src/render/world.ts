/**
 * render/world — 渲染上下文：封装 Renderer / Scene / Camera 的创建与组织。
 *
 * 阶段 2 目标：把 Three.js 细节收敛到这一层，玩法系统只通过
 * World 接口与场景交互，不直接触碰 three 对象。
 */
import * as THREE from 'three';
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

/** 程序化地面纹理：分块金属板 + 网格线 + 污渍（无需外部素材） */
function makeFloorTexture(base: string, line: string, dark: string, gridSize = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);
  // 分块网格线
  ctx.strokeStyle = line;
  ctx.lineWidth = 5;
  for (let i = 0; i <= 1024; i += gridSize) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }
  // 板块内微亮（金属反射感）
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let gx = 0; gx < 1024; gx += gridSize) {
    for (let gy = 0; gy < 1024; gy += gridSize) {
      ctx.fillRect(gx + 8, gy + 8, gridSize - 16, gridSize - 16);
    }
  }
  // 污渍/锈迹
  const rnd = mulberry32(20260813);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.15})`;
    ctx.beginPath();
    ctx.arc(rnd() * 1024, rnd() * 1024, 6 + rnd() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  // 磨损细痕
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    const x = rnd() * 1024;
    const y = rnd() * 1024;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 80);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.anisotropy = 4;
  return tex;
}

/** 程序化草地纹理：草绿底 + 深浅斑点（刺激战场风） */
function makeGrassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#4a7a3a');
  grad.addColorStop(1, '#3d6a30');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(20260814);
  for (let i = 0; i < 400; i++) {
    const g = 40 + Math.floor(rnd() * 60);
    ctx.fillStyle = `rgba(${g + 30},${g + 50},${g + 10},${0.2 + rnd() * 0.3})`;
    ctx.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 4, 2 + rnd() * 6);
  }
  // 草叶细线
  ctx.strokeStyle = 'rgba(90,140,60,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 300; i++) {
    ctx.beginPath();
    const x = rnd() * 512;
    const y = rnd() * 512;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.anisotropy = 4;
  return tex;
}

/** 自然地形高度场（丘陵起伏）：刺激战场风格 */
function makeHeightfield(seed: number): (x: number, z: number) => number {
  const rnd = mulberry32(seed);
  // 随机丘陵参数（大起伏 + 中起伏 + 小起伏）
  const hills = Array.from({ length: 8 }, () => ({
    x: (rnd() - 0.5) * 44,
    z: (rnd() - 0.5) * 44,
    r: 7 + rnd() * 9,
    h: 1.0 + rnd() * 1.4,
  }));
  return (x: number, z: number): number => {
    let h = 0;
    for (const hill of hills) {
      const dx = x - hill.x;
      const dz = z - hill.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < hill.r) h += hill.h * (1 - d / hill.r) * 0.8;
    }
    // 基础起伏（草坡，更明显）
    h += Math.sin(x * 0.1) * Math.cos(z * 0.085) * 0.6;
    // 出生点平坦区（(0,6) 周围压低，避免出生在坡顶）
    const dx0 = x;
    const dz0 = z - 6;
    h *= 1 - 0.9 * Math.exp(-(dx0 * dx0 + dz0 * dz0) / 10);
    return Math.max(0, h);
  };
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

  constructor(opts: WorldOptions) {
    this.mount = opts.mount;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false; // 阴影开销大，性能优先（视觉影响小）
    // 电影感色调映射（高光柔化、暗部提亮）
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(opts.background ?? 0x0a0c10);
    this.scene.fog = new THREE.Fog(opts.background ?? 0x0a0c10, opts.fogNear ?? 8, opts.fogFar ?? 22);

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 60, window.innerWidth / window.innerHeight, opts.near ?? 0.1, opts.far ?? 120);

    // 基础光照（供 buildMap 覆盖调色）——整体提亮
    this.scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x3a4048, 2.0));
    const dir = new THREE.DirectionalLight(0xffffff, 2.4);
    dir.position.set(6, 10, 4);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 50;
    dir.shadow.camera.left = -30;
    dir.shadow.camera.right = 30;
    dir.shadow.camera.top = 30;
    dir.shadow.camera.bottom = -30;
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

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

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 竞技场地面（阴影接收 + 分区标记 + 边界警示环 + 程序化纹理） */
  addArena(radius = 22): THREE.Group {
    const g = new THREE.Group();
    const floorTex = makeFloorTexture('#1c212a', '#2a3038', '#10141a');
    const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, metalness: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);
    // 内圈标记（战斗区，随半径缩放）
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.5 - 0.2, radius * 0.5 + 0.2, 48),
      new THREE.MeshBasicMaterial({ color: 0x4a5566, transparent: true, opacity: 0.6 })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.012;
    g.add(inner);
    // 中心标记
    const center = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: 0x2a3138, transparent: true, opacity: 0.7 }));
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.012;
    g.add(center);
    // 边界环（自发光警示，双层）
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.15, radius - 0.05, 48),
      new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.015;
    g.add(ring);
    const ringOuter = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.45, radius - 0.35, 48),
      new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.25 })
    );
    ringOuter.rotation.x = -Math.PI / 2;
    ringOuter.position.y = 0.014;
    g.add(ringOuter);
    // 四角立柱 + 顶部警示灯（空间参考，随半径外移；灯仅发光体不设点光源）
    const pillarMat = solid(0x343c46, { roughness: 0.6, metalness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = Math.cos(a) * (radius - 2);
      const pz = Math.sin(a) * (radius - 2);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.2, 0.7), pillarMat);
      p.position.set(px, 2.1, pz);
      g.add(p);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), new THREE.MeshBasicMaterial({ color: 0xff6a4a }));
      lamp.position.set(px, 4.3, pz);
      g.add(lamp);
    }
    this.add(g);
    return g;
  }

  /**
   * 关卡地图：按 mapId 生成不同障碍布局与氛围（调色/灯光/装饰）。
   * 返回障碍物根节点（供切换关卡时移除）；平台数据挂在 userData.platforms。
   */
  buildMap(mapId: 'facility' | 'quarry' | 'lab' | 'volcano' | 'ice'): THREE.Group {
    const root = new THREE.Group();
    const rng = mulberry32(mapId.length * 1337 + mapId.charCodeAt(0));
    const rough = (n: number): number => n + (rng() - 0.5) * 0.6;
    /** 可跳跃平台（地形高度数据）：{ x, z, w, d, h } */
    const platforms: { x: number; z: number; w: number; d: number; h: number }[] = [];
    /** 斜坡（上下坡）：沿轴线性升高的地形条带 */
    const ramps: { x: number; z: number; w: number; d: number; h0: number; h1: number; along: 'x' | 'z' }[] = [];

    /** 生成斜坡（可视 + 地形数据） */
    const addRamp = (x: number, z: number, w: number, d: number, h0: number, h1: number, along: 'x' | 'z'): void => {
      ramps.push({ x, z, w, d, h0, h1, along });
      // 可视：斜坡用斜面（BoxGeometry 旋转）
      const len = along === 'z' ? d : w;
      const wid = along === 'z' ? w : d;
      const slope = new THREE.Mesh(new THREE.BoxGeometry(wid, Math.abs(h1 - h0), len), matBox);
      // 旋转使顶面从 h0 斜到 h1（高度基于丘陵基准）
      const ang = Math.atan2(Math.abs(h1 - h0), len);
      const baseH = heightfield(x, z);
      const mid = baseH + (h0 + h1) / 2;
      if (along === 'z') {
        slope.position.set(x, mid, z);
        slope.rotation.x = h1 > h0 ? ang : -ang;
      } else {
        slope.position.set(x, mid, z);
        slope.rotation.z = h1 > h0 ? -ang : ang;
      }
      root.add(slope);
      // 顶面平台（供玩家站立）
      const top = new THREE.Mesh(new THREE.BoxGeometry(wid, 0.05, len), solid(0x2a3138));
      top.position.set(x, h1 + 0.03, z);
      if (along === 'z') top.rotation.x = h1 > h0 ? ang : -ang;
      else top.rotation.z = h1 > h0 ? -ang : ang;
      root.add(top);
    };

    // 地图氛围调色（刺激战场自然风：蓝天/绿地/暖阳）
    const PALETTES = {
      facility: { skyTop: 0x4a90d0, skyHorizon: 0xa8c8e0, fog: 0xb8d4e8, sun: 0xfff2d0, ground: 0x3d6a30, accent: 0x5a9a3a },
      quarry: { skyTop: 0x4a90d0, skyHorizon: 0xc8b888, fog: 0xc8d0a8, sun: 0xffe8b8, ground: 0x6a5a30, accent: 0x8a6a30 },
      lab: { skyTop: 0x4a90d0, skyHorizon: 0x9ac8c0, fog: 0xa8d4d0, sun: 0xffffe8, ground: 0x4a7a50, accent: 0x4a9a70 },
      volcano: { skyTop: 0x1a0a0a, skyHorizon: 0x3a1a0a, fog: 0x2a1008, sun: 0xff6622, ground: 0x2a1a0a, accent: 0xff4400 },
      ice: { skyTop: 0x88ccee, skyHorizon: 0xccddff, fog: 0xaabbdd, sun: 0xeeeeff, ground: 0x8899aa, accent: 0x44aaff },
    } as const;
    const pal = PALETTES[mapId];
    // 明亮雾 + 天空渐变球（顶蓝 → 地平浅色）
    this.scene.background = new THREE.Color(pal.skyHorizon);
    this.scene.fog = new THREE.Fog(pal.fog, 45, 105);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(78, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(pal.skyTop) },
          horizon: { value: new THREE.Color(pal.skyHorizon) },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t=clamp(normalize(vP).y,0.0,1.0); gl_FragColor=vec4(mix(horizon,top,t),1.0); }',
      })
    );
    this.scene.add(sky);

    // 半球光：蓝天 + 绿地
    this.scene.children
      .filter((c) => (c as THREE.HemisphereLight).isHemisphereLight)
      .forEach((c) => {
        (c as THREE.HemisphereLight).color.setHex(0xc0d8f0);
        (c as THREE.HemisphereLight).groundColor.setHex(pal.ground);
      });

    // 高度场：丘陵起伏（刺激战场风）
    const heightfield = makeHeightfield(mapId.length * 977 + mapId.charCodeAt(0) * 31);
    // 自然地面：细分平面 + 顶点位移 + 草纹理
    const groundGeo = new THREE.PlaneGeometry(92, 92, 60, 60);
    groundGeo.rotateX(-Math.PI / 2);
    const pos = groundGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightfield(pos.getX(i), pos.getZ(i)));
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: makeGrassTexture(), roughness: 1 }));
    ground.receiveShadow = true;
    root.add(ground);
    // 远山（背景视觉边界）
    const mtnMat = new THREE.MeshStandardMaterial({ color: 0x5a7a4a, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(9 + rng() * 7, 14 + rng() * 9, 5), mtnMat);
      mtn.position.set(Math.cos(a) * 48, 8, Math.sin(a) * 48);
      root.add(mtn);
    }

    // 云朵（半透明白色扁球群，飘浮天空）
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 3; j++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + rng() * 2, 8, 6), cloudMat);
        puff.scale.y = 0.5;
        puff.position.set((j - 1) * 2.4, (rng() - 0.5), (rng() - 0.5));
        cloud.add(puff);
      }
      cloud.position.set((rng() - 0.5) * 80, 18 + rng() * 10, (rng() - 0.5) * 80);
      root.add(cloud);
    }

    const matBox = solid(0x5a6a4a, { roughness: 0.9 }); // 木/石色
    const matMetal = solid(0x8a8a7a, { roughness: 0.6, metalness: 0.3 });
    const matRock = solid(0x6a5a4a, { roughness: 1 });
    const glowMat = new THREE.MeshBasicMaterial({ color: pal.accent });
    // 高度场暴露给地形系统（main 查询）
    root.userData.heightfield = heightfield;

    /** 生成可跳平台（含顶部发光边缘） */
    const addPlatform = (x: number, z: number, w: number, d: number, h: number): void => {
      platforms.push({ x, z, w, d, h });
      const plat = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matBox);
      const baseH = heightfield(x, z);
      plat.position.set(x, baseH + h / 2, z);
      plat.castShadow = true;
      plat.receiveShadow = true;
      root.add(plat);
      // 顶部发光边缘（提示可跳）
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.35 }));
      edge.position.set(x, h + 0.02, z);
      root.add(edge);
    };
    /** 可破坏箱位置（打碎掉补给） */
    const crates: { x: number; z: number }[] = [];

    /** 生成可破坏箱（木质+顶部发光标记） */
    const addCrate = (x: number, z: number): void => {
      crates.push({ x, z });
      const s = 0.7 + rng() * 0.3;
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }));
      box.position.set(x, s / 2, z);
      box.castShadow = true;
      root.add(box);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(s * 0.4, 0.02, s * 0.4), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.7 }));
      mark.position.set(x, s + 0.01, z);
      root.add(mark);
    };

    const addBox = (w: number, h: number, d: number, x: number, z: number, m: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    const addPillar = (x: number, z: number): void => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.6, 10), matMetal);
      p.position.set(x, 1.3, z);
      p.castShadow = true;
      root.add(p);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), glowMat);
      lamp.position.set(x, 2.75, z);
      root.add(lamp);
    };
    // 地面污渍/碎片
    for (let i = 0; i < 10; i++) {
      const s = 0.1 + rng() * 0.3;
      const blob = new THREE.Mesh(new THREE.CircleGeometry(s, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.set((rng() - 0.5) * 26, 0.011, (rng() - 0.5) * 26);
      root.add(blob);
    }

    if (mapId === 'facility') {
      // 废弃设施：十字掩体墙 + 集装箱堆 + 管道 + 警示灯
      addBox(5, 1.1, 0.4, -7, 0, matBox);
      addBox(5, 1.1, 0.4, 7, 0, matBox);
      addBox(0.4, 1.1, 5, 0, -7, matBox);
      addBox(0.4, 1.1, 5, 0, 7, matBox);
      const container = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.6), matMetal);
      container.position.set(0, 0.8, 0);
      container.rotation.y = 0.5;
      container.castShadow = true;
      container.receiveShadow = true;
      root.add(container);
      // 集装箱堆（错落）
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), matMetal);
      c2.position.set(-10.5, 0.6, 7);
      c2.rotation.y = 0.3;
      c2.castShadow = true;
      root.add(c2);
      const c3 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), matMetal);
      c3.position.set(11, 0.6, -8);
      c3.rotation.y = -0.4;
      c3.castShadow = true;
      root.add(c3);
      // 横置管道
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6, 10), matMetal);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-11, 1.6, -5);
      pipe.castShadow = true;
      root.add(pipe);
      const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5, 10), matMetal);
      pipe2.rotation.z = Math.PI / 2;
      pipe2.position.set(10.5, 1.2, 7);
      pipe2.castShadow = true;
      root.add(pipe2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        addPillar(Math.cos(a) * 13, Math.sin(a) * 13);
      }
      // 设施：两个可跳货箱平台 + 中央观察台（z 轴起伏）
      addPlatform(-6, 6, 2.6, 2.2, 0.9);
      addPlatform(6, -6, 2.6, 2.2, 0.9);
      // 设施主地形（出生点正前方：斜坡+高台，进门即见）
      addPlatform(0, -9, 3.4, 2.6, 1.2);
      addRamp(0, -6, 3, 6, 0, 1.2, 'z');
      addPlatform(-6, 6, 2.6, 2.2, 0.9);
      addPlatform(6, -6, 2.6, 2.2, 0.9);
      // 设施可破坏箱
      addCrate(-8, 2); addCrate(8, 3); addCrate(-3, 9); addCrate(5, -8);
      // 自然掩体：小木屋（刺激战场风格）
      const woodMat = solid(0x7a5a3a, { roughness: 0.9 });
      const roofMat = solid(0x6a5533, { roughness: 0.9 });
      for (const [hx, hz] of [[-12, -8], [12, 8], [-13, 7]] as const) {
        const baseH = heightfield(hx, hz);
        const hut = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2.6), woodMat);
        hut.position.set(hx, baseH + 1.1, hz);
        root.add(hut);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4), roofMat);
        roof.position.set(hx, baseH + 2.9, hz);
        roof.rotation.y = Math.PI / 4;
        root.add(roof);
      }
      // 中央警示光柱
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4, 6), glowMat);
      beam.position.set(0, 2, 0);
      root.add(beam);
      const beamGlow = new THREE.PointLight(pal.accent, 14, 7);
      beamGlow.position.set(0, 2.6, 0);
      root.add(beamGlow);
    } else if (mapId === 'quarry') {
      // 采石场：岩壁弧墙 + 巨石 + 矿堆（发光晶簇）+ 轨道
      for (let i = 0; i < 8; i++) {
        const s = rough(1.2);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), matRock);
        const a = rng() * Math.PI * 2;
        const d = 3 + rng() * 11;
        rock.position.set(Math.cos(a) * d, s * 0.55, Math.sin(a) * d);
        rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        rock.castShadow = true;
        rock.receiveShadow = true;
        root.add(rock);
      }
      // 岩壁（四段弧墙）
      const wallMat = solid(0x3a332a, { roughness: 1 });
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * Math.PI * 2 - 0.3;
        for (let j = 0; j < 3; j++) {
          const a = a0 + (j / 3) * 0.6;
          const h = 1.6 + rng() * 1.4;
          const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 0.9), wallMat);
          w.position.set(Math.cos(a) * 16, h / 2, Math.sin(a) * 16);
          w.rotation.y = -a;
          w.castShadow = true;
          root.add(w);
        }
      }
      // 矿堆 + 发光晶簇
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2;
        const d = 6 + rng() * 8;
        const pile = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.6, 7), matRock);
        pile.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d);
        pile.castShadow = true;
        root.add(pile);
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMat);
        crystal.position.set(Math.cos(a) * d, 0.75, Math.sin(a) * d);
        root.add(crystal);
      }
      // 中央高台
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 3.4), matBox);
      plat.position.set(0, 0.6, 0);
      plat.castShadow = true;
      plat.receiveShadow = true;
      root.add(plat);
      // 四周小平台
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        addBox(2.4, 0.7, 2.4, Math.cos(a) * 10, Math.sin(a) * 10, matBox);
      }
      // 中央暖光
      const heat = new THREE.PointLight(pal.accent, 16, 8);
      heat.position.set(0, 2.4, 0);
      root.add(heat);
      // 矿场：三个可跳岩台（z 轴起伏）
      addPlatform(-8, 6, 2.4, 2.4, 1.0);
      addPlatform(8, -7, 2.4, 2.4, 1.0);
      // 矿场主地形（出生点正前方：岩台+斜坡）
      addPlatform(0, -9, 3, 2.6, 1.3);
      addRamp(0, -6.5, 2.8, 5, 0, 1.3, 'z');
      addPlatform(4, 8, 2.2, 2.2, 1.2);
      // 矿场可破坏箱
      addCrate(-10, -4); addCrate(10, 4); addCrate(0, -10);
      // 自然掩体：大石堆（环绕）
      const rockMat = solid(0x6a5a4a, { roughness: 1 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const d = 14 + Math.random() * 6;
        const bh = heightfield(Math.cos(a) * d, Math.sin(a) * d);
        const mtn = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + Math.random() * 1.6, 0), rockMat);
        mtn.position.set(Math.cos(a) * d, bh + 1, Math.sin(a) * d);
        root.add(mtn);
      }
    } else {
      // 实验室：荧光管线 + 网格矮墙 + 设备柜 + 培养舱发光柱
      for (let i = -1; i <= 1; i++) {
        addBox(0.5, 1.2, 14, i * 7, 0, matMetal);
      }
      for (let i = -1; i <= 1; i++) {
        addBox(14, 0.6, 0.5, 0, i * 7, matMetal);
      }
      // 荧光管线（地面网格线）
      const lineMat = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.55 });
      for (let i = -2; i <= 2; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 30), lineMat);
        line.position.set(i * 6, 0.013, 0);
        root.add(line);
      }
      for (let i = -2; i <= 2; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(30, 0.01, 0.03), lineMat);
        line.position.set(0, 0.013, i * 6);
        root.add(line);
      }
      // 设备柜
      for (let i = 0; i < 6; i++) {
        const x = (rng() - 0.5) * 18;
        const z = (rng() - 0.5) * 18;
        if (Math.abs(x) < 2 && Math.abs(z) < 2) continue;
        addBox(0.9, 0.8, 0.9, x, z, matBox);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), glowMat);
        led.position.set(x, 0.95, z);
        root.add(led);
      }
      // 中央培养舱（发光柱）
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 2.4, 12), matMetal);
      pod.position.set(0, 1.2, 0);
      pod.castShadow = true;
      root.add(pod);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 10), new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.8 }));
      core.position.set(0, 1.3, 0);
      root.add(core);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), glowMat);
      glow.position.set(0, 1.6, 0);
      root.add(glow);
      const podGlow = new THREE.PointLight(pal.accent, 18, 9);
      podGlow.position.set(0, 2, 0);
      root.add(podGlow);
      // 实验室：四个可跳观测台（z 轴起伏）
      addPlatform(-7, -6, 2.2, 2.2, 0.9);
      addPlatform(7, -6, 2.2, 2.2, 0.9);
      // 实验室主地形（出生点正前方：观测台+斜坡）
      addPlatform(0, -9, 3.2, 2.4, 1.2);
      addRamp(0, -6.5, 2.8, 5, 0, 1.2, 'z');
      addPlatform(-7, -6, 2.2, 2.2, 0.9);
      addPlatform(7, -6, 2.2, 2.2, 0.9);
      // 实验室可破坏箱
      addCrate(-8, 4); addCrate(8, -4); addCrate(0, -9); addCrate(9, 6);
      // 自然掩体：露营帐篷 + 篝火圈（实验室=营地风）
      const tentMat = solid(0x4a6a4a, { roughness: 0.9 });
      const poleMat = solid(0x6a5a3a, { roughness: 0.9 });
      for (const [tx, tz] of [[-11, -7], [11, 6]] as const) {
        const bh = heightfield(tx, tz);
        const tent = new THREE.Mesh(new THREE.ConeGeometry(2, 2.4, 4), tentMat);
        tent.position.set(tx, bh + 1.1, tz);
        tent.rotation.y = Math.PI / 4;
        root.add(tent);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 5), poleMat);
        pole.position.set(tx, bh + 2.6, tz);
        root.add(pole);
      }
    }
    // 平台数据供地形系统查询（跳跃落脚）
    root.userData.platforms = platforms;
    // 斜坡数据供地形系统查询（上下坡）
    root.userData.ramps = ramps;
    // 可破坏箱位置
    root.userData.crates = crates;
    // 毒池陷阱（踩入持续掉毒伤）
    const pools: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const d = 10 + rng() * 8;
      const px = Math.cos(a) * d;
      const pz = Math.sin(a) * d;
      const pr = 2 + rng() * 1.2;
      pools.push({ x: px, z: pz, r: pr });
      const bh = heightfield(px, pz);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(pr, 24),
        new THREE.MeshBasicMaterial({ color: 0x3a8a4a, transparent: true, opacity: 0.55, depthWrite: false })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(px, bh + 0.05, pz);
      root.add(pool);
      // 毒气边缘微光
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(pr - 0.15, pr, 24),
        new THREE.MeshBasicMaterial({ color: 0x6ae06a, transparent: true, opacity: 0.5 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(px, bh + 0.07, pz);
      root.add(ring);
    }
    root.userData.poisonPools = pools;

    // ---- 熔岩地图特有装饰 ----
    if (mapId === 'volcano') {
      const lavaMat = solid(0xff2200, { roughness: 0.3, metalness: 0.1 });
      lavaMat.emissive = new THREE.Color(0xff4400);
      lavaMat.emissiveIntensity = 0.6;
      // 熔岩裂缝（地面红色条带）
      for (let i = 0; i < 6; i++) {
        const a = rng() * Math.PI * 2;
        const d = 4 + rng() * 10;
        const crack = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 2 + rng() * 3), lavaMat);
        crack.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d);
        crack.rotation.y = a;
        root.add(crack);
      }
      // 火山岩柱
      const rockMat = solid(0x2a1a0a);
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2;
        const d = 6 + rng() * 8;
        const h = 1.5 + rng() * 2;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, h, 8), rockMat);
        pillar.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
        pillar.castShadow = true;
        root.add(pillar);
      }
      // 火焰粒子点光源
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        const fire = new THREE.PointLight(0xff6600, 8, 6);
        fire.position.set(Math.cos(a) * 8, 1.5, Math.sin(a) * 8);
        root.add(fire);
      }
    }

    // ---- 冰霜地图特有装饰 ----
    if (mapId === 'ice') {
      const iceMat = solid(0xaaccff, { roughness: 0.2, metalness: 0.4 });
      iceMat.emissive = new THREE.Color(0x224488);
      iceMat.emissiveIntensity = 0.15;
      // 冰晶柱
      for (let i = 0; i < 7; i++) {
        const a = rng() * Math.PI * 2;
        const d = 4 + rng() * 10;
        const h = 1.5 + rng() * 3;
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.25, h, 5), iceMat);
        crystal.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d);
        crystal.castShadow = true;
        root.add(crystal);
      }
      // 雪堆（扁球体）
      const snowMat = solid(0xeef4ff);
      for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2;
        const d = 3 + rng() * 12;
        const snow = new THREE.Mesh(new THREE.SphereGeometry(0.6 + rng() * 0.5, 8, 6), snowMat);
        snow.scale.y = 0.35;
        snow.position.set(Math.cos(a) * d, 0.15, Math.sin(a) * d);
        root.add(snow);
      }
      // 冰面反射光
      const iceLight = new THREE.PointLight(0x88bbff, 6, 10);
      iceLight.position.set(0, 3, 0);
      root.add(iceLight);
    }

    this.add(root);
    return root;
  }
}
