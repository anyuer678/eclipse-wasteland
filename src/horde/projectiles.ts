/**
 * horde/projectiles — 敌人远程弹丸（真飞行物）。
 *
 * 旧实现"出手即命中"只画一条示警线；现在弹丸真实飞行（速度可调、带重力下坠），
 * 命中判定按弹丸与玩家实际距离——前摇 + 飞行时间给了真正的闪避窗口。
 * 弹丸数量少（同屏 <15），每个一个共享几何的 Mesh 即可，无需 InstancedMesh。
 */
import * as THREE from 'three';
import type { Fx } from '../render/fx';

interface Proj {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  color: number;
}

const HIT_RADIUS = 0.95;
const GRAVITY = 9;

export class ProjectilePool {
  private readonly scene: THREE.Scene;
  private readonly fx: Fx;
  private readonly geo = new THREE.SphereGeometry(0.09, 8, 6);
  private readonly mats = new Map<number, THREE.MeshBasicMaterial>();
  private readonly items: Proj[] = [];

  constructor(scene: THREE.Scene, fx: Fx) {
    this.scene = scene;
    this.fx = fx;
  }

  private mat(color: number): THREE.MeshBasicMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.mats.set(color, m);
    }
    return m;
  }

  /** 发射一枚弹丸：from → to（发射瞬间锁定的目标点），带轻微下坠 */
  spawn(from: THREE.Vector3, to: THREE.Vector3, color: number, speed: number, damage: number): void {
    const dist = from.distanceTo(to);
    const flight = Math.max(0.25, dist / speed);
    const mesh = new THREE.Mesh(this.geo, this.mat(color));
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.items.push({
      mesh,
      vx: (to.x - from.x) / flight,
      // 重力补偿必须与 update 中的 g 一致：Δy/T + gT/2，否则远距离会全部砸地
      vy: (to.y - from.y) / flight + 0.5 * GRAVITY * flight,
      vz: (to.z - from.z) / flight,
      life: flight + 0.5,
      damage,
      color,
    });
  }

  /**
   * 每帧推进：命中玩家返回伤害并出火花；超时/落地自灭。
   * 返回本帧对玩家造成的总伤害（由调用方统一结算 HUD/音效）。
   */
  update(dt: number, playerPos: THREE.Vector3, groundAt?: (x: number, z: number) => number): number {
    let damage = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      const m = p.mesh;
      m.position.x += p.vx * dt;
      m.position.y += p.vy * dt;
      m.position.z += p.vz * dt;
      p.vy -= GRAVITY * dt;
      const dx = m.position.x - playerPos.x;
      const dy = m.position.y - (playerPos.y + 1.2);
      const dz = m.position.z - playerPos.z;
      if (dx * dx + dy * dy + dz * dz < HIT_RADIUS * HIT_RADIUS) {
        damage += p.damage;
        this.fx.emit(m.position, p.color, 5, 2.4);
        this.remove(i);
        continue;
      }
      // 落地/钻进山坡即消失：否则弹丸会穿地形继续飞
      if (groundAt && m.position.y < groundAt(m.position.x, m.position.z) + 0.02) {
        this.fx.emit(m.position, p.color, 3, 1.6);
        this.remove(i);
        continue;
      }
      if (p.life <= 0) {
        this.fx.emit(m.position, p.color, 3, 1.6);
        this.remove(i);
      }
    }
    return damage;
  }

  private remove(i: number): void {
    this.scene.remove(this.items[i].mesh);
    this.items.splice(i, 1);
  }

  clear(): void {
    for (const p of this.items) this.scene.remove(p.mesh);
    this.items.length = 0;
  }
}
