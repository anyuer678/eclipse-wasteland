/**
 * horde/enemyModel — 敌人程序化建模（按兵种定制剪影，合并成单网格）。
 *
 * 建模思路：用「锥台装甲片 + 关节块 + 尖刺」拼出硬边剪影，避免一堆球体叠成
 * 气球人；每个兵种一套比例与附件，合并后仍是 1 个不透明网格，draw call 不变。
 *
 * 动画：没有骨骼也能摆四肢——见 ANIM_BODY，绕髋/肩铰链做旋转，再做区域权重混合。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyKind } from './enemy';

export interface EnemyTemplate {
  geometry: THREE.BufferGeometry;
  /** 共用基础材质（每个敌人 clone 一份，用于受击闪红与动画 uniform） */
  material: THREE.MeshStandardMaterial;
  /** 视觉高度（血条定位用） */
  height: number;
}

/** 几何累加器：把多个带顶点色的图元合并成单个 BufferGeometry */
class Builder {
  private readonly geos: THREE.BufferGeometry[] = [];

  private static m4(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  }

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

  box(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.BoxGeometry(w, h, d), c, Builder.m4(x, y, z, rx, ry, rz));
  }

  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.CylinderGeometry(rt, rb, h, seg), c, Builder.m4(x, y, z, rx, ry, rz));
  }

  /** 四棱锥台（装甲片 / 四肢）：wTop/wBot 为对边宽度 */
  taper(wTop: number, wBot: number, h: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    const g = new THREE.CylinderGeometry(wTop / Math.SQRT2, wBot / Math.SQRT2, h, 4, 1);
    g.rotateY(Math.PI / 4);
    this.push(g, c, Builder.m4(x, y, z, rx, ry, rz));
  }

  cone(r: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.Color, rx = 0, ry = 0, rz = 0): void {
    this.push(new THREE.ConeGeometry(r, h, seg), c, Builder.m4(x, y, z, rx, ry, rz));
  }

  sphere(r: number, x: number, y: number, z: number, c: THREE.Color, sx = 1, sy = 1, sz = 1): void {
    this.push(new THREE.SphereGeometry(r, 8, 6), c, Builder.m4(x, y, z, 0, 0, 0, sx, sy, sz));
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    if (!merged) throw new Error('enemy geometry merge failed');
    merged.computeBoundingSphere();
    return merged;
  }
}

/** 颜色明暗调整（线性空间乘系数，>1 的值在色调映射后会更"发光"） */
const _grey = new THREE.Color();
function shade(hex: number, k: number): THREE.Color {
  const c = new THREE.Color(hex);
  // 向灰调靠拢 16%：荒原生物不该是纯饱和塑料色
  const g = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  c.lerp(_grey.setRGB(g, g, g), 0.16);
  return c.multiplyScalar(k);
}

interface Palette {
  base: THREE.Color;
  dark: THREE.Color;
  plate: THREE.Color;
  light: THREE.Color;
  glow: THREE.Color;
}

/** 每个兵种复用的一套色板：本体 / 关节 / 装甲 / 高光 / 发光 */
function palette(color: number): Palette {
  return {
    base: shade(color, 1),
    dark: shade(color, 0.34),
    plate: shade(color, 0.62),
    light: shade(color, 1.42),
    glow: shade(color, 3.4),
  };
}

/** 通用腿：大腿 + 小腿 + 脚掌（x 为左右偏移，kneeOut 让小腿略外八） */
function leg(b: Builder, x: number, accent: THREE.Color, foot: THREE.Color, kneeOut = 0.02): void {
  // 大腿上端埋进骨盆（0.68），避免摆动时露出断面
  b.taper(0.13, 0.09, 0.36, x, 0.5, 0, accent, 0.04, 0, kneeOut);
  b.taper(0.085, 0.065, 0.3, x + kneeOut * 0.6, 0.21, 0.03, accent, -0.12);
  b.box(0.14, 0.06, 0.24, x + kneeOut, 0.035, -0.03, foot);
  b.box(0.1, 0.05, 0.1, x + kneeOut, 0.075, -0.11, foot, 0.3);
}

