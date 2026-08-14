/**
 * arsenal/viewmodel — 第一人称枪模。
 *
 * 优先加载开源 GLB 枪械模型（CC0 fps-asset-kit，public/models/gun_*.glb），
 * 加载失败回退代码生成的程序化枪模。
 * 挂在相机下，随开火有后坐抖动。
 */
import * as THREE from 'three';
import type { Archetype } from './defs';

const GUN_POS = new THREE.Vector3(0.32, -0.26, -0.52);

/** archetype → 模型文件（public/models/） */
const GUN_MODELS: Record<Archetype, string> = {
  rifle: 'gun_rifle',
  shotgun: 'gun_shotgun',
  pistol: 'gun_pistol',
  smg: 'gun_smg',
  sniper: 'gun_sniper',
};

export class Viewmodel {
  readonly group: THREE.Group;
  private kick = 0;
  private recoil = 0;

  constructor(archetype: Archetype, color: number, loadGun?: (name: string, onDone: (g: THREE.Group) => void) => void) {
    this.group = new THREE.Group();
    this.buildProc(archetype, color);
    this.group.position.copy(GUN_POS);

    const name = GUN_MODELS[archetype];
    loadGun?.(name, (src) => this.mountModel(src));
  }

  /** 挂载开源 GLB 枪模（替换程序化兜底） */
  private mountModel(src: THREE.Group): void {
    // 先完成全部计算，成功后再替换（避免失败时清空枪模）
    try {
      const m = src.clone();
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((x) => x.clone());
          else if (mesh.material) mesh.material = (mesh.material as THREE.Material).clone();
        }
      });
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const s = 0.55 / longest;
      m.scale.setScalar(s);
      // 朝向：Flat Guns 模型长轴沿 +z → 转 180° 使枪口朝 -z（射击方向）
      const holder = new THREE.Group();
      holder.add(m);
      holder.rotation.y = Math.PI;
      const bb = new THREE.Box3().setFromObject(holder);
      const c = bb.getCenter(new THREE.Vector3());
      holder.position.set(-c.x, -c.y, -c.z + 0.12);
      // 全部成功：清除程序化兜底，挂载模型
      while (this.group.children.length) this.group.remove(this.group.children[0]);
      this.group.add(holder);
    } catch {
      // 加载/计算失败：保留程序化兜底枪模
    }
  }

  /** 程序化兜底枪模 */
  private buildProc(archetype: Archetype, color: number): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5, metalness: 0.45 });
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x66e0ff });

    const g = this.group;

    const scale: Record<Archetype, { barrel: number; bodyW: number; bodyL: number }> = {
      rifle: { barrel: 0.55, bodyW: 0.07, bodyL: 0.34 },
      shotgun: { barrel: 0.5, bodyW: 0.09, bodyL: 0.3 },
      pistol: { barrel: 0.22, bodyW: 0.06, bodyL: 0.2 },
      smg: { barrel: 0.3, bodyW: 0.07, bodyL: 0.26 },
      sniper: { barrel: 0.85, bodyW: 0.06, bodyL: 0.4 },
    };
    const s = scale[archetype];

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, s.barrel, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -s.barrel / 2 - 0.08);
    g.add(barrel);

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(s.bodyW, s.bodyW * 1.4, s.bodyL), body);
    bodyMesh.position.set(0, 0.01, 0);
    g.add(bodyMesh);

    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 8, 16), glow);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.015, -s.barrel - 0.08);
    g.add(muzzle);

    if (archetype === 'shotgun') {
      for (const side of [-0.03, 0.03]) {
        const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, s.barrel, 8), dark);
        b2.rotation.x = Math.PI / 2;
        b2.position.set(side, 0.015, -s.barrel / 2 - 0.08);
        g.add(b2);
      }
    }
    if (archetype === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.07, -0.05);
      g.add(scope);
    }
    if (archetype === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.06), dark);
      mag.position.set(0, -0.08, 0.05);
      g.add(mag);
    }

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.07), dark);
    grip.position.set(0, -0.1, 0.08);
    grip.rotation.x = -0.5;
    g.add(grip);
  }

  /** 记录一次后坐 */
  kickNow(amount = 1): void {
    this.kick = Math.min(this.kick + amount, 2);
  }

  /** 每帧平滑回弹 */
  update(dt: number): void {
    this.kick = Math.max(0, this.kick - dt * 8);
    this.recoil = Math.max(0, this.recoil - dt * 10);
    this.group.position.z = GUN_POS.z + this.kick * 0.03;
    this.group.rotation.x = this.kick * 0.12;
    this.group.position.y = GUN_POS.y - this.recoil * 0.02;
  }
}
