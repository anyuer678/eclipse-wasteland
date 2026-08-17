/**
 * campaign/boss — BOSS 个体。
 *
 * 程序化生成的大型单位（不加载外部资源），带 4 技能循环：
 *   冲撞 / 范围践踏 / 召唤小怪 / 近战挥击
 * 技能按固定间隔轮换，随机性由注入的 Rng 控制。
 */
import * as THREE from 'three';
import { solid } from '../render';
import type { BossSpec, Element } from './types';

export type BossSkill = 'charge' | 'stomp' | 'summon' | 'swipe' | 'aoe_blast' | 'summon_elite';

export class Boss {
  readonly spec: BossSpec;
  readonly root: THREE.Group;
  hp: number;
  alive = true;
  /** 距离玩家过近（近战判定） */
  readonly meleeRange = 3.2;
  /** 当前阶段（0=初始，1+=转阶段） */
  phase = 0;
  /** 元素抗性 */
  readonly resistance: Record<Element, number>;

  private skillTimer: number;
  private summonCount = 0;
  private meleeCooldown = 0;

  constructor(spec: BossSpec, private rng: { pick: <T>(a: readonly T[]) => T }) {
    this.spec = spec;
    this.hp = spec.hp;
    this.root = this.buildMesh(spec);
    this.root.position.set(0, 0, -8);
    this.skillTimer = 2;
    this.resistance = spec.resistance ?? { physical: 0, fire: 0, ice: 0, energy: 0 };
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
  /** 冲锋状态 */
  private charging = false;
  private chargeTimer = 0;
  private chargeDir = new THREE.Vector3();
  /** 践踏状态 */
  private stomping = false;
  private stompTimer = 0;
  /** 召唤冷却 */
  private summonCooldown = 0;

  update(dt: number, playerPos: THREE.Vector3): {
    skill?: BossSkill;
    melee?: number;
    chargeDir?: THREE.Vector3;
    stompRadius?: number;
    summon?: number;
  } | null {
    if (!this.alive) return null;

    this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.root.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.normalize() : new THREE.Vector3();

    // 冲锋中
    if (this.charging) {
      this.chargeTimer -= dt;
      this.root.position.addScaledVector(this.chargeDir, 14 * dt);
      if (this.chargeTimer <= 0) {
        this.charging = false;
        if (dist < 4) return { skill: 'charge', melee: 18 + this.phase * 5, chargeDir: this.chargeDir };
      }
      return null;
    }

    // 践踏中（跳跃砸地）
    if (this.stomping) {
      this.stompTimer -= dt;
      this.root.position.y = Math.sin(this.stompTimer * 10) * 2.5;
      if (this.stompTimer <= 0) {
        this.stomping = false;
        this.root.position.y = 0;
        return { skill: 'stomp', stompRadius: 6 + this.phase * 2 };
      }
      return null;
    }

    // 近战挥击
    this.meleeCooldown -= dt;
    if (dist < this.meleeRange && this.meleeCooldown <= 0) {
      this.meleeCooldown = 1.1;
      return { skill: 'swipe', melee: 12 + this.phase * 3 };
    }

    this.summonCooldown -= dt;
    const moveSpeed = 1.3 + this.phase * 0.4;
    this.root.position.addScaledVector(dir, moveSpeed * dt);

    // 技能轮换
    this.skillTimer -= dt;
    if (this.skillTimer <= 0) {
      this.skillTimer = this.spec.skillInterval * (this.phase > 0 ? 0.7 : 1);
      const pool: BossSkill[] = this.phase > 0
        ? ['charge', 'stomp', 'summon', 'aoe_blast', 'summon_elite']
        : ['charge', 'stomp', 'summon'];
      const pick = this.rng.pick<BossSkill>(pool);

      if (pick === 'charge' && dist > 3) {
        this.charging = true;
        this.chargeTimer = 0.55;
        this.chargeDir.copy(dir);
        this.flashBoss(0xff6600);
        return { skill: 'charge', chargeDir: dir.clone() };
      }
      if (pick === 'stomp') {
        this.stomping = true;
        this.stompTimer = 0.45;
        this.flashBoss(0xffaa00);
        return { skill: 'stomp', stompRadius: 6 + this.phase * 2 };
      }
      if (pick === 'aoe_blast') {
        this.flashBoss(0xff0066);
        return { skill: 'aoe_blast', stompRadius: 8 + this.phase * 3 };
      }
      if (pick === 'summon_elite' && this.summonCooldown <= 0) {
        this.summonCooldown = 5;
        this.flashBoss(0x8800ff);
        return { skill: 'summon_elite', summon: 1 };
      }
      if (this.summonCooldown <= 0) {
        this.summonCooldown = 3;
        this.summonCount += 1;
        return { skill: 'summon', summon: 2 + (this.summonCount % 2) + this.phase };
      }
    }

    return null;
  }

  /** 按元素类型受伤，返回是否死亡 */
  takeDamage(amount: number, element: Element = 'physical'): boolean {
    if (!this.alive) return false;
    const res = this.resistance[element] ?? 0;
    // 抗性 0/1/2/3 → 减伤 0%/15%/35%/55%
    const reduction = res === 0 ? 0 : res === 1 ? 0.15 : res === 2 ? 0.35 : 0.55;
    const finalDmg = amount * (1 - reduction);
    this.hp -= finalDmg;
    // 阶段转换检查
    this.checkPhaseTransition();
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  private checkPhaseTransition(): void {
    const thresholds = this.spec.phaseThresholds;
    if (!thresholds || thresholds.length === 0) return;
    const hpPct = this.hp / this.spec.hp;
    for (let i = this.phase; i < thresholds.length; i++) {
      if (hpPct <= thresholds[i]) {
        this.phase = i + 1;
        // 阶段转换：加速技能 + 变色
        this.skillTimer = Math.min(this.skillTimer, 1.5);
        this.flashBoss(0xff0000);
        break;
      }
    }
  }

  private flashBoss(color: number): void {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && mat.emissive) {
          mat.emissive.setHex(color);
          setTimeout(() => mat.emissive.setHex(0x000000), 300);
        }
      }
    });
  }

  center(): THREE.Vector3 {
    return this.root.position.clone().add(new THREE.Vector3(0, 2.2, 0));
  }
}
