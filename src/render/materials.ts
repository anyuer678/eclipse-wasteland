/**
 * render/materials — 程序化材质工厂。
 *
 * 所有纹理在运行时绘制到 <canvas>，零外部资源。
 * 通过不同 painter 生成噪点/条纹/网格/渐变等基础材质，
 * 供地面、墙体、武器、特效复用。
 */
import * as THREE from 'three';

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function makeTexture(size: number, painter: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  painter(ctx, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 单色材质 */
export function solid(color: number, opts: { roughness?: number; metalness?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.1,
  });
}

/** 噪点/斑驳质感（适用于地面与墙面） */
export function noise(color: number, accent: number, opts: { scale?: number; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const tex = makeTexture(128, (ctx, w, h) => {
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, w, h);
    const a = '#' + accent.toString(16).padStart(6, '0');
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 1.6 + 0.3;
      ctx.fillStyle = a;
      ctx.globalAlpha = 0.05 + Math.random() * 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
  tex.repeat.set(opts.scale ?? 8, opts.scale ?? 8);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: opts.roughness ?? 0.95 });
}

/** 条纹材质（用于危险区/标记物） */
export function stripes(colorA: number, colorB: number, opts: { repeat?: number; roughness?: number } = {}): THREE.MeshStandardMaterial {
  const tex = makeTexture(64, (ctx, w, h) => {
    const a = '#' + colorA.toString(16).padStart(6, '0');
    const b = '#' + colorB.toString(16).padStart(6, '0');
    const band = 8;
    for (let y = 0; y < h; y += band) {
      ctx.fillStyle = (y / band) % 2 === 0 ? a : b;
      ctx.fillRect(0, y, w, band);
    }
  });
  tex.repeat.set(opts.repeat ?? 4, opts.repeat ?? 4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: opts.roughness ?? 0.8 });
}

/** 自发光材质（弹道亮线、提示圈、血条装饰等） */
export function emissive(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

/** 渐变纹理（光域/光环贴图） */
export function gradient(inner: number, outer: number): THREE.CanvasTexture {  return makeTexture(128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#' + inner.toString(16).padStart(6, '0'));
    g.addColorStop(1, '#' + outer.toString(16).padStart(6, '0'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
