/**
 * render/fx — 战斗特效层（高性能版）。
 *
 * 旧实现每次命中都 new Mesh + new BoxGeometry + new Material，加一次 DOM 跳字，
 * 密集射击时会产生数百绘制调用 / 每帧 GC / 几何体泄漏。这里统一改成：
 *   - 粒子：单个 THREE.Points + 自定义着色器（1 draw call 承载全部火花）
 *   - 冲击环：单个 InstancedMesh（1 draw call 承载全部扩散环，加法混合淡出）
 *   - 伤害跳字：单个 2D canvas 覆盖层（无 DOM 节点、无 text-shadow 重绘）
 * 对外只暴露语义化接口：emit / burst / popup / update。
 */
import * as THREE from 'three';

const MAX_PARTICLES = 720;
const MAX_RINGS = 16;
/** 与 World 相机 fov 保持一致（仅用于粒子屏幕尺寸换算） */
const CAMERA_FOV_DEG = 60;

const PARTICLE_VS = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 上限 48px：近距离时也不会出现糊满屏的光斑
    gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 0.0, 48.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FS = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25 || vAlpha <= 0.001) discard;
    float soft = smoothstep(0.25, 0.02, r2);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

interface Ring {
  x: number;
  y: number;
  z: number;
  life: number;
  ttl: number;
  from: number;
  to: number;
  color: THREE.Color;
}

interface Popup {
  x: number;
  y: number;
  z: number;
  vy: number;
  life: number;
  ttl: number;
  text: string;
  color: string;
  size: number;
  /** 聚合键（同键的年轻跳字会合并数值，避免连射时叠成一团） */
  key: string;
}

export class Fx {
  // ---- 粒子 ----
  private readonly pGeo: THREE.BufferGeometry;
  private readonly pMat: THREE.ShaderMaterial;
  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pCol = new Float32Array(MAX_PARTICLES * 3);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pAlpha = new Float32Array(MAX_PARTICLES);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pTtl = new Float32Array(MAX_PARTICLES);
  private readonly pDrag = new Float32Array(MAX_PARTICLES);
  private particleCursor = 0;
  private particleColorDirty = false;

  // ---- 冲击环 ----
  private readonly rings: Ring[] = [];
  private readonly ringMesh: THREE.InstancedMesh;
  private ringCursor = 0;
  private readonly ringMat = new THREE.Matrix4();
  private readonly ringColor = new THREE.Color();
  private readonly ringScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  // ---- 跳字 ----
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly popups: Popup[] = [];
  private dpr = 1;
  private readonly projScratch = new THREE.Vector3();
  private lastFontSize = 0;