/** 通用手臂：肩甲 + 上臂 + 前臂（side=-1 左 / 1 右） */
function arm(b: Builder, side: number, y: number, accent: THREE.Color, plate: THREE.Color, len = 1): void {
  b.taper(0.105, 0.085, 0.11, side * 0.215, y, 0, plate, 0, 0, side * 0.22);
  b.taper(0.065, 0.055, 0.22 * len, side * 0.245, y - 0.14, -0.02, accent, 0.14, 0, side * 0.06);
  b.taper(0.055, 0.046, 0.2 * len, side * 0.255, y - 0.32, -0.07, accent, 0.42);
}

function buildChaser(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  // 骨盆 + 前倾胸腔 + 胸甲 / 背甲
  b.taper(0.26, 0.32, 0.28, 0, 0.68, 0.02, p.dark);
  b.taper(0.3, 0.25, 0.34, 0, 0.9, -0.02, p.base, 0.16);
  b.box(0.33, 0.15, 0.24, 0, 0.97, -0.06, p.plate, 0.16);
  b.box(0.2, 0.1, 0.12, 0, 0.9, 0.14, p.dark, -0.1);
  // 颈 + 头骨 + 下颚 + 双眼
  b.cyl(0.055, 0.07, 0.08, 6, 0, 1.07, -0.05, p.dark, 0.2);
  b.taper(0.2, 0.16, 0.17, 0, 1.16, -0.11, p.base, 0.28);
  b.box(0.17, 0.06, 0.19, 0, 1.11, -0.19, p.dark, 0.12);
  for (const s of [-1, 1]) b.sphere(0.032, s * 0.06, 1.19, -0.2, p.glow);
  // 头冠
  for (let i = 0; i < 3; i++) b.cone(0.03, 0.13 - i * 0.02, 4, 0, 1.27 + i * 0.005, -0.03 + i * 0.05, p.plate, -0.5 + i * 0.1);
  // 肩 + 手臂 + 三爪
  for (const s of [-1, 1]) {
    b.sphere(0.095, s * 0.2, 1.0, -0.02, p.dark, 1.1, 0.9, 1.1);
    arm(b, s, 0.97, p.base, p.plate, 0.95);
    for (let k = -1; k <= 1; k++) b.cone(0.021, 0.13, 4, s * 0.265 + k * 0.032, 0.63, -0.17, p.light, 1.9);
  }
  leg(b, -0.105, p.base, p.dark, 0.015);
  leg(b, 0.105, p.base, p.dark, 0.015);
  // 脊刺
  for (let i = 0; i < 4; i++) b.cone(0.042, 0.16 - i * 0.02, 4, 0, 1.03 - i * 0.1, 0.14 + i * 0.015, p.light, -0.35);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.5 };
}

function buildBoomer(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  // 膨胀囊体 + 三段环箍
  b.sphere(0.34, 0, 0.66, 0, p.base, 1, 1.1, 0.95);
  for (let i = 0; i < 3; i++) {
    b.taper(0.5 - i * 0.05, 0.56 - i * 0.05, 0.08, 0, 0.42 + i * 0.22, 0, p.plate, 0.06);
  }
  // 背部排气口
  for (const s of [-1, 1]) b.cyl(0.035, 0.045, 0.14, 6, s * 0.16, 0.95, 0.16, p.dark, 0.5, 0, s * 0.4);
  // 腹部裂口（核心发光）
  b.box(0.14, 0.26, 0.08, 0, 0.66, -0.31, p.glow, 0.1);
  b.box(0.06, 0.14, 0.06, 0, 0.66, -0.34, p.glow);
  // 小头 + 面罩
  b.taper(0.17, 0.13, 0.15, 0, 1.14, -0.04, p.dark, 0.1);
  b.box(0.15, 0.05, 0.06, 0, 1.14, -0.13, p.glow);
  // 引信触点
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.cone(0.032, 0.12, 4, Math.cos(a) * 0.26, 1.0, Math.sin(a) * 0.24, p.light, -0.35);
  }
  leg(b, -0.16, p.base, p.dark, 0.03);
  leg(b, 0.16, p.base, p.dark, 0.03);
  for (const s of [-1, 1]) arm(b, s, 0.78, p.base, p.plate, 0.7);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.4 };
}

