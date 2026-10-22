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

/** 每帧由 game 注入的导航方向（追击用；冲锋仍走直线） */
export interface BossStepContext {
  navX: number;
  navZ: number;
}

/** 挥臂用的临时轴向量（模块级复用） */
const _swingAxis = new THREE.Vector3(1, 0, 0);

export class Boss {
  readonly spec: BossSpec;
  readonly root: THREE.Group;
  hp: number;
  /** 实际最大生命（关卡按等级/难度缩放后同步；阶段阈值与血条都用它） */
  maxHp: number;
  alive = true;
  /** 距离玩家过近（近战判定） */
  readonly meleeRange = 3.2;
  /** 怪物等级（经验结算 / 等级压制） */
  monsterLevel = 1;
  /** 当前阶段（0=初始，1+=转阶段） */
  phase = 0;
  /** 元素抗性 */
  readonly resistance: Record<Element, number>;

  private skillTimer: number;
  private skillIndex = 0;
  private summonCount = 0;
  private meleeCooldown = 0;

  // 随机器保留为可选参数（旧调用点会传入），当前招式表已改为固定循环
  constructor(spec: BossSpec, _rng?: { pick: <T>(a: readonly T[]) => T }) {
    this.spec = spec;
    this.hp = spec.hp;
    this.maxHp = spec.hp;
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

    // 技能预警圈（贴地红环，随 root 平移/转向，圆形不受朝向影响）
    const ring = new THREE.RingGeometry(0.82, 1, 40);
    ring.rotateX(-Math.PI / 2);
    this.telegraph = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.3, depthWrite: false })
    );
    this.telegraph.position.y = 0.06;
    this.telegraph.visible = false;
    g.add(this.telegraph);

    g.userData.boss = this;
    return g;
  }

  /** 显示预警圈 radius 秒（范围 = 技能半径） */
  private showTelegraph(radius: number, duration: number): void {
    if (!this.telegraph) return;
    this.telegraph.scale.setScalar(radius);
    this.telegraph.visible = true;
    this.telegraphT = duration;
  }

  private tickTelegraph(dt: number): void {
    if (!this.telegraph || this.telegraphT <= 0) return;
    this.telegraphT -= dt;
    const mat = this.telegraph.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.22 + 0.18 * Math.abs(Math.sin(this.telegraphT * 18));
    if (this.telegraphT <= 0) this.telegraph.visible = false;
  }

  /** 动画混合器（开源模型自带 Idle/Walk/Run，接上后 BOSS 不再像雕像） */
  /** 技能预警圈：践踏/弹幕落点可读，玩家有时间走位 */
  private telegraph: THREE.Mesh | null = null;
  private telegraphT = 0;
  private blastWindup = 0;
  private model: THREE.Group | null = null;
  /** 骨骼引用（挥臂动作用；Soldier 是 Mixamo 绑定） */
  private armR: THREE.Object3D | null = null;
  private armL: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private mats: THREE.MeshStandardMaterial[] = [];
  private flash = 0;
  private pose = 0;
  private poseDir = 1;
  private mixer: THREE.AnimationMixer | null = null;
  private actionIdle: THREE.AnimationAction | null = null;
  private actionMove: THREE.AnimationAction | null = null;
  private moveWeight = 0;

  /** 挂载开源模型（替换程序化躯干，放大为 BOSS 尺寸） */
  applyModel(group: THREE.Group, clips: THREE.AnimationClip[] = []): void {
    for (const child of [...this.root.children]) this.root.remove(child);
    // BOSS 缩放：Soldier 原始约 1.9m，目标 3.3m（固定比例，避免 Box3 偏小导致过大）
    group.scale.setScalar(3.3 / 1.9);
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
    this.model = group;
    // 抓骨骼引用（名字来自 glTF 节点，SkeletonUtils.clone 会保留）
    this.armR = group.getObjectByName('mixamorig:RightArm') ?? null;
    this.armL = group.getObjectByName('mixamorig:LeftArm') ?? null;
    this.spine = group.getObjectByName('mixamorig:Spine1') ?? null;
    // 收集克隆后的材质做受击闪红
    this.mats = [];
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !Array.isArray(m) && m.emissive) this.mats.push(m);
    });
    this.bindClips(group, clips);
  }

  /** 绑定 Idle / Walk 剪辑并按移动状态交叉淡化 */
  private bindClips(group: THREE.Group, clips: THREE.AnimationClip[]): void {
    if (clips.length === 0) return;
    const find = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    const idle = find(/idle|breath|stand/i) ?? clips[0];
    const move = find(/walk|run/i) ?? clips[0];
    const mixer = new THREE.AnimationMixer(group);
    this.actionIdle = mixer.clipAction(idle);
    this.actionIdle.play();
    this.actionIdle.setEffectiveWeight(1);
    if (move !== idle) {
      this.actionMove = mixer.clipAction(move);
      this.actionMove.play();
      this.actionMove.setEffectiveWeight(0);
      this.actionMove.timeScale = 1.1;
    }
    this.mixer = mixer;
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
  /** 践踏跳跃离地高度（相对当前地形，不再按世界 y=0 起跳） */
  private stompLift = 0;
  /** 本次冲锋是否已造成接触伤害（防止同一次冲锋重复/漏结算） */
  private chargeHit = false;
  /** 召唤冷却 */
  private summonCooldown = 0;

  /** 调试：动画绑定状态（供压测脚本确认混合器真的在跑） */
  animState(): { bound: boolean; idleRunning: boolean; moveWeight: number; clipTime: number } {
    return {
      bound: !!this.mixer,
      idleRunning: !!this.actionIdle?.isRunning(),
      moveWeight: +this.moveWeight.toFixed(2),
      clipTime: +(this.actionIdle?.time ?? 0).toFixed(2),
    };
  }

  private applyMoveWeight(w: number): void {
    if (!this.actionMove || !this.actionIdle) return;
    const k = Math.max(0, Math.min(1, w));
    this.actionMove.setEffectiveWeight(k);
    this.actionIdle.setEffectiveWeight(1 - k * 0.65);
  }

  update(dt: number, playerPos: THREE.Vector3, ctx?: BossStepContext): {
    skill?: BossSkill;
    melee?: number;
    chargeDir?: THREE.Vector3;
    stompRadius?: number;
    summon?: number;
  } | null {
    if (!this.alive) return null;

    this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);
    // 动画推进放最前面：蓄力/践踏这些早退分支也要继续播
    this.mixer?.update(dt);
    this.tickTelegraph(dt);
    // 受击闪红 + 技能前摇姿态（叠加在骨骼动画之上）
    this.flash = Math.max(0, this.flash - dt * 6);
    const e = this.flash * 0.55;
    for (const m of this.mats) m.emissive.setRGB(e, e * 0.22, e * 0.16);
    this.pose = Math.max(0, this.pose - dt * 3.2);
    if (this.model) this.model.rotation.x = this.pose * 0.32 * this.poseDir;
    // 挥臂：在混合器写完本帧姿态之后做加性旋转（下一帧混合器会重写，不会累积）
    if (this.pose > 0 && this.mixer) {
      const axis = _swingAxis.set(1, 0, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(axis, this.pose * 1.5 * this.poseDir);
      this.armR?.quaternion.multiply(q);
      this.armL?.quaternion.multiply(q);
      if (this.spine) {
        const q2 = new THREE.Quaternion().setFromAxisAngle(axis, this.pose * 0.25 * this.poseDir);
        this.spine.quaternion.multiply(q2);
      }
    }
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.root.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.normalize() : new THREE.Vector3();

    // 弹幕蓄力结束：结算范围伤害（蓄力期间定在原地）
    if (this.blastWindup > 0) {
      this.blastWindup -= dt;
      if (this.blastWindup > 0) return null;
      this.telegraphT = 0;
      if (this.telegraph) this.telegraph.visible = false;
      this.flashBoss(0xff0066);
      if (dist < 8 + this.phase * 3) return { skill: 'aoe_blast', stompRadius: 8 + this.phase * 3 };
      return null;
    }

    // 冲锋中
    if (this.charging) {
      this.chargeTimer -= dt;
      this.root.position.addScaledVector(this.chargeDir, 14 * dt);
      // 身体接触即结算一次；高速冲锋即使冲过头也能命中
      const dNow = Math.hypot(playerPos.x - this.root.position.x, playerPos.z - this.root.position.z);
      if (!this.chargeHit && dNow < 2.4) {
        this.chargeHit = true;
        return { skill: 'charge', melee: 18 + this.phase * 5, chargeDir: this.chargeDir };
      }
      if (this.chargeTimer <= 0) {
        this.charging = false;
        if (!this.chargeHit && dNow < 4) return { skill: 'charge', melee: 18 + this.phase * 5, chargeDir: this.chargeDir };
      }
      return null;
    }

    // 原地（冲锋/践踏/近战）时淡出走路动画
    if (this.charging || this.stomping) {
      this.moveWeight += (0 - this.moveWeight) * Math.min(1, dt * 6);
      this.applyMoveWeight(this.moveWeight);
    }

    // 践踏中（相对当前地形起跳/落地，不能把 y 写死成 0）
    if (this.stomping) {
      this.stompTimer -= dt;
      const t = Math.min(1, Math.max(0, 1 - this.stompTimer / 0.45));
      this.stompLift = Math.sin(t * Math.PI) * 2.5;
      if (this.stompTimer <= 0) {
        this.stomping = false;
        this.stompLift = 0;
        return { skill: 'stomp', stompRadius: 6 + this.phase * 2 };
      }
      return null;
    }

    // 近战挥击
    this.meleeCooldown -= dt;
    if (dist < this.meleeRange && this.meleeCooldown <= 0) {
      this.meleeCooldown = 1.1;
      this.pose = 1;
      this.poseDir = 1;
      return { skill: 'swipe', melee: 12 + this.phase * 3 };
    }

    this.summonCooldown -= dt;
    const moveSpeed = 1.3 + this.phase * 0.4;
    // 正常追击沿导航流场绕障；冲锋仍用上面的直线 chargeDir
    const navLen = ctx ? Math.hypot(ctx.navX, ctx.navZ) : 0;
    const mx = navLen > 0.01 ? ctx!.navX / navLen : dir.x;
    const mz = navLen > 0.01 ? ctx!.navZ / navLen : dir.z;
    this.root.position.x += mx * moveSpeed * dt;
    this.root.position.z += mz * moveSpeed * dt;
    // 追击时播走路、贴近后回到待机（交叉淡化，避免抽帧式硬切）
    this.moveWeight += (1 - this.moveWeight) * Math.min(1, dt * 4);
    this.applyMoveWeight(this.moveWeight);

    // 技能轮换
    this.skillTimer -= dt;
    if (this.skillTimer <= 0) {
      this.skillTimer = this.spec.skillInterval * (this.phase > 0 ? 0.7 : 1);
      // 阶段化招式表：按固定顺序循环（而不是纯随机），玩家可以背板预判
      const seq: BossSkill[] = this.phase > 0
        ? ['charge', 'stomp', 'summon', 'aoe_blast', 'summon_elite']
        : ['charge', 'stomp', 'summon'];
      let pick = seq[this.skillIndex % seq.length];
      this.skillIndex += 1;
      if (pick === 'charge' && dist <= 3) pick = 'stomp'; // 贴脸不冲锋

      if (pick === 'charge' && dist > 3) {
        this.charging = true;
        this.chargeHit = false;
        this.pose = 0.7;
        this.poseDir = 1;
        this.chargeTimer = 0.55;
        this.chargeDir.copy(dir);
        this.flashBoss(0xff6600);
        return { skill: 'charge', chargeDir: dir.clone() };
      }
      if (pick === 'stomp') {
        this.stomping = true;
        this.stompTimer = 0.45;
        this.showTelegraph(6 + this.phase * 2, 0.5);
        this.flashBoss(0xffaa00);
        return { skill: 'stomp', stompRadius: 6 + this.phase * 2 };
      }
      if (pick === 'aoe_blast') {
        this.blastWindup = 0.55;
        this.showTelegraph(8 + this.phase * 3, 0.6);
        this.pose = 1;
        this.poseDir = -1; // 后仰蓄力
        return null;
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

  /** 每帧由 game 注入地形高度（践踏跳跃叠加在真实地面之上） */
  applyGround(groundY: number): void {
    this.root.position.y = groundY + this.stompLift;
  }

  /** 调试/回归：当前是否在冲锋 */
  isCharging(): boolean {
    return this.charging;
  }

  /** 按元素类型受伤，返回是否死亡 */
  takeDamage(amount: number, element: Element = 'physical'): boolean {
    if (!this.alive) return false;
    const res = this.resistance[element] ?? 0;
    // 抗性 0/1/2/3 → 减伤 0%/15%/35%/55%
    const reduction = res === 0 ? 0 : res === 1 ? 0.15 : res === 2 ? 0.35 : 0.55;
    const finalDmg = amount * (1 - reduction);
    this.hp -= finalDmg;
    this.flash = 1;
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
    const hpPct = this.hp / this.maxHp;
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
    return new THREE.Vector3(this.root.position.x, this.root.position.y + 2.2, this.root.position.z);
  }

  /** 零分配版本（命中判定每帧调用） */
  centerInto(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + 2.2, this.root.position.z);
  }
}
