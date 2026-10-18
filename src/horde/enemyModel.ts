/**
 * horde/enemyModel — 敌人程序化建模（按兵种定制剪影，合并成单网格）。
 *
 * 旧实现用「胶囊 + 眼睛」当占位，再挂一个被染色的通用机器人 GLB：
 * 既不像各兵种，又因每个敌人 clone 整棵骨架 + 多份材质而吃掉大量 draw call。
 * 这里改为：每种兵种手工搭一套低多边形剪影 → 顶点色合并 → 全兵种共用一份几何，
 * 每个敌人只占 1 个不透明网格 + 1 个血条精灵，draw call 从 ~8 降到 2。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyKind } from './enemy';

export interface EnemyTemplate {
  geometry: THREE.BufferGeometry;
  /** 共用基础材质（每个敌人 clone 一份，用于受击闪红） */
  material: THREE.MeshStandardMaterial;
  /** 视觉高度（血条定位用） */
  height: number;
}



/** 几何累加器：把多个带顶点色的图元合并成单个 BufferGeometry */
class Builder {
  private readonly geos: THREE.BufferGeometry[] = [];

  private push(geo: THREE.BufferGeometry, color: THREE.Color, m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.applyMatrix4(m);
    const count = g.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = color.r;
      arr[i * 3 + 1] = color.g;
      arr[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.geos.push(g);
  }

  private mat(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.BoxGeometry(w, h, d), c, this.mat(x, y, z, rx, ry, rz));
  }

  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.CylinderGeometry(rt, rb, h, seg), c, this.mat(x, y, z, rx, ry, rz));
  }

  cone(r: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.ConeGeometry(r, h, seg), c, this.mat(x, y, z, rx, ry, rz));
  }

  capsule(r: number, len: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, rz = 0): void {
    this.push(new THREE.CapsuleGeometry(r, len, 4, 10), c, this.mat(x, y, z, rx, 0, rz));
  }

  sphere(r: number, x: number, y: number, z: number, c: THREE.Color, sx = 1, sy = 1, sz = 1): void {
    this.push(new THREE.SphereGeometry(r, 10, 8), c, this.mat(x, y, z, 0, 0, 0, sx, sy, sz));
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    if (!merged) throw new Error('enemy geometry merge failed');
    merged.computeBoundingSphere();
    return merged;
  }
}

/** 颜色明暗调整（线性空间乘系数，>1 的值在色调映射后会更“发光”） */
const _grey = new THREE.Color();
function shade(hex: number, k: number): THREE.Color {
  const c = new THREE.Color(hex);
  // 向灰调靠拢 16%：荒原生物不该是纯饱和塑料色
  const g = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  c.lerp(_grey.setRGB(g, g, g), 0.16);
  return c.multiplyScalar(k);
}

function buildChaser(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.42);
  const light = shade(color, 1.45);
  const glow = shade(color, 3.2);
  // 前倾躯干
  b.capsule(0.2, 0.34, 0, 0.78, 0.02, base, 0.35, 0);
  // 胸腔硬壳
  b.sphere(0.23, 0, 0.85, 0.02, light, 1.05, 0.85, 0.8);
  // 头（前伸）+ 下颚
  b.sphere(0.16, 0, 1.06, -0.16, base, 1, 0.92, 1.1);
  b.box(0.19, 0.07, 0.16, 0, 0.98, -0.22, dark, 0.2);
  // 双眼
  b.sphere(0.05, -0.072, 1.1, -0.335, glow);
  b.sphere(0.05, 0.072, 1.1, -0.335, glow);
  // 肩 + 前爪
  for (const s of [-1, 1]) {
    b.sphere(0.12, s * 0.22, 0.92, 0.02, dark);
    b.cyl(0.055, 0.075, 0.36, 6, s * 0.26, 0.74, -0.12, base, 0.7, 0, s * 0.12);
    b.cone(0.06, 0.2, 5, s * 0.24, 0.56, -0.3, light, 1.5);
  }
  // 双腿 + 脚掌
  for (const s of [-1, 1]) {
    b.cyl(0.06, 0.08, 0.42, 6, s * 0.13, 0.32, 0.02, dark, 0, 0, s * 0.1);
    b.box(0.14, 0.08, 0.24, s * 0.15, 0.05, -0.04, dark);
  }
  // 背脊骨刺
  for (let i = 0; i < 3; i++) {
    b.cone(0.055, 0.16 + i * 0.03, 5, 0, 0.98 + i * 0.1, 0.16 - i * 0.04, light, -0.5);
  }
  return { geometry: b.build(), material: enemyMaterial(), height: 1.35 };
}

