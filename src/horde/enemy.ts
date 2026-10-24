/**
 * horde/enemy — 敌人类型与个体。
 *
 * 六种兵种（追击 / 自爆 / 喷毒 / 盾兵 / 狂战 / 弹幕法师），AI 为简单状态机：
 *   chase → attack（近战/自爆）或 spit/cast（远程）→ death
 *
 * 建模：见 horde/enemyModel（每兵种定制低多边形剪影，顶点色合并为单网格）。
 * 每个敌人 = 1 个网格 + 1 个血条精灵，几何体与贴图全局共享。
 */
import * as THREE from 'three';
import { createHealthBar, getEnemyTemplate } from './enemyModel';
import { stepVertical } from './motion';
import type { VerticalBody } from './motion';

export type EnemyKind = 'chaser' | 'boomer' | 'spitter' | 'guard' | 'berserker' | 'caster' | 'healer' | 'turret';

/** 精英词缀（试炼之塔 / 高波次敌人） */
export type EliteAffix = 'frantic' | 'armored' | 'regenerating';

/** 元素类型（4 属性抗性） */
export type Element = 'physical' | 'fire' | 'ice' | 'energy';

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  speed: number;
  damage: number;
  color: number;
  radius: number;
  /** 远程射程（spitter / caster） */
  range: number;
  /** 自爆范围（boomer） */
  blastRadius: number;
  /** 盾兵/厚甲减伤（0-1） */
  resist?: number;
  /** 元素抗性 */
  elementResist?: Partial<Record<Element, number>>;
}

export const ELITE_AFFIXES: { kind: EliteAffix; name: string; color: number }[] = [
  { kind: 'frantic', name: '狂怒', color: 0xff9a3a },
  { kind: 'armored', name: '厚甲', color: 0x9ab8ff },
  { kind: 'regenerating', name: '再生', color: 0x5affa8 },
];

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  chaser: { kind: 'chaser', hp: 40, speed: 2.6, damage: 4, color: 0xd94a4a, radius: 0.45, range: 0, blastRadius: 0, elementResist: { physical: 0, fire: 0, ice: 0, energy: 0 } },
  boomer: { kind: 'boomer', hp: 70, speed: 1.6, damage: 10, color: 0xd97b2a, radius: 0.55, range: 0, blastRadius: 2.6, elementResist: { physical: 1, fire: 2, ice: 0, energy: 0 } },
  spitter: { kind: 'spitter', hp: 55, speed: 1.9, damage: 4, color: 0x3fb96a, radius: 0.5, range: 14, blastRadius: 0, elementResist: { physical: 0, fire: 0, ice: 1, energy: 0 } },
  guard: { kind: 'guard', hp: 120, speed: 1.3, damage: 6, color: 0x4a6a9a, radius: 0.6, range: 0, blastRadius: 0, resist: 0.35, elementResist: { physical: 2, fire: 0, ice: 0, energy: 1 } },
  berserker: { kind: 'berserker', hp: 30, speed: 3.8, damage: 7, color: 0xb33a8a, radius: 0.42, range: 0, blastRadius: 0, elementResist: { physical: 0, fire: 1, ice: 0, energy: 0 } },
  caster: { kind: 'caster', hp: 50, speed: 2.1, damage: 7, color: 0x8a4ad9, radius: 0.45, range: 16, blastRadius: 0, elementResist: { physical: 0, fire: 0, ice: 0, energy: 2 } },
  healer: { kind: 'healer', hp: 70, speed: 2.0, damage: 0, color: 0x4ad98a, radius: 0.5, range: 12, blastRadius: 0, elementResist: { physical: 0, fire: 1, ice: 0, energy: 0 } },
  turret: { kind: 'turret', hp: 160, speed: 0, damage: 13, color: 0x9a8f7a, radius: 0.7, range: 18, blastRadius: 0, resist: 0.2, elementResist: { physical: 1, fire: 0, ice: 0, energy: 1 } },
};

/** 模块级临时向量（避免每帧每敌人 new） */
const tmpToPlayer = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const CENTER_Y = 1.0;

/** 每帧由 game 侧注入的导航/视线信息 */
export interface EnemyStepContext {
  /** 指向玩家的单位方向（有遮挡时为绕行方向） */
  navX: number;
  navZ: number;
  /** 3D 视线是否通畅（低掩体可越过，墙不可） */
  seesPlayer: boolean;
}

