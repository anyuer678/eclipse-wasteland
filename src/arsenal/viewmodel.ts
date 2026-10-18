/**
 * arsenal/viewmodel — 第一人称枪模（程序化精修版）。
 *
 * 说明：仓库里的 gun_*.glb 是「Flat Guns」低模，为远距离/俯视展示设计，
 * 拉到持枪视角后只剩几块黑色多边形，反而更粗糙。这里改成按枪型手工搭的
 * 程序化枪模：机匣 / 护木 / 枪管 / 弹匣 / 握把 / 枪托 / 瞄具，
 * 再补上两只戴手套的手，配合待机呼吸、行走晃动、开火后坐与枪口火光。
 */
import * as THREE from 'three';
import type { Archetype } from './defs';

/** 基准位置：偏右下，整枪落在视野内 */
const BASE_POS = new THREE.Vector3(0.185, -0.162, -0.34);

/** 枪口火光贴图（星芒 + 径向渐变） */
function flashTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,236,1)');
  g.addColorStop(0.22, 'rgba(255,224,150,0.85)');
  g.addColorStop(0.55, 'rgba(255,160,60,0.28)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    const sg = ctx.createLinearGradient(0, 0, size * 0.46, 0);
    sg.addColorStop(0, 'rgba(255,240,200,0.9)');
    sg.addColorStop(1, 'rgba(255,170,80,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, -3.4);
    ctx.lineTo(size * 0.46, 0);
    ctx.lineTo(0, 3.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 各枪型的尺寸参数（单位：米，-z 为枪口方向，原点在握把上方） */
interface GunSpec {
  receiver: number;
  handguard: number;
  barrel: number;
  mag: number;
  stock: number;
  optic: boolean;
  bodyW: number;
  barrelR: number;
  pump?: boolean;
  muzzleZ: number;
}

const SPECS: Record<Archetype, GunSpec> = {
  rifle: { receiver: 0.26, handguard: 0.24, barrel: 0.2, mag: 0.12, stock: 0.16, optic: true, bodyW: 0.078, barrelR: 0.012, muzzleZ: -0.62 },
  shotgun: { receiver: 0.22, handguard: 0.2, barrel: 0.3, mag: 0, stock: 0.15, optic: false, bodyW: 0.086, barrelR: 0.019, pump: true, muzzleZ: -0.64 },
  pistol: { receiver: 0.17, handguard: 0.07, barrel: 0.06, mag: 0.07, stock: 0, optic: false, bodyW: 0.062, barrelR: 0.011, muzzleZ: -0.33 },
  smg: { receiver: 0.2, handguard: 0.12, barrel: 0.09, mag: 0.16, stock: 0.1, optic: false, bodyW: 0.072, barrelR: 0.012, muzzleZ: -0.42 },
  sniper: { receiver: 0.28, handguard: 0.26, barrel: 0.36, mag: 0.1, stock: 0.2, optic: true, bodyW: 0.072, barrelR: 0.011, muzzleZ: -0.78 },
};

export class Viewmodel {
  readonly group: THREE.Group;
  /** 枪 + 手 + 火光都挂这里，便于统一施加摆动 */
  private readonly holder: THREE.Group;
  private readonly flash: THREE.Sprite;
  private kick = 0;
  private reloadT = 0;
  private bobPhase = 0;
  private motion = 0;
  private time = 0;
  private flashT = 0;
  /** 视角摆动：武器滞后于鼠标，随时间回弹 */
  private swayX = 0;
  private swayY = 0;

  constructor(archetype: Archetype, color: number) {
    this.group = new THREE.Group();
    this.group.position.copy(BASE_POS);
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(0.92);
    this.group.add(this.holder);

    this.buildGun(archetype, color);
    this.buildHands(archetype);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0,
      })
    );
    this.flash.position.set(0, 0.01, SPECS[archetype].muzzleZ - 0.01);
    this.flash.scale.setScalar(0.3);
    this.holder.add(this.flash);
  }

  /** 程序化枪模：按枪型搭机匣/护木/枪管/弹匣/握把/枪托/瞄具 */
  private buildGun(archetype: Archetype, color: number): void {
    const spec = SPECS[archetype];
    const g = new THREE.Group();
    g.userData.procGun = true;

    const steel = new THREE.MeshStandardMaterial({ color: 0x3f454d, roughness: 0.42, metalness: 0.72 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x272b31, roughness: 0.78, metalness: 0.12 });
    const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.45 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xff9a4a });

    const bw = spec.bodyW;
    // 机匣
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(bw, bw * 1.05, spec.receiver), steel);
    receiver.position.set(0, 0.004, -spec.receiver * 0.42);
    g.add(receiver);
    // 上导轨
    const rail = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.62, 0.012, spec.receiver * 0.72), polymer);
    rail.position.set(0, bw * 0.56, -spec.receiver * 0.5);
    g.add(rail);
    // 护木 + 侧槽
    const hgLen = spec.handguard;
    const hg = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.82, bw * 0.86, hgLen), polymer);
    hg.position.set(0, 0.002, -spec.receiver * 0.92 - hgLen / 2);
    g.add(hg);
    for (const side of [-1, 1]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.004, bw * 0.24, hgLen * 0.72), accent);
      slot.position.set(side * bw * 0.42, 0.002, -spec.receiver * 0.92 - hgLen / 2);
      g.add(slot);
    }
    // 枪管 + 枪口装置 + 膛口
    const barrelZ = -spec.receiver * 0.92 - hgLen - spec.barrel / 2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrelR, spec.barrelR, spec.barrel, 10), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.006, barrelZ);
    g.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrelR * 1.55, spec.barrelR * 1.4, 0.05, 10), steel);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.006, spec.muzzleZ + 0.025);
    g.add(brake);
    const bore = new THREE.Mesh(new THREE.CircleGeometry(spec.barrelR * 0.7, 10), glow);
    bore.position.set(0, 0.006, spec.muzzleZ + 0.001);
    bore.rotation.y = Math.PI;
    g.add(bore);
    // 弹匣（两段模拟弧度）
    if (spec.mag > 0) {
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.58, spec.mag * 0.6, bw * 0.8), polymer);
      m1.position.set(0, -bw * 0.62, -spec.receiver * 0.34);
      m1.rotation.x = -0.06;
      g.add(m1);
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.54, spec.mag * 0.5, bw * 0.74), polymer);
      m2.position.set(0, -bw * 0.62 - spec.mag * 0.5, -spec.receiver * 0.34 - 0.012);
      m2.rotation.x = -0.2;
      g.add(m2);
    }
    // 握把
    const grip = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.52, 0.1, bw * 0.7), polymer);
    grip.position.set(0, -bw * 0.66, 0.045);
    grip.rotation.x = -0.34;
    g.add(grip);
    // 枪托
    if (spec.stock > 0) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.5, bw * 0.78, spec.stock), polymer);
      stock.position.set(0, -0.004, spec.receiver * 0.52 + spec.stock / 2 - 0.02);
      g.add(stock);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.54, 0.016, spec.stock * 0.6), steel);
      cheek.position.set(0, bw * 0.42, spec.receiver * 0.5 + spec.stock * 0.4);
      g.add(cheek);
    }
    // 瞄具
    if (spec.optic) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.1, 10), steel);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, bw * 0.78, -spec.receiver * 0.34);
      g.add(tube);
      for (const dz of [-0.035, 0.035]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 10), polymer);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, bw * 0.78, -spec.receiver * 0.34 + dz);
        g.add(ring);
      }
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.014, 10), new THREE.MeshBasicMaterial({ color: 0x5fd0ff }));
      glass.position.set(0, bw * 0.78, -spec.receiver * 0.34 - 0.051);
      glass.rotation.y = Math.PI;
      g.add(glass);
    }
    // 霰弹枪的泵动护木
    if (spec.pump) {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.9, bw * 0.72, 0.14), polymer);
      pump.position.set(0, -bw * 0.28, -spec.receiver * 0.92 - hgLen * 0.6);
      g.add(pump);
    }

    this.holder.add(g);
  }

  /**
   * 双手：右手握把、左手托护木。手套 + 腕口 + 前臂，
   * 从画面下方斜插进枪身——这是 FPS 视角"不悬浮"的关键。
   */
  private buildHands(archetype: Archetype): void {
    const spec = SPECS[archetype];
    const glove = new THREE.MeshStandardMaterial({ color: 0x53584b, roughness: 0.88, metalness: 0.04 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x666a58, roughness: 0.92, metalness: 0.02 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5442, roughness: 0.96, metalness: 0 });

    const mkHand = (x: number, y: number, z: number, rotZ: number, rotX: number, mirrored: boolean): THREE.Group => {
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.072, 0.08), glove);
      hand.add(palm);
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.052, 7), glove);
      thumb.position.set(mirrored ? 0.031 : -0.031, 0.03, -0.022);
      thumb.rotation.z = mirrored ? -0.95 : 0.95;
      hand.add(thumb);
      for (let i = 0; i < 3; i++) {
        const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.019, 0.058), glove);
        finger.position.set(mirrored ? -0.025 : 0.025, 0.024 - i * 0.023, -0.008);
        hand.add(finger);
      }
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.039, 0.05, 8), cuff);
      wrist.rotation.x = Math.PI / 2;
      wrist.position.set(0, -0.014, 0.06);
      hand.add(wrist);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.055, 0.3, 8), sleeve);
      arm.rotation.x = Math.PI / 2 - 0.5;
      arm.rotation.z = mirrored ? 0.14 : -0.2;
      arm.position.set(mirrored ? -0.012 : 0.02, -0.1, 0.16);
      hand.add(arm);
      hand.position.set(x, y, z);
      hand.rotation.z = rotZ;
      hand.rotation.x = rotX;
      hand.scale.setScalar(0.78);
      return hand;
    };

    // 右手握把
    this.holder.add(mkHand(0.006, -spec.bodyW * 0.7, 0.05, 0.15, 0.3, false));
    // 左手托护木
    const gripZ = -spec.receiver * 0.92 - spec.handguard * 0.45;
    this.holder.add(mkHand(-0.028, -spec.bodyW * 0.42, gripZ, -0.28, 0.16, true));
  }

  /** 鼠标视角变化时喂入（游戏侧在 player.look 后调用），武器会反向滞后 */
  applyLook(dxPx: number, dyPx: number): void {
    this.swayX = THREE.MathUtils.clamp(this.swayX + dxPx * 0.0011, -0.05, 0.05);
    this.swayY = THREE.MathUtils.clamp(this.swayY + dyPx * 0.0011, -0.04, 0.04);
  }

  /** 记录一次后坐（同时点亮枪口火光） */
  kickNow(amount = 1): void {
    this.kick = Math.min(this.kick + amount, 2);
    this.flashT = 0.05;
    this.flash.material.opacity = Math.min(1, 0.6 + amount * 0.4);
    this.flash.scale.setScalar(0.22 + amount * 0.1 + Math.random() * 0.05);
    this.flash.material.rotation = Math.random() * Math.PI * 2;
  }

  /** 换弹动画（下坠再抬起） */
  reload(): void {
    this.reloadT = 1;
  }

  /** 每帧平滑回弹 + 呼吸/行走晃动 */
  update(dt: number, moving = false): void {
    this.time += dt;
    this.kick = Math.max(0, this.kick - dt * 8);
    this.reloadT = Math.max(0, this.reloadT - dt * 1.7);
    const target = moving ? 1 : 0;
    this.motion += (target - this.motion) * Math.min(1, dt * 7);
    this.bobPhase += dt * (6.5 * this.motion + 0.6);

    const breathe = Math.sin(this.time * 1.35) * 0.0032;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.011 * this.motion;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.009 * this.motion;
    const reloadDip = Math.sin(this.reloadT * Math.PI) * 0.15;

    this.swayX *= Math.exp(-dt * 8);
    this.swayY *= Math.exp(-dt * 8);

    this.group.position.set(
      BASE_POS.x + bobX - this.kick * 0.004 - this.swayX * 0.45,
      BASE_POS.y + breathe + bobY - reloadDip * 0.4 + this.swayY * 0.3,
      BASE_POS.z + this.kick * 0.032
    );
    this.group.rotation.set(
      this.kick * 0.1 + reloadDip * 0.85 + this.swayY * 0.5,
      Math.sin(this.time * 0.7) * 0.005 + this.kick * 0.01 - this.swayX * 0.9,
      -bobX * 0.6 + reloadDip * 0.3
    );

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.material.opacity = 0;
      else this.flash.material.opacity *= 0.7;
    }
  }
}