  constructor(scene: THREE.Scene) {
    // ===== 粒子：单 Points =====
    this.pGeo = new THREE.BufferGeometry();
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.pGeo, this.pMat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    scene.add(points);

    // ===== 冲击环：单 InstancedMesh =====
    // 注意：这里必须是圆环（RingGeometry）。0.75~1.0 的环带在半径 2m 时只有 25cm 厚，
    // 若用实心 PlaneGeometry，多次击杀的加法混合会把整个画面刷成金色。
    const ringGeo = new THREE.RingGeometry(0.74, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 4;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_RINGS; i++) {
      this.ringMesh.setMatrixAt(i, zero);
      this.ringMesh.setColorAt(i, this.ringColor.setRGB(0, 0, 0));
    }
    scene.add(this.ringMesh);

    // ===== 跳字：2D canvas =====
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'ss-fx-layer';
    this.canvas.style.cssText = 'position:fixed;inset:0;z-index:17;pointer-events:none;';
    document.body.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** 视口变化：同步跳字画布与粒子屏幕尺寸系数 */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.pMat.uniforms.uScale.value =
      (window.innerHeight * this.dpr) / (2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 180 / 2));
  }

  /** 发射一簇粒子（火花 / 碎屑 / 受击碎片） */
  emit(pos: THREE.Vector3, color: number, count = 3, speed = 2.2, sizeScale = 1): void {
    const c = this.tmpColor.setHex(color);
    for (let i = 0; i < count; i++) {
      const idx = this.particleCursor;
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      const i3 = idx * 3;
      this.pPos[i3] = pos.x + (Math.random() - 0.5) * 0.12;
      this.pPos[i3 + 1] = pos.y + (Math.random() - 0.5) * 0.12;
      this.pPos[i3 + 2] = pos.z + (Math.random() - 0.5) * 0.12;
      const sp = speed * (0.45 + Math.random() * 0.75);
      const dirX = Math.random() - 0.5;
      const dirY = Math.random() * 0.9 + 0.15;
      const dirZ = Math.random() - 0.5;
      const inv = sp / Math.max(0.001, Math.hypot(dirX, dirY, dirZ));
      this.pVel[i3] = dirX * inv;
      this.pVel[i3 + 1] = dirY * inv;
      this.pVel[i3 + 2] = dirZ * inv;
      const tint = 0.75 + Math.random() * 0.5;
      this.pCol[i3] = Math.min(1, c.r * tint);
      this.pCol[i3 + 1] = Math.min(1, c.g * tint);
      this.pCol[i3 + 2] = Math.min(1, c.b * tint);
      const ttl = 0.24 + Math.random() * 0.28;
      this.pLife[idx] = ttl;
      this.pTtl[idx] = ttl;
      // 单位是「世界米」：火花实际直径 5~9cm（写成 1.4~3 会让每颗火花有 2 米大，
      // 密集命中时加法混合直接把画面刷白）
      this.pSize[idx] = (0.05 + Math.random() * 0.045) * sizeScale;
      this.pAlpha[idx] = 1;
      this.pDrag[idx] = 5 + Math.random() * 6;
    }
    this.particleColorDirty = true;
  }

  /** 击杀冲击环（贴地扩散，加法混合淡出） */
  burst(pos: THREE.Vector3, color = 0xffd24a, radius = 1.9): void {
    const ring = this.rings[this.ringCursor] ?? ({} as Ring);
    if (!ring.color) ring.color = new THREE.Color();
    this.rings[this.ringCursor] = ring;
    this.ringCursor = (this.ringCursor + 1) % MAX_RINGS;
    ring.x = pos.x;
    ring.y = pos.y + 0.05;
    ring.z = pos.z;
    ring.life = 0.42;
    ring.ttl = 0.42;
    ring.from = 0.25;
    ring.to = radius;
    ring.color.setHex(color);
  }

  /**
   * 世界坐标伤害跳字。
   * 带 key 时做聚合：120ms 内同键的跳字合并数值并刷新位置（连射时同一敌人
   * 只有一行不断累加的数字，而不是几十层叠在一起）。
   */
  popup(worldPos: THREE.Vector3, text: string, color: string, size = 18, key = ''): void {
    if (key) {
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        if (p.key !== key) continue;
        if (p.ttl - p.life > 0.12) break; // 只合并"还很年轻"的
        const a = parseFloat(p.text.replace(/[^\d.-]/g, ''));
        const b = parseFloat(text.replace(/[^\d.-]/g, ''));
        if (Number.isFinite(a) && Number.isFinite(b)) {
          p.text = String(Math.round(a + b));
          p.x = worldPos.x;
          p.y = worldPos.y;
          p.z = worldPos.z;
          p.life = Math.max(p.life, 0.45);
          p.ttl = Math.max(p.ttl, 0.85);
          return;
        }
        break;
      }
    }
    if (this.popups.length > 40) this.popups.shift();
    this.popups.push({
      x: worldPos.x,
      y: worldPos.y,
      z: worldPos.z,
      vy: 0.9 + Math.random() * 0.5,
      life: 0.85,
      ttl: 0.85,
      text,
      color,
      size,
      key,
    });
  }

  /** 每帧推进（须在相机矩阵更新之后调用） */
  update(dt: number, camera: THREE.Camera): void {
    this.updateParticles(dt);
    this.updateRings(dt);
    this.updatePopups(dt, camera);
  }

  private updateParticles(dt: number): void {
    const posAttr = this.pGeo.attributes.position as THREE.BufferAttribute;
    const alphaAttr = this.pGeo.attributes.aAlpha as THREE.BufferAttribute;
    const sizeAttr = this.pGeo.attributes.aSize as THREE.BufferAttribute;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      const i3 = i * 3;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pAlpha[i] = 0;
        this.pSize[i] = 0;
        continue;
      }
      const damp = Math.max(0, 1 - this.pDrag[i] * dt);
      this.pVel[i3] *= damp;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * damp - 14 * dt;
      this.pVel[i3 + 2] *= damp;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      const t = this.pLife[i] / this.pTtl[i];
      this.pAlpha[i] = t * t;
    }
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    if (this.particleColorDirty) {
      this.particleColorDirty = false;
      (this.pGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private updateRings(dt: number): void {
    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = this.rings[i];
      if (!ring || ring.life <= 0) {
        this.ringMat.makeScale(0, 0, 0);
        this.ringMesh.setMatrixAt(i, this.ringMat);
        continue;
      }
      ring.life -= dt;
      const t = Math.min(1, Math.max(0, 1 - ring.life / ring.ttl));
      const r = ring.from + (ring.to - ring.from) * (1 - (1 - t) * (1 - t));
      this.ringMat.makeTranslation(ring.x, ring.y, ring.z);
      this.ringMat.scale(this.ringScale.set(r, 1, r));
      this.ringMesh.setMatrixAt(i, this.ringMat);
      const fade = 1 - t;
      this.ringMesh.setColorAt(i, this.ringColor.copy(ring.color).multiplyScalar(fade * fade * 0.55));
    }
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  private updatePopups(dt: number, camera: THREE.Camera): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.popups.length === 0) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.popups.splice(i, 1);
        continue;
      }
      p.y += p.vy * dt;
      this.projScratch.set(p.x, p.y, p.z).project(camera);
      if (this.projScratch.z > 1) continue;
      const sx = ((this.projScratch.x + 1) / 2) * w;
      const sy = ((-this.projScratch.y + 1) / 2) * h;
      const t = p.life / p.ttl;
      const pop = t > 0.82 ? 1 + (t - 0.82) * 2.2 : 1;
      const size = Math.round(p.size * pop);
      if (size !== this.lastFontSize) {
        this.lastFontSize = size;
        ctx.font = `800 ${size}px "Cascadia Mono", Consolas, monospace`;
      }
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.strokeStyle = 'rgba(0,0,0,0.82)';
      ctx.fillStyle = p.color;
      ctx.strokeText(p.text, sx, sy);
      ctx.fillText(p.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }
}
