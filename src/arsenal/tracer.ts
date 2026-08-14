/**
 * arsenal/tracer — 弹道亮线特效。
 *
 * 用户决策：弹道用简单亮线。为提升可见性：
 *   - 双线叠加：亮色主线 + 偏移暗色副线，制造体积感
 *   - 命中火花：命中点短暂闪烁的小十字
 * 全部对象池化复用。
 */
import * as THREE from 'three';

interface ActiveLine {
  line: THREE.Line;
  life: number;
  maxLife: number;
}

interface ActiveSpark {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export class TracerPool {
  private linePool: THREE.Line[] = [];
  private sparkPool: THREE.Mesh[] = [];
  private activeLines: ActiveLine[] = [];
  private activeSparks: ActiveSpark[] = [];
  private readonly world: THREE.Scene;
  private readonly life: number;

  constructor(world: THREE.Scene, life = 0.16) {
    this.world = world;
    this.life = life;
  }

  /** 发射一条弹道亮线：from → to，双线叠加，命中点附火花。颜色自动提亮适配深色场景 */
  fire(from: THREE.Vector3, to: THREE.Vector3, color: number, intensity = 1): void {
    const bright = new THREE.Color(color).offsetHSL(0, 0, 0.16);
    const main = this.acquireLine();
    this.writeLine(main, from, to);
    (main.material as THREE.LineBasicMaterial).color.copy(bright);
    (main.material as THREE.LineBasicMaterial).opacity = Math.min(1, intensity);
    main.visible = true;
    this.activeLines.push({ line: main, life: this.life * (0.5 + intensity * 0.5), maxLife: this.life });

    // 副线（偏移制造体积感）
    const offset = new THREE.Vector3(0.018, 0.018, 0);
    const sub = this.acquireLine();
    this.writeLine(sub, from.clone().add(offset), to.clone().add(offset));
    (sub.material as THREE.LineBasicMaterial).color.setHex(0x000000);
    (sub.material as THREE.LineBasicMaterial).opacity = Math.min(0.5, intensity * 0.5);
    sub.visible = true;
    this.activeLines.push({ line: sub, life: this.life * 0.7, maxLife: this.life });

    // 命中火花
    const spark = this.acquireSpark();
    spark.position.copy(to);
    spark.visible = true;
    this.activeSparks.push({ mesh: spark, life: 0.22, maxLife: 0.22 });
  }

  /** 每帧更新：淡出并回收 */
  update(dt: number): void {
    for (let i = this.activeLines.length - 1; i >= 0; i--) {
      const a = this.activeLines[i];
      a.life -= dt;
      if (a.life <= 0) {
        a.line.visible = false;
        this.activeLines.splice(i, 1);
        this.linePool.push(a.line);
      } else {
        (a.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, a.life / a.maxLife);
      }
    }
    for (let i = this.activeSparks.length - 1; i >= 0; i--) {
      const s = this.activeSparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.activeSparks.splice(i, 1);
        this.sparkPool.push(s.mesh);
      } else {
        const t = s.life / s.maxLife;
        s.mesh.scale.setScalar(0.4 + t * 1.4);
      }
    }
  }

  private writeLine(line: THREE.Line, from: THREE.Vector3, to: THREE.Vector3): void {
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
  }

  private acquireLine(): THREE.Line {
    const line = this.linePool.pop();
    if (line) return line;
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 1, depthWrite: false });
    const l = new THREE.Line(geom, mat);
    l.frustumCulled = false;
    this.world.add(l);
    return l;
  }

  private acquireSpark(): THREE.Mesh {
    const spark = this.sparkPool.pop();
    if (spark) return spark;
    // 十字火花（两个交叉薄片）
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.95, depthWrite: false });
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), mat);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mat);
    group.add(h, v);
    this.world.add(group);
    return group as unknown as THREE.Mesh;
  }
}
