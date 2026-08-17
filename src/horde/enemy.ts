/**
 * horde/enemy — 敌人类型与个体。
 *
 * 三种敌人（近战群 / 自爆 / 喷毒精英），AI 为简单状态机：
 *   chase → attack（近战/自爆）或 spit（远程）→ death
 * 模型当前为程序化占位（胶囊+色块按类型区分），预留 mesh 容器，
 * 后续可直接替换为开源 GLB 模型（GLTFLoader 加载后塞入 root）。
 */
import * as THREE from 'three';
import { solid } from '../render';

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
  /** 远程射程（spitter） */
  range: number;
  /** 自爆范围（boomer） */
  blastRadius: number;
  /** 盾兵/厚甲减伤（0-1） */
  resist?: number;
  /** 元素抗性（） */
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

export class Enemy {
  readonly def: EnemyDef;
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
    // 词缀属性调整：狂怒（hp×1.5 移速×1.4）/ 厚甲（hp×2 减伤）/ 再生（hp×1.4 回血）
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
    this.root = this.buildMesh(this.def, this.elite);
    this.root.position.set(rng.range(-9, 9), 0, rng.range(-9, 9));
  }

  /** 厚甲减伤 / 再生回复（每帧调用） */
  tickElite(dt: number): void {
    if (!this.elite) return;
    if (this.elite.kind === 'regenerating' && this.alive) {
      this.hp = Math.min(this.def.hp, this.hp + this.def.hp * 0.015 * dt);
    }
  }

  private buildMesh(def: EnemyDef, elite: Enemy['elite']): THREE.Group {
    const g = new THREE.Group();
    // 精英词缀：整体偏金色染色
    const tint = elite ? 0xffd24a : def.color;
    const mat = solid(tint, { roughness: 0.65 });
    // 胶囊躯干：局部 -0.62~0.62，置于 y=1.0 → 世界 0.38~1.62（保证 1.6 高度的射线可命中）
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(def.radius * 0.65, 0.85, 6, 12), mat);
    body.position.y = 1.0;
    g.add(body);
    // 眼睛（朝向示意）
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const side of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
      eye.position.set(side, 1.45, -def.radius * 0.6);
      g.add(eye);
    }
    // 类型特征：自爆=头顶光圈，喷毒=背刺，盾兵=宽身大盾，狂战=发光尖刺
    if (def.kind === 'caster') {
      // 兜帽 + 悬浮法杖（远程弹幕法师）
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 10), solid(0x6a3ab8, { roughness: 0.5 }));
      hood.position.y = 1.75;
      g.add(hood);
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.1, 6), solid(0x4a2a7a));
      staff.position.set(0.3, 0.8, 0);
      staff.rotation.z = 0.25;
      g.add(staff);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), new THREE.MeshBasicMaterial({ color: 0xcc88ff }));
      orb.position.set(0.42, 1.35, 0);
      g.add(orb);
    }
    if (def.kind === 'boomer') {
      const glow = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 0.7, 0.03, 6, 16), new THREE.MeshBasicMaterial({ color: 0xff8833 }));
      glow.position.y = 2.0;
      glow.rotation.x = Math.PI / 2;
      g.add(glow);
    }
    if (def.kind === 'spitter') {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), solid(0x2a7a4a));
      spike.position.set(0, 1.7, def.radius * 0.7);
      spike.rotation.x = Math.PI / 2;
      g.add(spike);
    }
    if (def.kind === 'guard') {
      // 宽身 + 盾牌
      const shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.12), solid(0x5a7aaa, { metalness: 0.5 }));
      shield.position.set(0, 1.1, -def.radius * 0.55);
      g.add(shield);
      body.scale.set(1.25, 1.1, 1.15);
    }
    if (def.kind === 'berserker') {
      // 发光尖刺
      const spikeMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a });
      for (let i = 0; i < 5; i++) {        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 5), spikeMat);
        spike.position.set(-0.25 + i * 0.12, 1.9, 0);
        g.add(spike);
      }
    }
    // 精英词缀：头顶发光光环（词缀色可视化）
    if (elite) {
      const affixColor = elite.kind === 'frantic' ? 0xff9a3a : elite.kind === 'armored' ? 0x9ab8ff : 0x5affa8;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 6, 18), new THREE.MeshBasicMaterial({ color: affixColor }));
      halo.position.y = 2.4;
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
    }
    // 头顶血条（背景 + 填充）
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), new THREE.MeshBasicMaterial({ color: 0x1a1a22, transparent: true, opacity: 0.75, depthWrite: false }));
    barBg.position.y = 2.2;
    g.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.08), new THREE.MeshBasicMaterial({ color: 0x3d6b4a, depthWrite: false }));
    bar.position.y = 2.2;
    bar.position.z = 0.001;
    bar.scale.x = 1;
    g.add(bar);
    this.barMesh = bar;
    this.barMaterial = bar.material as THREE.MeshBasicMaterial;
    g.userData.enemy = this;
    return g;
  }

  private barMesh: THREE.Mesh | null = null;
  private barMaterial: THREE.MeshBasicMaterial | null = null;
  private flashTimer = 0;

  /** 挂载开源模型（替换程序化躯干，保留血条；按类型染色） */
  applyModel(group: THREE.Group): void {
    // 移除程序化部件（保留血条）
    const keep = new Set<THREE.Object3D>([this.barMesh!]);
    for (const child of [...this.root.children]) {
      if (!keep.has(child)) this.root.remove(child);
    }
    // 缩放适配：RobotExpressive 实际渲染高约 4.8m（Box3 对 SkinnedMesh 偏小），目标 1.1m
    group.scale.setScalar(1.1 / 4.8);
    // 类型色调混合：保留模型原细节，向类型色偏移 55%（精英偏金）
    const tint = new THREE.Color(this.elite ? 0xffd24a : this.def.color);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && mat.color) {
          const orig = mat.color.clone();
          mat.color.copy(orig.lerp(tint, 0.55));
          mat.roughness = 0.6;
          mat.metalness = 0.3;
        }
      }
    });
    group.position.y = 0;
    // 血条对齐小怪新体型（1.2m 模型 → 头顶约 1.7）
    if (this.barMesh) this.barMesh.position.y = 1.7;
    // 精英：模型上补发光光环（词缀色）
    if (this.elite) {
      const affixColor = this.elite.kind === 'frantic' ? 0xff9a3a : this.elite.kind === 'armored' ? 0x9ab8ff : 0x5affa8;
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 18), new THREE.MeshBasicMaterial({ color: affixColor }));
      halo.position.y = 1.75;
      halo.rotation.x = Math.PI / 2;
      group.add(halo);
    }
    this.root.add(group);
  }

  /** 更新 AI，返回本帧是否对玩家造成伤害事件 */
  update(dt: number, playerPos: THREE.Vector3): { melee?: number; blast?: number; spit?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }; cast?: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[] } | null {
    if (!this.alive) return null;
    const d = this.def;

    // 减速
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.root.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 0.001 ? toPlayer.normalize() : new THREE.Vector3();

    const speed = d.speed * (this.slowTimer > 0 ? this.slowFactor : 1);

    // 朝向玩家
    this.root.lookAt(playerPos.x, this.root.position.y, playerPos.z);

    if (d.kind === 'spitter') {
      this.spitCooldown -= dt;
      if (dist <= d.range && this.spitCooldown <= 0) {
        this.spitCooldown = 2.2;
        const from = this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        const to = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0));
        // 命中判定：射程内即命中（远程喷吐，无需贴脸）
        const hit = dist <= d.range;
        return hit
          ? { spit: { from, to, damage: d.damage } }
          : null;
      }
    } else if (d.kind === 'caster') {
      // 弹幕法师：保持中距离，蓄力三连弹
      this.spitCooldown -= dt;
      if (dist < 5) {
        this.root.position.addScaledVector(dir, -speed * dt); // 后撤保持距离
      } else if (dist > d.range - 2) {
        this.root.position.addScaledVector(dir, speed * dt); // 靠近射程
      }
      if (dist <= d.range && this.spitCooldown <= 0) {
        this.spitCooldown = 2.4;
        const from = this.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
        // 三连发弹幕（朝向玩家，带少量散布）
        const casts: { from: THREE.Vector3; to: THREE.Vector3; damage: number }[] = [];
        for (let i = 0; i < 3; i++) {
          const wobble = new THREE.Vector3((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.4, 0);
          casts.push({ from, to: playerPos.clone().add(new THREE.Vector3(0, 1.2, 0)).add(wobble), damage: d.damage });
        }
        return { cast: casts };
      }
    } else if (d.kind === 'boomer') {
      if (dist < 1.1) {
        // 引爆
        if (this.fuseTimer < 0) this.fuseTimer = 0.7;
      }
      if (this.fuseTimer >= 0) {
        this.fuseTimer -= dt;
        if (this.fuseTimer <= 0) {
          this.alive = false;
          return { blast: d.damage };
        }
      } else {
        this.root.position.addScaledVector(dir, speed * dt);
      }
    } else {
      // chaser：近战（带攻击冷却）
      if (dist < 1.0) {
        if (this.attackCooldown <= 0) {
          this.attackCooldown = 0.9;
          return { melee: d.damage };
        }
      } else {
        this.root.position.addScaledVector(dir, speed * dt);
      }
    }

    return null;
  }

  /** 按元素类型受伤（），返回是否死亡 */
  takeDamage(amount: number, element: Element = 'physical'): boolean {
    if (!this.alive) return false;
    // NaN/非正防护：任何异常伤害不传播（防止敌人 HP 变 NaN 导致不死/判定错乱）
    if (!Number.isFinite(amount) || amount <= 0) return false;
    // 厚甲：减伤 50%；盾兵：固定减伤
    const resist = this.elite?.kind === 'armored' ? 0.5 : (this.def.resist ?? 0);
    let final = amount * (1 - resist);
    // 元素抗性（）
    const elemRes = this.def.elementResist?.[element] ?? 0;
    if (elemRes > 0) {
      const reduction = elemRes === 1 ? 0.15 : elemRes === 2 ? 0.35 : 0.55;
      final *= (1 - reduction);
    }
    this.hp -= final;
    this.flashTimer = 0.12;
    if (this.barMesh && this.barMaterial) {
      const pct = Math.max(0, this.hp / this.def.hp);
      this.barMesh.scale.x = pct;
      this.barMesh.position.x = -0.43 * (1 - pct);
      this.barMaterial.color.setHex(pct > 0.5 ? 0x3d6b4a : pct > 0.25 ? 0xd9a44a : 0xa33b2e);
    }
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    return false;
  }

  /** 受伤闪白（每帧调用，返回是否在闪烁；仅在状态变化时改材质） */
  private flashOn = false;
  updateFlash(dt: number): boolean {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const flashing = this.flashTimer > 0;
      if (flashing !== this.flashOn) {
        this.flashOn = flashing;
        for (const child of this.root.children) {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh && mesh.material && (mesh.material as THREE.Material).type === 'MeshStandardMaterial') {
            if (flashing) {
              (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x441111);
              (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
            } else {
              (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
              (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
            }
          }
        }
      }
      return flashing;
    }
    if (this.flashOn) {
      this.flashOn = false;
      for (const child of this.root.children) {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.material && (mesh.material as THREE.Material).type === 'MeshStandardMaterial') {
          (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
          (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
        }
      }
    }
    return false;
  }

  applySlow(factor: number, seconds: number): void {
    this.slowTimer = seconds;
    this.slowFactor = factor;
  }

  /** 中心点（用于射线检测与命中判定） */
  center(): THREE.Vector3 {
    return this.root.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  }
}