function buildSpitter(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  b.taper(0.22, 0.28, 0.24, 0, 0.68, 0.02, p.dark);
  b.taper(0.22, 0.18, 0.36, 0, 0.9, 0, p.base, 0.1);
  // 长颈（两段）
  b.cyl(0.05, 0.065, 0.16, 6, 0, 1.12, -0.08, p.base, 0.45);
  b.cyl(0.045, 0.05, 0.16, 6, 0, 1.22, -0.18, p.dark, 0.9);
  // 头 + 长吻 + 毒囊
  b.taper(0.16, 0.13, 0.14, 0, 1.32, -0.3, p.base, 0.5);
  b.cone(0.075, 0.26, 7, 0, 1.3, -0.45, p.dark, 1.5);
  b.sphere(0.052, 0, 1.3, -0.57, p.glow);
  b.sphere(0.07, 0, 1.24, -0.22, p.plate, 1.2, 0.8, 1);
  // 背刺 + 尾
  for (let i = 0; i < 5; i++) b.cone(0.04, 0.18 - i * 0.02, 4, 0, 1.02 - i * 0.11, 0.13 + i * 0.02, p.light, -0.4);
  b.taper(0.09, 0.03, 0.42, 0, 0.66, 0.3, p.plate, -1.25);
  for (const s of [-1, 1]) arm(b, s, 0.92, p.base, p.plate, 0.85);
  leg(b, -0.1, p.base, p.dark, 0.01);
  leg(b, 0.1, p.base, p.dark, 0.01);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.6 };
}

function buildGuard(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  const steel = shade(0x9aa3ae, 1);
  // 三层厚甲
  b.taper(0.5, 0.46, 0.34, 0, 0.82, 0, p.base);
  b.box(0.54, 0.16, 0.38, 0, 0.95, 0, p.plate);
  b.box(0.46, 0.1, 0.34, 0, 1.04, 0, p.light);
  // 头盔 + 面罩缝 + 盔脊
  b.taper(0.26, 0.3, 0.2, 0, 1.18, 0, p.dark);
  b.box(0.24, 0.045, 0.1, 0, 1.18, -0.16, p.glow);
  b.box(0.06, 0.1, 0.2, 0, 1.28, 0, p.plate);
  // 护肩
  for (const s of [-1, 1]) {
    b.taper(0.2, 0.14, 0.16, s * 0.32, 1.0, 0, steel, 0, 0, s * 0.3);
    b.sphere(0.1, s * 0.34, 1.06, 0, p.plate, 1, 0.7, 1);
  }
  // 塔盾：主体 + 上下缘 + 中央发光缝 + 支撑臂
  b.box(0.74, 0.9, 0.06, 0, 0.66, -0.3, steel, 0.06);
  b.box(0.8, 0.1, 0.09, 0, 1.05, -0.3, p.light, 0.06);
  b.box(0.8, 0.09, 0.09, 0, 0.28, -0.3, p.dark, 0.06);
  b.box(0.08, 0.62, 0.03, 0, 0.66, -0.34, p.glow, 0.06);
  b.cyl(0.04, 0.05, 0.22, 6, 0.16, 0.72, -0.16, p.dark, 0, 0, 0.9);
  leg(b, -0.17, p.base, p.dark, 0.03);
  leg(b, 0.17, p.base, p.dark, 0.03);
  return { geometry: b.build(), material: enemyMaterial(0.55, 0.35), height: 1.5 };
}