let enemyUid = 0;

export class Enemy {
  readonly def: EnemyDef;
  /** 唯一 id（伤害跳字聚合用） */
  readonly id = ++enemyUid;
  readonly root: THREE.Group;
  hp: number;
  alive = true;
  /** 精英词缀（无则 null） */
  elite: { kind: EliteAffix; name: string } | null = null;
  /** 减速计时（霜锋冲锋枪命中触发） */
  slowTimer = 0;
  slowFactor = 0;
  /** 自爆计时（boomer 接近后引爆） */
  private fuseTimer = -1;
  private spitCooldown = 0;
  /** 治疗者：下一次群体治疗倒计时 */
  private healTimer = 4.5;
  /** 近战攻击冷却（防止多只同时每帧扣血秒杀） */
  private attackCooldown = 0;
  /** 灼烧 DOT（烈焰风暴命中施加） */
  burnTimer = 0;
  burnDps = 0;

  /** 身体网格（单网格，材质可闪红） */
  private readonly body: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly bar: { sprite: THREE.Sprite; setHp: (pct: number) => void };
  private readonly barSprite: THREE.Sprite;
  /** 前摇警示环（近战/自爆/重炮蓄力时可见） */
  private readonly telegraph: THREE.Mesh;
  /** 动画相位（错开走路节奏） */
  private phase = Math.random() * Math.PI * 2;
  /** 上一帧位置（判断是否真的在移动） */
  private prevX = 0;
  private prevZ = 0;
  private flashTimer = 0;
  private flashing = false;
  /** 倒地动画剩余时间（>0 时尸体还在场上，播完才回收） */
  private corpseT = 0;
  /** 可被回收（倒地动画播完） */
  get removable(): boolean {
    return !this.alive && this.corpseT <= 0;
  }

  /** 施加灼烧（持续伤害） */
  applyBurn(seconds: number, dps: number): void {
    this.burnTimer = Math.max(this.burnTimer, seconds);
    this.burnDps = dps;
  }

  /** 每帧应用灼烧伤害，返回是否死亡 */
  tickBurn(dt: number): boolean {
    if (this.burnTimer <= 0) return false;
    this.burnTimer -= dt;
    return this.takeDamage(this.burnDps * dt, 'fire');
  }

  /** 怪物等级（等级压制 / 经验结算） */
  readonly level: number;

