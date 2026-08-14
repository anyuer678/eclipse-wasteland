/**
 * campaign/boss — BOSS 个体。
 *
 * 程序化生成的大型单位（不加载外部资源），带 4 技能循环：
 *   冲撞 / 范围践踏 / 召唤小怪 / 近战挥击
 * 技能按固定间隔轮换，随机性由注入的 Rng 控制。
 */
import * as THREE from 'three';
import { solid } from '../render';
import type { BossSpec } from './types';

export type BossSkill = 'charge' | 'stomp' | 'summon' | 'swipe';

export class Boss {
  readonly spec: BossSpec;
  readonly root: THREE.Group;
  hp: number;
  alive = true;
  /** 距离玩家过近（近战判定） */
  readonly meleeRange = 3.2;

  private skillTimer: number;
  private summonCount = 0;
  private meleeCooldown = 0;

  constructor(spec: BossSpec, private rng: { pick: <T>(a: readonly T[]) => T }) {
    this.spec = spec;
    this.hp = spec.hp;
    this.root = this.buildMesh(spec);
    this.root.position.set(0, 0, -8);
    this.skillTimer = 2;
  }

  private buildMesh(spec: BossSpec): THREE.Group {
    const g = new THREE.Group();
    const mat = solid(spec.color, { roughness: 0.5, metalness: 0.3 });

    // 巨大躯干（胶囊放大）
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 1.6, 6, 14), mat);
    body.position.y = 1.8;
    g.add(body);

    // 头（带角）
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 14), mat);
    head.position.set(0, 3.4, -0.6);
    g.add(head);
    const hornMat = solid(0x3a2a4d);
    for (const side of [-0.5, 0.5]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), hornMat);
      horn.position.set(side, 3.9, -0.9);
      horn.rotation.z = side * 0.5;
      g.add(horn);
    }

    // 眼睛（发光）
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5533 });
    for (const side of [-0.28, 0.28]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), eyeMat);
      eye.position.set(side, 3.5, -1.15);
      g.add(eye);
    }

    // 手臂（粗壮方块）
    const armMat = solid(0x2a1a3d);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.6), armMat);
      arm.position.set(side * 1.6, 2.0, 0);
      arm.rotation.z = side * 0.12;
      g.add(arm);
    }

    g.userData.boss = this;
    return g;
  }

  /** 挂载开源模型（替换程序化躯干，放大为 BOSS 尺寸） */
  applyModel(group: THREE.Group): void {
    for (const child of [...this.root.children]) this.root.remove(child);
    // BOSS 缩放：Soldier 原始约 1.9m，目标 2.5m（固定比例，避免 Box3 偏小导致过大）
    group.scale.setScalar(2.5 / 1.9);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && mat.color) {
          mat.color.setHex(this.spec.color);
          mat.roughness = 0.5;
          mat.metalness = 0.3;
        }
      }
    });
    group.position.y = 0;
    this.root.add(group);
  }

  /**
   * 每逻辑帧推进：面向玩家移动 + 技能轮换。
   * 返回本帧产生的技能效果（供玩家系统结算伤害/召唤）。
   */
  update(dt: number, playerPos: THREE.Vector3): {
    skill?: BossSkill;
    melee?: number;
    chargeDir?: THREE.Vector3;
    stompRadius?: number;
    summon?: number;
  } | null {
    if (!this.alive) return null;
    const spec = this.spec;

    // 面向玩家
    this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.root.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.normalize() : new THREE.Vector3();

    // 近战挥击（带冷却）
    this.meleeCooldown -= dt;
    if (dist < this.meleeRange && this.meleeCooldown <= 0) {
      this.meleeCooldown = 1.1;
      return { skill: 'swipe', melee: 10 };
    }

    // 缓慢逼近
    this.root.position.addScaledVector(dir, 1.3 * dt);

    // 技能轮换
    this.skillTimer -= dt;
    if (this.skillTimer <= 0) {
      this.skillTimer = spec.skillInterval;
      const pick = this.rng.pick<BossSkill>(['charge', 'stomp', 'summon']);
      if (pick === 'charge') {
        return { skill: 'charge', chargeDir: dir.clone() };
      }
      if (pick === 'stomp') {
        return { skill: 'stomp', stompRadius: 6 };
      }
      // summon
      this.summonCount += 1;
      return { skill: 'summon', summon: 2 + (this.summonCount % 2) };
    }

    return null;
  }

  /** 受伤，返回是否死亡 */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  center(): THREE.Vector3 {
    return this.root.position.clone().add(new THREE.Vector3(0, 2.2, 0));
  }
}