function buildBerserker(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  const blade = shade(0xff5a5a, 1.5);
  b.taper(0.22, 0.26, 0.26, 0, 0.68, 0.02, p.dark);
  b.taper(0.24, 0.2, 0.36, 0, 0.92, -0.04, p.base, 0.24);
  b.box(0.26, 0.12, 0.2, 0, 1.0, -0.1, p.plate, 0.24);
  // 低伏的头 + 双眼
  b.taper(0.17, 0.14, 0.15, 0, 1.14, -0.2, p.dark, 0.4);
  for (const s of [-1, 1]) b.sphere(0.03, s * 0.055, 1.17, -0.28, p.glow);
  // 后掠背刺
  for (let i = 0; i < 6; i++) {
    b.cone(0.038, 0.26 - i * 0.02, 4, (i - 2.5) * 0.055, 1.06 - i * 0.055, 0.1 + i * 0.03, blade, -1.0 + i * 0.08);
  }
  // 长臂 + 前臂刀
  for (const s of [-1, 1]) {
    b.taper(0.09, 0.07, 0.1, s * 0.2, 1.02, -0.04, p.plate, 0, 0, s * 0.25);
    b.taper(0.06, 0.05, 0.24, s * 0.245, 0.88, -0.1, p.base, 0.5, 0, s * 0.12);
    b.taper(0.05, 0.04, 0.22, s * 0.27, 0.7, -0.24, p.dark, 0.9);
    for (let k = -1; k <= 1; k++) b.cone(0.022, 0.2, 4, s * 0.29 + k * 0.034, 0.55, -0.34, blade, 1.9);
  }
  leg(b, -0.11, p.base, p.dark, 0.02);
  leg(b, 0.11, p.base, p.dark, 0.02);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.45 };
}

function buildCaster(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  // 长袍三层（下摆最大）+ 肩披
  b.taper(0.42, 0.56, 0.34, 0, 0.2, 0, p.dark);
  b.taper(0.34, 0.46, 0.34, 0, 0.5, 0, p.base);
  b.taper(0.28, 0.36, 0.32, 0, 0.8, 0, p.base, 0.02);
  b.taper(0.4, 0.3, 0.12, 0, 1.0, 0, p.plate);
  // 兜帽 + 阴影中的脸
  b.cone(0.24, 0.34, 8, 0, 1.24, 0, p.dark, 0.06);
  b.taper(0.19, 0.22, 0.16, 0, 1.14, -0.03, p.dark, 0.1);
  b.sphere(0.055, 0, 1.15, -0.15, p.glow);
  // 袖 + 手
  for (const s of [-1, 1]) {
    b.taper(0.13, 0.09, 0.26, s * 0.24, 0.86, -0.04, p.base, 0.25, 0, s * 0.22);
    b.sphere(0.045, s * 0.27, 0.72, -0.12, p.plate);
  }
  // 法杖 + 悬浮法球（带三根托刺）
  b.cyl(0.022, 0.028, 1.35, 6, 0.34, 0.72, -0.08, p.dark, 0, 0, 0.1);
  b.sphere(0.09, 0.38, 1.36, -0.08, p.glow);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.cone(0.018, 0.1, 4, 0.38 + Math.cos(a) * 0.07, 1.36, -0.08 + Math.sin(a) * 0.07, p.light, 0, a, 1.2);
  }
  // 袍下露出的脚
  b.box(0.11, 0.06, 0.16, -0.1, 0.03, -0.03, p.dark);
  b.box(0.11, 0.06, 0.16, 0.1, 0.03, -0.03, p.dark);
  return { geometry: b.build(), material: enemyMaterial(0.7, 0.05), height: 1.5 };
}

/**
 * 敌人材质：在标准材质上注入顶点级行走动画。
 * 敌人是"合并后的单网格"，没有骨骼，所以用着色器按局部坐标分区做关节旋转。
 * 好处是零 draw call 增量、零 CPU 骨骼开销，同时摆脱"滑动木头人"的僵硬感。
 */
const ANIM_UNIFORMS = /* glsl */ `
uniform float uPhase;
uniform float uMove;
uniform float uAttack;
uniform float uHit;
`;

/**
 * 关节旋转而不是顶点平移：绕髋（y=0.56）/肩（y=0.92）的 X 轴铰链旋转，
 * 再做区域权重混合（smoothstep），所以四肢是"摆"而不是"被拉长"。
 * 另外叠加：躯干重心转移、呼吸、受击后仰、出手前倾。
 */
