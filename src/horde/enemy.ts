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

export type EnemyKind = 'chaser' | 'boomer' | 'spitter' | 'guard' | 'berserker' | 'caster';

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
};

/** 模块级临时向量（避免每帧每敌人 new） */
const tmpToPlayer = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const CENTER_Y = 1.0;

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
  /** 动画相位（错开走路节奏） */
  private phase = Math.random() * Math.PI * 2;
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
    return this.takeDamage(this.burnDps * dt);
  }

  constructor(def: EnemyDef, rng: { range: (a: number, b: number) => number }, opts?: { hpMult?: number; dmgMult?: number; elite?: EliteAffix }) {
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
    this.root.userData.enemy = this;
  }

  /** 厚甲减伤 / 再生回复（每帧调用） */
  tickElite(dt: number): void {
    if (!this.elite) return;
    if (this.elite.kind === 'regenerating' && this.alive) {
      this.hp = Math.min(this.def.hp, this.hp + this.def.hp * 0.015 * dt);
      this.bar.setHp(this.hp / this.def.hp);
      if (this.hp >= this.def.hp) this.barSprite.visible = false;
    }
  }

  /** 更新 AI，返回本帧是否对玩家造成伤害事件 */
  update(dt: number, playerPos: THREE.Vector3): { melee?: number; blast?: number; spit?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }; cast?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[] } | null {
    if (!this.alive) return null;
    const d = this.def;

    // 减速
    if (this.slowTimer > 0) this.slowTimer -= dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    tmpToPlayer.subVectors(playerPos, this.root.position);
    tmpToPlayer.y = 0;
    const dist = tmpToPlayer.length();
    const dir = dist > 0.001 ? tmpToPlayer.normalize() : tmpDir.set(0, 0, 0);

    const speed = d.speed * (this.slowTimer > 0 ? this.slowFactor : 1);

    // 朝向玩家
    this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);
    this.animate(dt, dist);

    if (d.kind === 'spitter') {
      this.spitCooldown -= dt;
      // 出手前摇：蓄力期间定住（前倾），给玩家躲弹道的窗口
      if (this.spitWindup > 0) {
        this.spitWindup -= dt;
        if (this.spitWindup <= 0) {
          if (dist <= d.range + 2) {
            this.spitCooldown = 2.2;
            const from = this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
            const to = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0));
            return { spit: { from, to, damage: d.damage } };
          }
          return null;
        }
        return null;
      }
      if (dist <= d.range && this.spitCooldown <= 0) {
        this.spitWindup = 0.42;
        this.lunge();
        return null;
      }
      if (dist > 3) this.root.position.addScaledVector(dir, speed * 0.55 * dt);
    } else if (d.kind === 'caster') {
      // 弹幕法师：保持中距离，蓄力三连弹
      this.spitCooldown -= dt;
      if (this.castWindup > 0) {
        this.castWindup -= dt;
        if (this.castWindup <= 0) {
          if (dist <= d.range + 2) {
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
      if (dist < 5) {
        this.root.position.addScaledVector(dir, -speed * dt);
      } else if (dist > d.range - 2) {
        this.root.position.addScaledVector(dir, speed * dt);
      }
      if (dist <= d.range && this.spitCooldown <= 0) {
        this.castWindup = 0.5;
        this.lunge();
      }
    } else if (d.kind === 'boomer') {
      if (dist < 1.1) {
        if (this.fuseTimer < 0) {
          this.fuseTimer = 0.7;
          this.lunge();
        }
      }
      if (this.fuseTimer >= 0) {
        this.fuseTimer -= dt;
        if (this.fuseTimer <= 0) {
          this.die();
          return { blast: d.damage };
        }
      } else {
        this.root.position.addScaledVector(dir, speed * dt);
      }
    } else {
      // chaser / guard / berserker：近战（前摇 0.26s 蓄力 → 结算；给玩家反应窗口）
      if (this.windup > 0) {
        this.windup -= dt;
        if (this.windup <= 0) {
          if (dist < 1.5) return { melee: d.damage }; // 蓄力结束仍在近身范围才命中
          return null;
        }
        return null; // 蓄力中定在原地（前倾姿态就是"要打人了"的提示）
      }
      if (dist < 1.0) {
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 0.9;
          this.windup = 0.26;
          this.lunge();
        }
      } else {
        this.root.position.addScaledVector(dir, speed * dt);
        // 迂回摆动：不再笔直冲锋（有机感，也更容易被侧翼火力拦截）
        const wobble = Math.sin(this.phase * 0.33) * 0.3;
        this.root.position.x += -dir.z * wobble * speed * dt;
        this.root.position.z += dir.x * wobble * speed * dt;
        // 避障绕行：前方被掩体挡住时沿切线绕行（方向由 game 侧探测）
        if (this.avoidT > 0) {
          this.avoidT -= dt;
          this.root.position.x += this.avoidX * speed * dt;
          this.root.position.z += this.avoidZ * speed * dt;
        }
      }
    }

    return null;
  }

  /** 走路律动：上下起伏 + 前后摆动（单网格也能读出“在跑”） */
  private animate(dt: number, dist: number): void {
    const moving = dist > 1.15;
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
  }

  /** 攻击前倾强度（近战/喷吐时置 1，随后衰减） */
  private attackAnim = 0;
  /** 受击后仰强度 */
  private hitAnim = 0;
  /** 近战前摇剩余时间（>0 时定在原地蓄力） */
  private windup = 0;
  /** 喷毒 / 施法前摇剩余时间 */
  private spitWindup = 0;
  private castWindup = 0;
  /** 避障绕行方向（由 game 侧探测写入，持续 avoidT 秒） */
  avoidX = 0;
  avoidZ = 0;
  avoidT = 0;
  private lunge(): void {
    this.attackAnim = 1;
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
