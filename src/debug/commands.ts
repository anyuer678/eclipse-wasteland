/**
 * debug/commands — `window.__ss` 的动作/压测命令（从 game.ts 抽出的装配层）。
 *
 * 通过 deps 访问游戏闭包内的实时状态；只做调试入口编排，不持有游戏状态。
 * 只读查询映射在 debug/queries 与 debug/stateQueries；本文件负责可变命令与采样聚合。
 */
import * as THREE from 'three';
import type { World } from '../render';
import { SpatialHash } from '../horde';
import type { NavField, Spawner } from '../horde';
import { MISSIONS } from '../campaign';
import type { Boss, MissionBarrel, MissionFlow } from '../campaign';
import type { FireContext, Viewmodel } from '../arsenal';
import type { PlayerController } from '../play/controller';
import type { Arsenal } from '../play/arsenal';
import { ROLES } from '../play/roles';
import type { OrbKind } from '../play/loot';
import type { Rng } from '../core';
import { sfx } from '../core/sfx';
import {
  addDailyProgress,
  addKillExp,
  applyChoice,
  loadTalents,
  rollChoices,
  type Inventory,
  type RunState,
} from '../growth';
import type { Shell } from '../shell';
import type { SettingsState } from '../shell/settings';
import { chestsInfo, cratesInfo, enemyHealths, enemyMotion, navInfo, obstaclesDump, playerPos, poolsInfo } from './queries';
import type { QueryDeps } from './queries';
import { buffState, combatState, runDump, uiState, weaponState } from './stateQueries';
import type { StateDeps } from './stateQueries';

export interface DebugOrb {
  mesh: THREE.Group;
  kind: OrbKind;
}

export interface CommandDeps {
  world: World;
  spawner: Spawner;
  nav: NavField;
  player: PlayerController;
  arsenal: Arsenal;
  inventory: Inventory;
  shell: Shell;
  flow: MissionFlow;
  settings: SettingsState;
  placementRng: Rng;
  fireCtx: FireContext;
  queryDeps: QueryDeps;
  stateDeps: StateDeps;
  dailyState: Shell['dailyState'];
  talentState: ReturnType<typeof loadTalents>;
  /** let 变量的实时读口 */
  boss: () => Boss | null;
  run: () => RunState;
  mapRoot: () => THREE.Group | null;
  envRoot: () => THREE.Group | null;
  viewmodel: () => Viewmodel | null;
  viewmodelWeaponId: () => string;
  perfFps: () => number;
  perfFrameMs: () => number;
  hp: () => number;
  maxHp: () => number;
  killStreak: () => number;
  expBonus: () => number;
  lastHit: () => { y: number; centerY: number; weak: boolean; boss: boolean };
  hitStopT: () => number;
  barrels: MissionBarrel[];
  crates: { alive: boolean }[];
  orbs: DebugOrb[];
  /** let 变量的写入口 */
  setMissionIndex: (i: number) => void;
  setBenchFire: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setSelectedRoleId: (id: string) => void;
  setKillStreak: (v: number) => void;
  setKillStreakTimer: (v: number) => void;
  setLastKills: (v: number) => void;
  /** 游戏闭包内的函数 */
  beginMission: () => void;
  syncBossModel: () => void;
  remountViewmodel: () => void;
  castSkill: () => void;
  releaseFire: () => void;
  setHp: (v: number) => void;
  performDash: () => void;
  applyDamageToPlayer: (v: number, src?: { x: number; z: number }) => boolean;
  refreshRun: () => void;
  onBossKilled: (boss: Boss) => void;
  spawnBuffOrb: (pos: THREE.Vector3) => void;
  igniteBarrel: (b: MissionBarrel) => void;
  unlockMouse: () => void;
}