const ANIM_BODY = /* glsl */ `
  #include <begin_vertex>

  vec3 rotX(vec3 p, float ang, float pivotY) {
    float c = cos(ang), s = sin(ang);
    float dy = p.y - pivotY;
    p.y = pivotY + dy * c - p.z * s;
    p.z = dy * s + p.z * c;
    return p;
  }

  float eSide = sign(transformed.x + 0.00001);
  float swing = sin(uPhase) * uMove;

  // 腿：绕髋反相摆动（前后跨步）+ 小腿回勾
  float legW = smoothstep(0.62, 0.34, transformed.y);
  float kneeW = smoothstep(0.34, 0.12, transformed.y);
  vec3 legPos = rotX(transformed, swing * 0.62 * eSide, 0.56);
  legPos = rotX(legPos, max(0.0, -swing * eSide) * 0.5 * kneeW, 0.3);
  transformed = mix(transformed, legPos, legW);

  // 手臂：绕肩摆动，与同侧腿反相
  float armW = smoothstep(0.66, 0.80, transformed.y) * smoothstep(0.10, 0.19, abs(transformed.x));
  vec3 armPos = rotX(transformed, -swing * 0.55 * eSide, 0.92);
  transformed = mix(transformed, armPos, armW);

  // 躯干：随步伐左右扭 + 重心上下起伏
  transformed.y += abs(swing) * 0.022 * smoothstep(0.85, 1.15, transformed.y);
  transformed.x += sin(uPhase) * 0.014 * armW;

  // 呼吸 / 受击后仰 / 出手前倾
  float upper = smoothstep(0.55, 1.15, transformed.y);
  transformed.y += sin(uPhase * 0.55) * 0.012 * upper;
  transformed.z -= uHit * 0.09 * upper;
  transformed.z += uAttack * 0.2 * upper;
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
    shader.uniforms.uHit = { value: 0 };
    shader.vertexShader = ANIM_UNIFORMS + shader.vertexShader.replace('#include <begin_vertex>', ANIM_BODY);
    // 轮廓光：让低多边形敌人在草地/雾里仍有清晰剪影（顶点色染色）
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       float rim = pow(1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0), 2.0);
       totalEmissiveRadiance += vColor.rgb * rim * 0.7;`
    );
    mat.userData.anim = shader.uniforms;
  };
  return mat;
}

function buildHealer(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  // 长袍 + 躯干 + 兜帽
  b.taper(0.3, 0.44, 0.34, 0, 0.17, 0, p.dark);
  b.taper(0.24, 0.32, 0.34, 0, 0.5, 0, p.base);
  b.taper(0.2, 0.26, 0.28, 0, 0.8, 0, p.base, 0.02);
  b.cone(0.19, 0.3, 7, 0, 1.1, 0, p.plate, 0.06);
  b.sphere(0.16, 0, 1.02, 0, p.light);
  // 浮空治疗球 + 光环
  b.sphere(0.12, 0.36, 0.92, 0.02, p.glow);
  b.taper(0.2, 0.2, 0.04, 0, 1.28, 0, p.plate);
  for (const s of [-1, 1]) b.taper(0.08, 0.06, 0.26, s * 0.2, 0.84, -0.02, p.plate, 0.22, 0, s * 0.2);
  leg(b, -0.09, p.base, p.dark, 0.01);
  leg(b, 0.09, p.base, p.dark, 0.01);
  return { geometry: b.build(), material: enemyMaterial(), height: 1.4 };
}

function buildTurret(color: number): EnemyTemplate {
  const b = new Builder();
  const p = palette(color);
  // 基座 + 转塔 + 炮管罩 + 炮管
  b.cyl(0.58, 0.74, 0.5, 8, 0, 0.25, 0, p.dark);
  b.cyl(0.44, 0.5, 0.72, 8, 0, 0.86, 0, p.base);
  b.box(0.56, 0.24, 1.0, 0, 1.05, -0.28, p.plate, 0.18);
  b.cyl(0.08, 0.1, 1.0, 6, 0, 1.08, -0.78, p.dark, -Math.PI / 2, 0, 0);
  b.sphere(0.12, 0, 1.26, -0.06, p.glow);
  for (const s of [-1, 1]) b.box(0.18, 0.42, 0.18, s * 0.52, 0.4, 0.22, p.plate);
  return { geometry: b.build(), material: enemyMaterial(0.6, 0.4), height: 1.35 };
}

const builders: Record<EnemyKind, (color: number) => EnemyTemplate> = {
  chaser: buildChaser,
  boomer: buildBoomer,
  spitter: buildSpitter,
  guard: buildGuard,
  berserker: buildBerserker,
  caster: buildCaster,
  healer: buildHealer,
  turret: buildTurret,
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