function buildBoomer(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.4);
  const light = shade(color, 1.4);
  const glow = shade(color, 3.6);
  // 膨胀的囊体
  b.sphere(0.36, 0, 0.62, 0.02, base, 1, 1.15, 1);
  // 腹部分节
  for (let i = 0; i < 3; i++) {
    b.sphere(0.3 - i * 0.03, 0, 0.44 + i * 0.26, 0.02, i % 2 ? light : base, 1.02, 0.28, 1.02);
  }
  // 核心（高亮）
  b.sphere(0.11, 0, 0.66, -0.33, glow, 1, 1, 0.6);
  // 小头
  b.sphere(0.16, 0, 1.14, -0.06, dark, 1.05, 0.9, 1);
  b.sphere(0.045, -0.07, 1.18, -0.225, glow);
  b.sphere(0.045, 0.07, 1.18, -0.225, glow);
  // 短腿
  for (const s of [-1, 1]) {
    b.cyl(0.07, 0.09, 0.26, 6, s * 0.17, 0.14, 0, dark);
    b.box(0.15, 0.07, 0.2, s * 0.17, 0.04, -0.02, dark);
  }
  // 引信突起
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.cone(0.04, 0.14, 4, Math.cos(a) * 0.3, 0.95, Math.sin(a) * 0.3 + 0.02, light, -0.3);
  }
  return { geometry: b.build(), material: enemyMaterial(), height: 1.4 };
}

function buildSpitter(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.4);
  const light = shade(color, 1.4);
  const glow = shade(color, 3.2);
  // 细长躯干
  b.capsule(0.15, 0.4, 0, 0.84, 0.04, base, 0.15, 0);
  // 长颈 + 头
  b.cyl(0.07, 0.1, 0.34, 6, 0, 1.14, -0.1, dark, 0.5);
  b.sphere(0.14, 0, 1.3, -0.24, base, 1, 0.9, 1.2);
  // 喷口
  b.cone(0.09, 0.26, 7, 0, 1.26, -0.42, dark, 1.45);
  b.sphere(0.05, 0, 1.26, -0.52, glow);
  // 背刺
  for (let i = 0; i < 5; i++) {
    b.cone(0.05, 0.2, 5, 0, 1.02 - i * 0.12, 0.16 + i * 0.02, light, -0.35);
  }
  // 手臂
  for (const s of [-1, 1]) {
    b.cyl(0.045, 0.06, 0.3, 5, s * 0.2, 0.86, -0.06, dark, 0.4, 0, s * 0.2);
  }
  // 腿
  for (const s of [-1, 1]) {
    b.cyl(0.055, 0.07, 0.5, 6, s * 0.11, 0.3, 0.02, dark, 0, 0, s * 0.06);
    b.box(0.12, 0.07, 0.22, s * 0.13, 0.045, -0.04, dark);
  }
  // 尾
  b.cone(0.07, 0.4, 5, 0, 0.72, 0.3, light, -1.3);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.55 };
}