export function createDebugApi(d: CommandDeps): Record<string, unknown> {
  return {
    /** 最近命中点/中心高度（验证弱点判定） */
    lastHit: () => d.lastHit(),
    /** 性能快照：FPS / 绘制调用 / 三角形 / 资源数 / 场上次级对象数 */
    perf(): Record<string, number> {
      const info = d.world.renderer.info;
      return {
        fps: +d.perfFps().toFixed(1),
        frameMs: +d.perfFrameMs().toFixed(2),
        calls: info.render.calls,
        postFx: d.world.postFxActive ? 1 : 0,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        dpr: +d.world.renderer.getPixelRatio().toFixed(2),
        enemies: d.spawner.all().length,
      };
    },
    /** 设置快照（探针用：确认 FOV/准星/伤害数字/低动态/音乐音量已生效） */
    settingsInfo(): { fov: number; crosshair: string; damageNumbers: boolean; lowMotion: boolean; musicVolume: number } {
      return {
        fov: +d.world.camera.fov.toFixed(1),
        crosshair: d.settings.crosshair,
        damageNumbers: d.settings.damageNumbers,
        lowMotion: d.settings.lowMotion,
        musicVolume: +d.settings.musicVolume.toFixed(2),
      };
    },
    setQuality(level: 'low' | 'medium' | 'high', auto = false): string {
      d.world.setQuality(level, auto);
      return d.world.quality;
    },
    /** 直接进入指定副本（跳过菜单，压测用） */
    enterCombat(index = 0): void {
      document.querySelectorAll('.ss-screen').forEach((s) => s.classList.add('hidden'));
      d.setMissionIndex(Math.max(0, Math.min(MISSIONS.length - 1, index)));
      d.flow.mission = MISSIONS[Math.max(0, Math.min(MISSIONS.length - 1, index))];
      d.beginMission();
    },
    /** 压力测试：一次刷 n 只追击怪（hpMult 拉高避免被打死，便于稳态采样） */
    spawnStress(n = 20, spread = 14, hpMult = 1e6): void {
      d.spawner.spawnWave({ chasers: n, boomers: 0, spitters: 0 }, { hpMult });
      d.syncBossModel();
      const placed: { x: number; z: number; r: number }[] = [];
      for (const e of d.spawner.all()) {
        const spot = d.nav.findSpawnPoint(
          () => d.placementRng.next(),
          d.player.position.x,
          d.player.position.z,
          4,
          Math.max(8, spread),
          placed,
          1.2
        );
        if (spot) {
          e.place(spot.x, spot.z, spot.y);
          placed.push({ x: spot.x, z: spot.z, r: e.def.radius });
        }
      }
    },
    /** 调整视角（截图/调试用） */
    setView(yaw: number, pitch: number): void {
      d.player.yaw = yaw;
      d.player.pitch = Math.max(-1.5, Math.min(1.5, pitch));
    },
    /** 传送到指定水平位置（贴地） */
    moveTo(x: number, z: number): void {
      d.player.position.set(x, d.player.terrainHeight(x, z), z);
    },
    /** 调试：把 BOSS 挪到指定水平位置（寻路回归用） */
    moveBoss(x: number, z: number): void {
      if (!d.boss()) return;
      d.boss()!.root.position.set(x, d.player.terrainHeight(x, z), z);
    },
    /** BOSS 状态与动画（调试用） */
    bossInfo(): Record<string, unknown> | null {
      const boss = d.boss();
      if (!boss) return null;
      const p = boss.root.position;
      return {
        hp: Math.round(boss.hp),
        maxHp: Math.round(boss.maxHp),
        phase: boss.phase,
        children: boss.root.children.length,
        anim: boss.animState(),
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        z: +p.z.toFixed(2),
        ground: +d.player.terrainHeight(p.x, p.z).toFixed(2),
        dist: +Math.hypot(p.x - d.player.position.x, p.z - d.player.position.z).toFixed(2),
        alive: boss.alive,
        charging: boss.isCharging(),
      };
    },
    /** 按兵种刷怪（调试/截图用） */
    spawnKinds(counts: Partial<Record<string, number>>, hpMult = 1e6): number {
      d.spawner.spawnWave(
        {
          chasers: counts.chaser ?? 0,
          boomers: counts.boomer ?? 0,
          spitters: counts.spitter ?? 0,
          guards: counts.guard ?? 0,
          berserkers: counts.berserker ?? 0,
          casters: counts.caster ?? 0,
          healers: counts.healer ?? 0,
          turrets: counts.turret ?? 0,
        },
        { hpMult }
      );
      d.syncBossModel();
      // 排成一排摆在玩家正前方（截图/对比用），落点贴地
      const list = d.spawner.all();
      for (let i = 0; i < list.length; i++) {
        const off = (i - (list.length - 1) / 2) * 1.55;
        const x = d.player.position.x + off;
        const z = d.player.position.z - 5;
        list[i].place(x, z, d.player.terrainHeight(x, z));
      }
      return list.length;
    },
    /** 调试：生成一只保底精英摆到玩家正前方（精英播报/光环探针用） */
    spawnElite(): number {
      d.spawner.spawnWave({ chasers: 1, boomers: 0, spitters: 0 }, { eliteGuaranteed: 1, eliteChance: 1 });
      const list = d.spawner.all();
      const e = list[list.length - 1];
      const x = d.player.position.x;
      const z = d.player.position.z - 6;
      e.place(x, z, d.player.terrainHeight(x, z));
      d.syncBossModel();
      return list.length;
    },
    /** 关卡切换用的环境统计已由 envInfo 提供 */

    /** 开关自动开火（压测命中特效链路） */
    setBenchFire(on: boolean): void {
      d.setBenchFire(on);
    },
    teleportEnemies(offsetX: number, offsetZ: number): void {
      for (const e of d.spawner.all()) {
        const x = d.player.position.x + offsetX;
        const z = d.player.position.z + offsetZ;
        e.place(x, z, d.player.terrainHeight(x, z));
      }
      d.syncBossModel();
    },
    /** 调试：把指定序号的敌人放到世界坐标（穿透/排队类命中探针用） */
    placeEnemy(index: number, x: number, z: number): boolean {
      const e = d.spawner.all()[index];
      if (!e) return false;
      e.place(x, z, d.player.terrainHeight(x, z));
      return true;
    },
    /** 调试：对指定敌人造成伤害（治疗/减伤类探针用） */
    damageEnemy(index: number, amount: number): boolean {
      const e = d.spawner.all()[index];
      if (!e || !e.alive) return false;
      return e.takeDamage(amount);
    },
    heal(): void {
      d.setHp(d.maxHp());
    },
    hurt(amount: number, sx?: number, sz?: number): void {
      d.applyDamageToPlayer(amount, sx !== undefined && sz !== undefined ? { x: sx, z: sz } : undefined);
    },
    /** 触发一次冲刺（调试口：验证无敌帧/完美闪避） */
    dash: () => d.performDash(),
    /** 走完整受击管线（护甲/护盾/无敌帧），用于验证冲刺无敌帧 */
    damagePlayer(amount: number): boolean {
      return d.applyDamageToPlayer(amount);
    },
    grant(material: string, amount: number): void {
      d.inventory.addMaterial(material, amount);
    },
    materialOf(material: string): number {
      return d.inventory.material(material);
    },
    /** 调试：当前金币（商店/结算探针用） */
    goldOf(): number {
      return d.inventory.gold;
    },
    enemyHealths: () => enemyHealths(d.queryDeps),
    /** 敌人运动采样：位置/地面高度/与玩家距离/卡位状态（AI 调试与回归用） */
    enemyMotion: () => enemyMotion(d.queryDeps),
    playerHp(): number {
      return Math.round(d.hp());
    },
    /** 调试：UI/暂停状态（验证面板开关与输入分支） */
    uiState: () => uiState(d.stateDeps),
    /** 调试：设置当前武器击杀数（不刷新倍率，用于熟练度里程碑回归） */
    setWeaponKills(n: number): void {
      d.inventory.getWeapon(d.arsenal.current.def.id).kills = Math.max(0, Math.floor(n));
    },
    /** 调试：切换/加入出战武器（机制与进阶效果回归用） */
    useWeapon(id: string): boolean {
      const ids = d.arsenal.loadoutIds();
      if (ids.includes(id)) {
        d.arsenal.select(ids.indexOf(id));
        d.remountViewmodel();
        d.shell.currentWeaponId = id;
        return true;
      }
      if (d.arsenal.isLoadoutFull()) d.arsenal.removeFromLoadout(ids[0]);
      const ok = d.arsenal.addToLoadout(id);
      if (ok) {
        d.arsenal.select(d.arsenal.loadoutIds().indexOf(id));
        d.remountViewmodel();
        d.shell.currentWeaponId = id;
      }
      return ok;
    },
    /** 调试：设置当前武器进阶阶数 0-3（进阶效果回归用） */
    setWeaponAscension(n: number): void {
      const g = d.inventory.getWeapon(d.arsenal.current.def.id);
      g.ascension = Math.max(0, Math.min(3, Math.floor(n)));
      d.arsenal.refreshGrowth(d.inventory);
    },
    /** 调试：释放当前武器主动技能（E 键；过载开关连带移速刷新） */
    castSkill: () => d.castSkill(),
    /** 调试：松开左键（蓄力武器满蓄结算回归用） */
    releaseFire: () => d.releaseFire(),
    /** 调试：充满当前武器能量（能量爆发/过载回归用） */
    fillEnergy(): void {
      d.arsenal.current.state.energy = d.arsenal.current.def.energyMax;
    },
    /** 调试：当前武器与第一人称模型是否一致（仓库换枪回归） */
    weaponState: () => weaponState(d.stateDeps),
    /** 调试：跨局战斗状态（验证重开清理） */
    combatState: () => combatState(d.stateDeps),
    /** 调试：当前 hit-stop 剩余时长（击杀/弱点顿帧观测） */
    hitstop: () => d.hitStopT(),
    poolsInfo: () => poolsInfo(d.queryDeps),
    /** 调试：宝箱落点/奖励 */
    chestsInfo: () => chestsInfo(d.queryDeps),
    /** 调试：木箱位置/存活（校验是否被平台吞掉） */
    cratesInfo: () => cratesInfo(d.queryDeps),
    barrelsInfo: () => d.barrels.map((b, i) => ({ i, x: b.x, z: b.z, hp: b.hp, alive: b.alive, fuse: b.fuse })),
    igniteBarrel: (i: number) => {
      const b = d.barrels[i];
      if (b) d.igniteBarrel(b);
      return d.barrels.map((b2) => b2.alive);
    },
    playerPos: () => playerPos(d.queryDeps),
    /** 调试：切换角色（验证召唤/炼狱等角色技能的视线判定） */
    setRole(id: string): boolean {
      if (!ROLES.some((r) => r.id === id)) return false;
      d.setSelectedRoleId(id);
      return true;
    },
    /** 导航网格状态（校验换图后是否成功烘焙） */
    navInfo: () => navInfo(d.queryDeps),
    /** 碰撞体列表（地图调试：确认随机道具是否堵路） */
    obstaclesDump: () => obstaclesDump(d.queryDeps),
    /** 单点导航探针：可走/可达/流场方向（AI 调试用） */
    navProbe(x: number, z: number): { walkable: boolean; reachable: boolean; dx: number; dz: number; dist: number; rawDx: number; rawDz: number } {
      d.nav.updateTarget(d.player.position.x, d.player.position.z);
      const out = { x: 0, z: 0 };
      d.nav.steer(x, z, d.player.terrainHeight(x, z), out);
      const raw = { x: 0, z: 0 };
      const rawOk = d.nav.rawFlow(x, z, raw);
      return {
        walkable: d.nav.isWalkable(x, z),
        reachable: d.nav.reachable(x, z),
        dx: +out.x.toFixed(2),
        dz: +out.z.toFixed(2),
        dist: d.nav.distanceAt(x, z),
        rawDx: rawOk ? +raw.x.toFixed(2) : 0,
        rawDz: rawOk ? +raw.z.toFixed(2) : 0,
      };
    },
    /** 分离审计：当前场上敌人里，空间哈希是否覆盖了所有真实重叠对 */
    separationAudit(): { crowd: number; hashPairs: number; brutePairs: number; missing: number } {
      const crowd = d.spawner.all().filter((e) => e.alive);
      const hash = new SpatialHash(1.5);
      const pos = crowd.map((e) => e.root.position);
      pos.forEach((p, i) => hash.insert(i, p.x, p.z));
      const pairs = hash.pairs();
      const hashSet = new Set<string>();
      for (let k = 0; k < pairs.length; k += 2) hashSet.add(`${pairs[k]},${pairs[k + 1]}`);
      let brute = 0;
      let missing = 0;
      for (let i = 0; i < crowd.length; i++) {
        for (let j = i + 1; j < crowd.length; j++) {
          const need = crowd[i].def.radius + crowd[j].def.radius + 0.12;
          if (Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z) < need) {
            brute += 1;
            if (!hashSet.has(`${i},${j}`)) missing += 1;
          }
        }
      }
      return { crowd: crowd.length, hashPairs: pairs.length / 2, brutePairs: brute, missing };
    },
    enemyDump(): { childTypes: string[]; modelApplied: boolean; barOk: boolean; modelVisible: boolean }[] {
      return d.spawner.all().map((e) => ({
        childTypes: e.root.children.map((c) => `${c.type}[${c.name || ''}] children=${c.children.length} vis=${c.visible}`),
        modelApplied: e.root.children.some((c) => (c as THREE.Mesh).isMesh),
        // 血条为精灵（第 2 个子节点），满血时隐藏
        barOk: e.root.children.some((c) => (c as THREE.Sprite).isSprite),
        modelVisible: e.root.children.some((c) => c.visible),
      }));
    },
    enemyTypes(): { kind: string; elite: string | null; hp: number; maxHp: number; modelH: number }[] {
      return d.spawner.all().map((e) => {
        // 模型实际高度（含 scale）
        let h = 0;
        const box = new THREE.Box3().setFromObject(e.root);
        h = +(box.getSize(new THREE.Vector3()).y).toFixed(2);
        return { kind: e.def.kind, elite: e.elite ? e.elite.name : null, hp: Math.round(e.hp), maxHp: Math.round(e.def.hp), modelH: h };
      });
    },
    testShot(): string {
      const eye = d.player.eye();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(d.world.camera.quaternion).normalize();
      const hit = d.fireCtx.resolveHit(eye, dir);
      const dist = eye.distanceTo(hit);
      return dist < 59 ? `HIT d=${dist.toFixed(2)}` : 'NO HIT';
    },
    sceneStats(): { meshes: number; skinned: number; groups: number } {
      let meshes = 0;
      let skinned = 0;
      let groups = 0;
      d.world.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          meshes += 1;
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1;
        }
        if ((o as THREE.Group).isGroup) groups += 1;
      });
      return { meshes, skinned, groups };
    },
    viewmodelInfo(): { meshes: number; hasGunModel: boolean; box: { size: number[]; center: number[] }; children: string[] } {
      const vg = d.viewmodel()?.group;
      let meshes = 0;
      const children: string[] = [];
      let box = { size: [0, 0, 0], center: [0, 0, 0] };
      if (vg) {
        const bb = new THREE.Box3().setFromObject(vg);
        const size = bb.getSize(new THREE.Vector3());
        const center = bb.getCenter(new THREE.Vector3());
        box = { size: [size.x, size.y, size.z], center: [center.x, center.y, center.z] };
        vg.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes += 1;
        });
      }
      let gunBox: Record<string, number[]> | null = null;
      let gun: THREE.Object3D | null = null;
      vg?.traverse((o) => {
        if (o.userData.gun) gun = o;
      });
      if (gun) {
        const gb = new THREE.Box3().setFromObject(gun);
        const gs = gb.getSize(new THREE.Vector3());
        const gc = gb.getCenter(new THREE.Vector3());
        gunBox = { size: [+gs.x.toFixed(3), +gs.y.toFixed(3), +gs.z.toFixed(3)], center: [+gc.x.toFixed(3), +gc.y.toFixed(3), +gc.z.toFixed(3)] };
      }
      return { meshes, hasGunModel: meshes > 8, box, gunBox, children: children.slice(0, 5) } as unknown as {
        meshes: number;
        hasGunModel: boolean;
        box: { size: number[]; center: number[] };
        children: string[];
      };
    },
    buffState: () => buffState(d.stateDeps),
    runDump: () => runDump(d.stateDeps),
    /** 调试：直接设置局内强化层数（验证 HUD/倍率刷新） */
    setBoost(id: string, stacks: number): boolean {
      const run = d.run();
      if (!(id in run.boosts)) return false;
      run.boosts[id as keyof typeof run.boosts] = Math.max(0, Math.floor(stacks));
      d.refreshRun();
      return true;
    },
    killAll(): { killed: number; level: number } {
      // 调试：击杀场上所有敌人（走完整击杀结算：经验/升级/每日/熟练度）
      let killed = 0;
      for (const e of d.spawner.all()) {
        if (!e.alive) continue;
        if (e.takeDamage(1e9)) {
          killed += 1;
          d.flow.kills += 1;
          d.syncBossModel();
          const curG = d.inventory.getWeapon(d.arsenal.current.def.id);
          curG.kills += 1;
          addDailyProgress(d.dailyState, 'kills', 1);
        }
      }
      if (killed > 0) {
        d.setLastKills(d.flow.kills);
        d.setKillStreak(d.killStreak() + killed);
        d.setKillStreakTimer(5);
        for (let i = 0; i < killed; i++) {
          if (addKillExp(d.run(), false, 1, 1 + d.expBonus())) {
            sfx.levelUp();
            d.setPaused(true);
            d.unlockMouse();
            d.shell.hidePause();
            d.shell.showLevelUp(d.run().level, rollChoices(d.run()).map((b) => ({ id: b.id, name: b.name, desc: b.desc })));
            break;
          }
        }
      }
      return { killed, level: d.run().level };
    },
    forcePick(id: string): void {
      applyChoice(d.run(), id as Parameters<typeof applyChoice>[1]);
      d.refreshRun();
    },
    mapInfo(): { platforms: { x: number; z: number; w: number; d: number; h: number }[]; crates: number; playerY: number; playerGround: number; ground: boolean; ambient: boolean } {
      const root = d.mapRoot();
      const plats = (root?.userData.platforms ?? []) as { x: number; z: number; w: number; d: number; h: number }[];
      return {
        platforms: plats,
        crates: d.crates.filter((c) => c.alive).length,
        playerY: +d.player.position.y.toFixed(2),
        playerGround: +d.player.terrainHeight(d.player.position.x, d.player.position.z).toFixed(2),
        ground: !!root?.userData.ground,
        ambient: !!root?.userData.ambient,
      };
    },
    envInfo(): { instances: number; scales: number[]; positions: number[][] } {
      const scales: number[] = [];
      const positions: number[][] = [];
      let instances = 0;
      d.envRoot()?.traverse((o) => {
        const inst = o as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          instances += inst.count;
          const m = new THREE.Matrix4();
          for (let i = 0; i < Math.min(inst.count, 6); i++) {
            inst.getMatrixAt(i, m);
            const p = new THREE.Vector3();
            const q = new THREE.Quaternion();
            const sc = new THREE.Vector3();
            m.decompose(p, q, sc);
            scales.push(+sc.x.toFixed(2));
            if (positions.length < 5) positions.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
          }
        }
      });
      return { instances, scales: scales.slice(0, 10), positions };
    },
    terrainAt(x: number, z: number): number {
      return +d.player.terrainHeight(x, z).toFixed(2);
    },
    addDailyKills(n: number): void {
      addDailyProgress(d.dailyState, 'kills', n);
    },
    orbState(): { orbs: number; short: { fireSpd: number; crit: number; move: number } } {
      return { orbs: d.orbs.length, short: { ...d.stateDeps.shortBuffs() } };
    },
    /** 调试：在指定水平位置生成 BUFF 球（校验平台/坡上的贴地） */
    spawnOrbAt(x: number, z: number): void {
      d.spawnBuffOrb(new THREE.Vector3(x, 0, z));
    },
    orbsInfo(): { x: number; y: number; z: number; ground: number }[] {
      return d.orbs.map((o) => ({
        x: +o.mesh.position.x.toFixed(2),
        y: +o.mesh.position.y.toFixed(2),
        z: +o.mesh.position.z.toFixed(2),
        ground: +d.player.terrainHeight(o.mesh.position.x, o.mesh.position.z).toFixed(2),
      }));
    },
    spawnOrbHere(kind?: string): void {
      if (kind) {
        const k = kind as 'fireSpd' | 'crit' | 'heal' | 'energy' | 'move';
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
        core.position.y = 0.9;
        g.add(core);
        g.position.copy(d.player.position);
        d.world.scene.add(g);
        d.orbs.push({ mesh: g, kind: k });
      } else {
        d.spawnBuffOrb(d.player.position.clone());
      }
    },
    addConsumable(id: string, n: number): void {
      d.inventory.addConsumable(id, n);
    },
    grantGold(amount: number): void {
      d.inventory.addGold(amount);
    },
    grantTalentPoints(amount: number): void {
      d.inventory.addTalentPoints(amount);
    },
    talentStateDump(): { talents: Record<string, number>; points: number } {
      return { talents: { ...d.talentState.talents }, points: d.inventory.talentPoints };
    },
    skipWave(): void {
      for (const e of d.spawner.all()) e.alive = false;
      d.spawner.sweep();
      d.syncBossModel();
    },
    killBoss(): void {
      const boss = d.boss();
      if (boss && boss.alive) {
        boss.hp = 0;
        boss.alive = false;
        d.syncBossModel();
      }
    },
    /** 调试：对 BOSS 造成伤害并走统一死亡结算（验证经验/掉落/塔模式升级队列） */
    damageBoss(amount: number): { dead: boolean; hp: number } | null {
      const boss = d.boss();
      if (!boss || !boss.alive) return null;
      const dead = boss.takeDamage(amount);
      if (dead) d.onBossKilled(boss);
      return { dead, hp: Math.max(0, Math.round(boss.hp)) };
    },
  };
}