  constructor(def: EnemyDef, rng: { range: (a: number, b: number) => number }, opts?: { hpMult?: number; dmgMult?: number; elite?: EliteAffix; level?: number }) {
    const hpMult = opts?.hpMult ?? 1;
    const dmgMult = opts?.dmgMult ?? 1;
    const eliteAffix = opts?.elite;
    // 词缀属性调整：狂怒（移速/伤害）/ 厚甲（减伤）/ 再生（回血）
    let speed = def.speed;
    let dmg = def.damage * dmgMult;
    if (eliteAffix === 'frantic') {
      this.elite = { kind: 'frantic', name: '狂怒' };
      speed *= 1.4;
      dmg *= 1.3;
    } else if (eliteAffix === 'armored') {
      this.elite = { kind: 'armored', name: '厚甲' };
      dmg *= 1.2;
    } else if (eliteAffix === 'regenerating') {
      this.elite = { kind: 'regenerating', name: '再生' };
      dmg *= 1.1;
    }
    const hp = def.hp * hpMult * (this.elite ? 1.5 : 1);
    this.def = { ...def, hp, speed, damage: dmg };
    this.hp = hp;
    this.level = Math.max(1, Math.round(opts?.level ?? 1));

    this.root = new THREE.Group();
    const tpl = getEnemyTemplate(def.kind, def.color);
    this.bodyMat = tpl.material.clone();
    this.body = new THREE.Mesh(tpl.geometry, this.bodyMat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);

    // 血条：满血隐藏（多数敌人 2~3 发即死，满血条只是噪声）
    this.bar = createHealthBar(def.color);
    this.barSprite = this.bar.sprite;
    this.barSprite.position.y = tpl.height + 0.28;
    this.barSprite.visible = false;
    this.root.add(this.barSprite);

    // 前摇警示：贴地环，蓄力时亮起并脉动（给玩家反应窗口）
    this.telegraph = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 24),
      new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
    );
    this.telegraph.rotation.x = -Math.PI / 2;
    this.telegraph.position.y = 0.05;
    this.telegraph.visible = false;
    this.root.add(this.telegraph);

    // 精英光环（词缀色）
    if (this.elite) {
      const affixColor = this.elite.kind === 'frantic' ? 0xff9a3a : this.elite.kind === 'armored' ? 0x9ab8ff : 0x5affa8;
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.03, 6, 18),
        new THREE.MeshBasicMaterial({ color: affixColor, transparent: true, opacity: 0.9, fog: false })
      );
      halo.position.y = tpl.height + 0.02;
      halo.rotation.x = Math.PI / 2;
      this.root.add(halo);
      // 精英整体偏亮（词缀可辨识）
      this.bodyMat.color.setHex(0xffd9a0);
    }

    this.root.position.set(rng.range(-9, 9), 0, rng.range(-9, 9));
    this.safeX = this.root.position.x;
    this.safeZ = this.root.position.z;
    this.root.userData.enemy = this;
  }

  /** 护甲/再生（每帧调用） */
  tickElite(dt: number): void {
    if (!this.elite) return;
    if (this.elite.kind === 'regenerating' && this.alive) {
      this.hp = Math.min(this.def.hp, this.hp + this.def.hp * 0.015 * dt);
      this.bar.setHp(this.hp / this.def.hp);
      if (this.hp >= this.def.hp) this.barSprite.visible = false;
    }
  }

  /** 被友军治疗：恢复生命并同步血条（治疗者 AI 触发） */
  healBy(amount: number): void {
    if (!this.alive || amount <= 0) return;
    this.hp = Math.min(this.def.hp, this.hp + amount);
    this.bar.setHp(this.hp / this.def.hp);
    this.barSprite.visible = this.hp < this.def.hp;
  }

  /** 更新 AI，返回本帧是否对玩家造成伤害事件 */
  update(dt: number, playerPos: THREE.Vector3, ctx: EnemyStepContext): { melee?: number; blast?: number; spit?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }; cast?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[]; heal?: number } | null {
    if (!this.alive) return null;
    const d = this.def;
    const sees = ctx.seesPlayer;

    // 击退滑行：独立于 AI 移动，指数衰减
    if (this.kvx !== 0 || this.kvz !== 0) {
      this.root.position.x += this.kvx * dt;
      this.root.position.z += this.kvz * dt;
      const decay = Math.exp(-dt * 6);
      this.kvx *= decay;
      this.kvz *= decay;
      if (Math.abs(this.kvx) < 0.05 && Math.abs(this.kvz) < 0.05) {
        this.kvx = 0;
        this.kvz = 0;
      }
    }

    // 晕眩：完全停止行动（仍会被灼烧/击退）
    if (this.stunT > 0) {
      this.stunT -= dt;
      return null;
    }

    // 减速
    if (this.slowTimer > 0) this.slowTimer -= dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    tmpToPlayer.subVectors(playerPos, this.root.position);
    tmpToPlayer.y = 0;
    const dist = tmpToPlayer.length();
    const dir = dist > 0.001 ? tmpToPlayer.normalize() : tmpDir.set(0, 0, 0);
    // 水平指向玩家（绕障）向量；无遮挡时才用直线
    const navX = ctx.navX;
    const navZ = ctx.navZ;
    const navLen = Math.hypot(navX, navZ);
    const speed = d.speed * (this.slowTimer > 0 ? this.slowFactor : 1);
    // 近战/自爆需要处在同一层（平台上下不能隔空打到）
    const sameLevel = Math.abs(playerPos.y - this.root.position.y) < 1.15;

    // 朝向：看得见玩家盯玩家，绕障时看行进方向，避免倒着滑步
    if (sees || dist < 2 || navLen < 0.01) this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);
    else this.root.lookAt(this.root.position.x + navX, this.root.position.y, this.root.position.z + navZ);
    this.animate(dt);

    const moveAlongPath = (multiplier: number): void => {
      if (navLen < 0.01) return;
      this.root.position.x += (navX / navLen) * speed * multiplier * dt;
      this.root.position.z += (navZ / navLen) * speed * multiplier * dt;
    };
    const moveAway = (multiplier: number): void => {
      this.root.position.x -= dir.x * speed * multiplier * dt;
      this.root.position.z -= dir.z * speed * multiplier * dt;
    };

    if (d.kind === 'spitter') {
      this.spitCooldown -= dt;
      // 出手前摇：蓄力期间定住（前倾），给玩家躲弹道的窗口
      if (this.spitWindup > 0) {
        this.spitWindup -= dt;
        if (this.spitWindup <= 0) {
          if (dist <= d.range + 2 && sees) {
            this.spitCooldown = 2.2;
            const from = this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
            const to = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0));
            return { spit: { from, to, damage: d.damage } };
          }
          return null;
        }
        return null;
      }
      // 有视线才出手；没有视线就沿寻路绕到能打的位置
      if (dist <= d.range && sees && this.spitCooldown <= 0) {
        this.spitWindup = 0.42;
        this.lunge();
        return null;
      }
      if (dist < 4.5) moveAway(0.8);
      else if (!sees || dist > d.range * 0.8) moveAlongPath(0.65);
    } else if (d.kind === 'caster') {
      // 弹幕法师：保持中距离，蓄力三连弹
      this.spitCooldown -= dt;
      if (this.castWindup > 0) {
        this.castWindup -= dt;
        if (this.castWindup <= 0) {
          if (dist <= d.range + 2 && sees) {
            this.spitCooldown = 2.4;
            this.lunge();
            const from = this.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
            const casts: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[] = [];
            for (let i = 0; i < 3; i++) {
              const wobble = new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.4, 0);
              casts.push({ from, to: playerPos.clone().add(new THREE.Vector3(0, 1.2, 0)).add(wobble), damage: d.damage });
            }
            return { cast: casts };
          }
          return null;
        }
        return null;
      }
      if (dist <= d.range && sees && this.spitCooldown <= 0) {
        this.castWindup = 0.5;
        this.lunge();
        return null;
      }
      if (dist < 5) moveAway(1);
      else if (!sees || dist > d.range - 2) moveAlongPath(1);
    } else if (d.kind === 'healer') {
      // 治疗者：不攻击玩家，保持中距离并周期治疗周围友军
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = 4.5;
        this.lunge();
        return { heal: 12 };
      }
      if (dist < 7) moveAway(0.8);
      else if (dist > 12 || !sees) moveAlongPath(0.8);
    } else if (d.kind === 'turret') {
      // 重装炮台：固定不动，长前摇重炮
      this.spitCooldown -= dt;
      if (this.spitWindup > 0) {
        this.spitWindup -= dt;
        if (this.spitWindup <= 0) {
          if (dist <= d.range + 2 && sees) {
            this.spitCooldown = 3.2;
            const from = this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
            const to = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0));
            return { spit: { from, to, damage: d.damage } };
          }
          return null;
        }
        return null;
      }
      if (dist <= d.range && sees && this.spitCooldown <= 0) {
        this.spitWindup = 0.55;
        this.lunge();
      }
    } else if (d.kind === 'boomer') {
      if (this.fuseTimer >= 0) {
        this.fuseTimer -= dt;
        if (this.fuseTimer <= 0) {
          this.die();
          return { blast: d.damage };
        }
        return null;
      }
      if (dist < 1.25 && sameLevel && sees) {
        this.fuseTimer = 0.7;
        this.lunge();
        return null;
      }
      moveAlongPath(1);
    } else {
      // chaser / guard / berserker：近战（前摇 0.26s 蓄力 → 结算；给玩家反应窗口）
      if (this.windup > 0) {
        this.windup -= dt;
        if (this.windup <= 0) {
          // 蓄力结束仍在近身范围、同层且没被掩体挡住才命中
          if (dist < 1.5 && sameLevel && sees) return { melee: d.damage };
          return null;
        }
        return null; // 蓄力中定在原地（前倾姿态就是"要打人了"的提示）
      }
      if (dist < 1.0 && sameLevel && sees) {
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 0.9;
          this.windup = 0.26;
          this.lunge();
        }
      } else {
        moveAlongPath(1);
      }
    }

    return null;
  }

  /** 走路律动：上下起伏 + 前后摆动（单网格也能读出“在跑”）
   *  用「上一帧位移」判断是否真的在移动：远程兵种保持距离站定时不再原地踏步。 */
  private animate(dt: number): void {
    const dx = this.root.position.x - this.prevX;
    const dz = this.root.position.z - this.prevZ;
    const moving = Math.hypot(dx, dz) > Math.max(0.0025, dt * 0.12);
    this.prevX = this.root.position.x;
    this.prevZ = this.root.position.z;
    this.phase += dt * (moving ? 11 : 2.4);
    // 四肢摆动由着色器完成（enemyModel 的 ANIM_BODY），这里只喂相位/移动强度/出手前倾
    const anim = this.bodyMat.userData.anim as Record<string, { value: number }> | undefined;
    if (anim) {
      anim.uPhase.value = this.phase;
      const target = moving ? 1 : 0.1;
      anim.uMove.value += (target - anim.uMove.value) * Math.min(1, dt * 9);
      this.attackAnim = Math.max(0, this.attackAnim - dt * 3.0);
      anim.uAttack.value = this.attackAnim;
      this.hitAnim = Math.max(0, this.hitAnim - dt * 5.0);
      anim.uHit.value = this.hitAnim;
    }
    // 整体落脚起伏
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.035 : Math.sin(this.phase * 0.5) * 0.008;
    this.body.rotation.z = Math.sin(this.phase * 0.5) * (moving ? 0.05 : 0.015);
    // 前摇警示环：近战/自爆/重炮各自配色，脉动提示
    const teleColor = this.windup > 0 ? 0xff5533 : this.fuseTimer > 0 ? 0xffc14a : this.spitWindup > 0 ? 0xffd24a : 0;
    this.telegraph.visible = teleColor !== 0;
    if (teleColor !== 0) {
      const mat = this.telegraph.material as THREE.MeshBasicMaterial;
      mat.color.setHex(teleColor);
      mat.opacity = 0.3 + Math.abs(Math.sin(this.phase * 6)) * 0.3;
      const base = Math.max(0.75, this.def.radius / 0.5);
      this.telegraph.scale.setScalar(base * (1 + Math.sin(this.phase * 9) * 0.08));
    }
  }

  /** 攻击前倾强度（近战/喷吐时置 1，随后衰减） */
  private attackAnim = 0;
  /** 受击后仰强度 */
  private hitAnim = 0;
  /** 近战前摇剩余时间（>0 时定在原地蓄力） */
  private windup = 0;

  /** 前摇警示是否可见（调试/探针） */
  telegraphActive(): boolean {
    return this.windup > 0 || this.spitWindup > 0 || this.fuseTimer > 0;
  }
  /** 状态效果：晕眩剩余时间 / 击退滑行速度 */
  private stunT = 0;
  private kvx = 0;
  private kvz = 0;
  /** 垂直物理：离地后受重力，落地贴地（不再永久悬空） */
  private readonly vertical: VerticalBody = { y: 0, vy: 0, grounded: true };
  /** 上一次站稳的位置：跨越过高地形失败时回退到这里 */
  private safeX = 0;
  private safeZ = 0;

  /** 被击退：沿方向施加冲量（速度会指数衰减） */
  applyKnockback(dirX: number, dirZ: number, impulse: number): void {
    const cap = 6;
    this.kvx = THREE.MathUtils.clamp(this.kvx + dirX * impulse, -cap, cap);
    this.kvz = THREE.MathUtils.clamp(this.kvz + dirZ * impulse, -cap, cap);
  }

  /** 晕眩：期间完全停止行动 */
  applyStun(seconds: number): void {
    this.stunT = Math.max(this.stunT, seconds);
  }

  isStunned(): boolean {
    return this.stunT > 0;
  }

  isBurning(): boolean {
    return this.burnTimer > 0;
  }

  isSlowed(): boolean {
    return this.slowTimer > 0;
  }
  /** 喷毒 / 施法前摇剩余时间 */
  private spitWindup = 0;
  private castWindup = 0;
  private lunge(): void {
    this.attackAnim = 1;
  }

  /** 放置到世界坐标（刷怪/调试用；同步垂直物理状态） */
  place(x: number, z: number, y: number): void {
    this.root.position.set(x, y, z);
    this.vertical.y = y;
    this.vertical.vy = 0;
    this.vertical.grounded = true;
    this.safeX = x;
    this.safeZ = z;
    this.prevX = x;
    this.prevZ = z;
  }

  /** 每帧贴地/下落（由 game 在水平碰撞处理之后调用） */
  applyGroundMotion(ground: number, dt: number): void {
    this.vertical.y = this.root.position.y;
    stepVertical(this.vertical, ground, dt);
    this.root.position.y = this.vertical.y;
    // 只有真正贴地才记录安全点；卡进坡体时不能把非法位置也记成安全点
    if (this.vertical.grounded && Math.abs(this.root.position.y - ground) < 0.05) {
      this.safeX = this.root.position.x;
      this.safeZ = this.root.position.z;
    }
  }

  isGrounded(): boolean {
    return this.vertical.grounded;
  }

  /** 脚下的地面比当前高度高出一个台阶以上：回退到上次站稳点，防止钻进斜坡/台阶内部 */
  refuseClimb(ground: number, stepUp = 0.5): boolean {
    if (!this.vertical.grounded) return false;
    if (ground - this.root.position.y <= stepUp) return false;
    this.root.position.x = this.safeX;
    this.root.position.z = this.safeZ;
    return true;
  }

  /** 按元素类型受伤，返回是否死亡 */
  takeDamage(amount: number, element: Element = 'physical'): boolean {
    if (!this.alive) return false;
    if (!Number.isFinite(amount) || amount <= 0) return false;
    // 厚甲：减伤 50%；盾兵：固定减伤
    const resist = this.elite?.kind === 'armored' ? 0.5 : (this.def.resist ?? 0);
    let final = amount * (1 - resist);
    const elemRes = this.def.elementResist?.[element] ?? 0;
    if (elemRes > 0) {
      const reduction = elemRes === 1 ? 0.15 : elemRes === 2 ? 0.35 : 0.55;
      final *= 1 - reduction;
    }
    this.hp -= final;
    this.flashTimer = 0.1;
    this.hitAnim = 1;
    const pct = Math.max(0, this.hp / this.def.hp);
    this.bar.setHp(pct);
    if (this.barSprite.visible !== pct < 1) this.barSprite.visible = pct < 1;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  /** 受伤闪白（每帧调用；只在状态变化时改材质，避免每次受伤都写 uniform） */
  updateFlash(dt: number): boolean {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const flashing = this.flashTimer > 0;
      if (flashing !== this.flashing) {
        this.flashing = flashing;
        this.bodyMat.emissive.setHex(flashing ? 0x551111 : 0x000000);
      }
      return flashing;
    }
    if (this.flashing) {
      this.flashing = false;
      this.bodyMat.emissive.setHex(0x000000);
    }
    return false;
  }

  /** 死亡：进入倒地动画（由 game 每帧 tickCorpse 推进，播完才回收） */
  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = Math.min(this.hp, 0);
    this.corpseT = 0.9;
    this.barSprite.visible = false;
    this.flashing = false;
    this.bodyMat.emissive.setHex(0x000000);
    const anim = this.bodyMat.userData.anim as Record<string, { value: number }> | undefined;
    if (anim) anim.uMove.value = 0;
  }

  /** 倒地动画：绕脚踝前扑 + 末段下沉收缩 */
  tickCorpse(dt: number): void {
    if (this.alive || this.corpseT <= 0) return;
    this.corpseT -= dt;
    const t = 1 - Math.max(0, this.corpseT) / 0.9;
    // 负角度 = 朝面向方向（-z）前扑
    this.root.rotation.x = -1.45 * Math.min(1, t * 2.6);
    if (t > 0.6) {
      this.root.position.y -= dt * 0.5;
      this.body.scale.setScalar(Math.max(0.25, 1 - (t - 0.6) * 1.5));
    }
  }

  applySlow(factor: number, seconds: number): void {
    this.slowTimer = seconds;
    this.slowFactor = factor;
  }

  /** 中心点（用于射线检测与命中判定） */
  center(): THREE.Vector3 {
    return new THREE.Vector3(this.root.position.x, this.root.position.y + CENTER_Y, this.root.position.z);
  }

  /** 零分配版本：把中心点写入外部向量 */
  centerInto(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + CENTER_Y, this.root.position.z);
  }
}