function buildGuard(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.4);
  const light = shade(color, 1.35);
  const metal = shade(0x8a97a8, 1);
  const glow = shade(color, 2.8);
  // 宽厚躯干
  b.box(0.52, 0.58, 0.34, 0, 0.86, 0, base, 0.06);
  b.box(0.58, 0.16, 0.38, 0, 1.08, 0, light);
  // 头盔
  b.sphere(0.17, 0, 1.24, 0, dark, 1.1, 0.95, 1.05);
  b.box(0.26, 0.07, 0.1, 0, 1.2, -0.19, glow);
  // 护肩
  for (const s of [-1, 1]) {
    b.sphere(0.17, s * 0.29, 1.02, 0, metal, 1.1, 0.8, 1);
    b.cyl(0.07, 0.085, 0.34, 6, s * 0.31, 0.78, 0, dark);
  }
  // 大盾（正面）+ 边框
  b.box(0.72, 0.86, 0.09, 0, 0.72, -0.28, metal, 0.08);
  b.box(0.78, 0.1, 0.11, 0, 1.1, -0.28, light);
  b.box(0.12, 0.5, 0.11, 0, 0.72, -0.28, glow);
  // 腿
  for (const s of [-1, 1]) {
    b.cyl(0.09, 0.11, 0.46, 6, s * 0.17, 0.26, 0, dark);
    b.box(0.2, 0.09, 0.28, s * 0.18, 0.05, -0.04, dark);
  }
  return { geometry: b.build(), material: enemyMaterial(0.55, 0.35), height: 1.5 };
}

function buildBerserker(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.42);
  const light = shade(color, 1.5);
  const glow = shade(0xff5a5a, 1.6);
  // 前倾瘦身
  b.capsule(0.16, 0.38, 0, 0.86, -0.04, base, 0.5, 0);
  // 头
  b.sphere(0.15, 0, 1.12, -0.18, dark, 1, 0.9, 1.1);
  b.sphere(0.045, -0.06, 1.15, -0.35, glow);
  b.sphere(0.045, 0.06, 1.15, -0.35, glow);
  // 背刺（发光）
  for (let i = 0; i < 6; i++) {
    b.cone(0.05, 0.24, 4, 0, 0.96 + i * 0.08, 0.1 + i * 0.03, glow, -0.9 + i * 0.1);
  }
  // 长臂 + 利爪
  for (const s of [-1, 1]) {
    b.cyl(0.05, 0.07, 0.5, 6, s * 0.24, 0.78, -0.14, dark, 0.9, 0, s * 0.18);
    for (let k = -1; k <= 1; k++) {
      b.cone(0.03, 0.18, 4, s * 0.3 + k * 0.05, 0.5, -0.36, light, 1.9);
    }
  }
  // 腿
  for (const s of [-1, 1]) {
    b.cyl(0.055, 0.075, 0.48, 6, s * 0.12, 0.3, 0.04, dark, -0.1, 0, s * 0.08);
    b.box(0.12, 0.07, 0.24, s * 0.14, 0.045, -0.02, dark);
  }
  return { geometry: b.build(), material: enemyMaterial(), height: 1.4 };
}

function buildCaster(color: number): EnemyTemplate {
  const b = new Builder();
  const base = shade(color, 1);
  const dark = shade(color, 0.38);
  const light = shade(color, 1.4);
  const glow = shade(0xcc88ff, 1.8);
  // 长袍
  b.cyl(0.3, 0.46, 1.05, 10, 0, 0.52, 0, base);
  // 兜帽
  b.cone(0.24, 0.4, 8, 0, 1.22, 0, dark, 0);
  b.sphere(0.19, 0, 1.15, -0.02, dark, 1, 0.85, 1);
  b.sphere(0.06, 0, 1.16, -0.225, glow);
  // 肩饰
  for (const s of [-1, 1]) {
    b.sphere(0.1, s * 0.28, 1.0, 0, light, 1, 0.7, 1);
  }
  // 法杖
  b.cyl(0.025, 0.03, 1.3, 5, 0.34, 0.7, -0.04, dark, 0, 0, 0.12);
  b.sphere(0.1, 0.4, 1.32, -0.04, glow);
  // 袍摆
  b.cyl(0.46, 0.5, 0.16, 10, 0, 0.06, 0, dark);
  return { geometry: b.build(), material: enemyMaterial(0.7, 0.05), height: 1.5 };
}

/**
 * 敌人材质：在标准材质上注入顶点级行走动画。
 * 敌人是"合并后的单网格"，没有骨骼，所以用着色器按局部坐标分区摆动：
 * y<0.52 视为腿、|x|>0.12 且 y>0.42 视为手臂，左右用 sign(x) 反相 → 走路时四肢交替。
 * 好处是零 draw call 增量、零 CPU 骨骼开销，同时摆脱"滑动木头人"的僵硬感。
 */
const ANIM_UNIFORMS = /* glsl */ `
uniform float uPhase;
uniform float uMove;
uniform float uAttack;
`;

const ANIM_BODY = /* glsl */ `
  #include <begin_vertex>
  float eSide = sign(transformed.x + 0.00001);
  float legMask = smoothstep(0.52, 0.16, transformed.y);
  float armMask = smoothstep(0.40, 0.70, transformed.y) * smoothstep(0.10, 0.22, abs(transformed.x));
  float eSwing = sin(uPhase) * uMove;
  transformed.z += eSwing * 0.19 * legMask * eSide;
  transformed.y += abs(eSwing) * 0.025 * legMask;
  transformed.z -= eSwing * 0.14 * armMask * eSide;
  transformed.x += sin(uPhase * 2.0) * 0.014 * (legMask + armMask);
  // 呼吸起伏（上半身）+ 攻击前倾
  transformed.y += sin(uPhase * 0.55) * 0.014 * smoothstep(0.55, 1.0, transformed.y);
  transformed.z += uAttack * 0.16 * smoothstep(0.0, 1.1, transformed.y);
`;

function enemyMaterial(roughness = 0.62, metalness = 0.12): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness,
    metalness,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 1,
  });
  mat.customProgramCacheKey = () => 'enemy-anim';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = { value: 0 };
    shader.uniforms.uMove = { value: 0 };
    shader.uniforms.uAttack = { value: 0 };
    shader.vertexShader = ANIM_UNIFORMS + shader.vertexShader.replace('#include <begin_vertex>', ANIM_BODY);
    mat.userData.anim = shader.uniforms;
  };
  return mat;
}

const builders: Record<EnemyKind, (color: number) => EnemyTemplate> = {
  chaser: buildChaser,
  boomer: buildBoomer,
  spitter: buildSpitter,
  guard: buildGuard,
  berserker: buildBerserker,
  caster: buildCaster,
};

const cache = new Map<EnemyKind, EnemyTemplate>();

/** 取兵种模板（几何全局共享，材质作为 clone 母版） */
export function getEnemyTemplate(kind: EnemyKind, color: number): EnemyTemplate {
  const hit = cache.get(kind);
  if (hit) return hit;
  const tpl = builders[kind](color);
  cache.set(kind, tpl);
  return tpl;
}

/** 血条精灵：单 quad + 着色器按 uHp 填充，随相机自动朝向 */
export function createHealthBar(color: number): { sprite: THREE.Sprite; setHp: (pct: number) => void } {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uHp: { value: 1 },
      uFill: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uHp;
      uniform vec3 uFill;
      varying vec2 vUv;
      void main() {
        vec3 bg = vec3(0.055, 0.06, 0.075);
        float border = max(max(step(vUv.y, 0.05), step(0.95, vUv.y)), max(step(vUv.x, 0.012), step(0.988, vUv.x)));
        vec3 col = vUv.x <= uHp ? uFill * (0.72 + 0.5 * vUv.y) : bg;
        col = mix(col, vec3(0.02, 0.02, 0.03), border * 0.85);
        gl_FragColor = vec4(col, 0.92);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(mat as unknown as THREE.SpriteMaterial);
  sprite.scale.set(0.9, 0.1, 1);
  sprite.renderOrder = 6;
  return {
    sprite,
    setHp: (pct: number) => {
      mat.uniforms.uHp.value = Math.max(0, Math.min(1, pct));
    },
  };
}
