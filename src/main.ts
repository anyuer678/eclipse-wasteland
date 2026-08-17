/**
 * eclipse-wasteland �?入口（内部代号：荒原防线）
 *
 * 完整功能：主菜单 �?任务选择 �?副本（HUD/准星/技能面�?背包栏）�?结算+强化
 *   - 武器背包：数字键 1-5 / Q 切换（各武器独立弹药/能量状态）
 *   - Esc 暂停菜单；死�?通关冻结战斗并显示结算界�? *   - 快捷键：R 重开（结算态）· N 换关（结算态）· T 强化 · Y 进阶
 */
import * as THREE from 'three';
import './style.css';
import { EventBus, FixedLoop, ServiceRegistry, clamp } from './core';
import { World } from './render';
import { createAssetLib } from './render/assets';
import { Input } from './play/input';
import { PlayerController } from './play/controller';
import { TracerPool, Viewmodel, RARITY_COLORS } from './arsenal';
import type { WeaponDef, FireContext } from './arsenal';
import { Enemy, Spawner } from './horde';
import { MISSIONS, MissionFlow } from './campaign';
import { Inventory, tryUpgrade, tryAscend, loadTalents, talentBonuses, upgradeTalent, loadAchievements, addProgress, grantReward, baseStats, applyBuffs, applyBuff, tickBuffs, affixCritMult, affixSpdMult, affixEnergyMult, affixVampMult, newRun, addKillExp, rollChoices, applyChoice, runBonuses, expNeeded, BOOST_POOL, loadDaily, addDailyProgress, claimDaily } from './growth';
import { Arsenal } from './play/arsenal';
import { ROLES, findRole } from './play/roles';
import { Shell } from './shell';
import type { SkillLine } from './shell';

/** 由武器配表生成技能面板文案（数值技能面板） */
function skillLinesFor(def: WeaponDef): SkillLine[] {  const m = def.mech;
  const lines: SkillLine[] = [];
  if (m.kind === 'energy') {
    lines.push({ key: '右键', label: '过载射击', value: `消耗 ${m.cost} 能量，伤害倍率 ${m.multiplier.toFixed(1)}` });
    lines.push({ key: '左键', label: '充能', value: `每发 +${def.energyGain} 能量` });
  } else if (m.kind === 'overload') {
    lines.push({ key: 'E', label: '过载形态', value: `耗能 ${m.energyPerSec}/s，伤害提升` });
  } else if (m.kind === 'lockon') {
    lines.push({ key: '右键', label: '电弧索敌', value: `范围 ${m.range}m，伤害倍率 ${m.damageFactor.toFixed(1)}` });
  } else if (m.kind === 'slow') {
    lines.push({ key: '命中', label: '霜缓', value: `减速 ${Math.round((1 - m.factor) * 100)}% · ${m.seconds}s` });
  } else if (m.kind === 'charge') {
    lines.push({ key: '左键', label: '蓄力射击', value: `蓄满伤害×${m.maxMult.toFixed(1)}` });
  }
  lines.push({ key: '', label: '', value: `射速 ${def.rpm} · 弹匣 ${def.mag} · 暴击×${def.critMult.toFixed(1)}` });
  return lines;
}

function boot(): void {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('missing #app mount');

  // 全局错误捕获：任何运行时错误都会显示在页面角落，便于定位"突然退�?原因
  (window as unknown as Record<string, unknown>).__rarity = RARITY_COLORS;
  window.addEventListener('error', (e) => showFatal(e.message));
  window.addEventListener('unhandledrejection', (e) => showFatal(String((e as PromiseRejectionEvent).reason)));
  function showFatal(msg: string): void {
    console.error('[runtime]', msg);
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99;color:#ff8877;background:rgba(0,0,0,.85);padding:6px 10px;font:12px monospace;max-width:80vw;white-space:pre-wrap;';
    div.textContent = '[运行时错误] ' + msg.slice(0, 300);
    document.body.appendChild(div);
  }

  const events = new EventBus<{ boot: { time: number }; [k: string]: unknown }>();
  const services = new ServiceRegistry();

  const world = new World({ mount, fogNear: 14, fogFar: 46 });

  const input = new Input();
  input.attach(mount);
  world.renderer.domElement.addEventListener('click', () => world.renderer.domElement.requestPointerLock());
  /** 弹出交互界面时解锁鼠标（升级选牌/暂停/结算）；返回战斗时重新锁定 */
  const unlockMouse = (): void => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const lockMouse = (): void => {
    if (!document.pointerLockElement && !paused && !inMenu) {
      world.renderer.domElement.requestPointerLock();
    }
  };

  const inventory = new Inventory();
  const arsenal = new Arsenal(inventory);

  /** 全武器成长汇总（附魔/巅峰）——四围来源 */
  const growthSummary = (): { enchant: number; pinnacle: number } => {
    let enchant = 0;
    let pinnacle = 0;
    for (const w of arsenal.defs) {
      const g = inventory.getWeapon(w.id);
      enchant += g.enchant;
      pinnacle += g.pinnacle;
    }
    return { enchant, pinnacle };
  };

  let refreshGrowth = (): void => {
    arsenal.refreshGrowth(inventory);
    for (const w of arsenal.weapons) {
      const g = inventory.getWeapon(w.def.id);
      w.growthDamage *= 1 + bonuses.dmg;
      w.energyGainMult = (1 + bonuses.energyGain) * (1 + affixEnergyMult(g));
    }
    // 攻速倍率（敏捷/附魔 + 词缀 + 速射球 + 局内攻速）应用到武器
    const fr = computeStats().fireRateMult * (shortBuffs.fireSpd > 0 ? 1.5 : 1) * runB.spdMult;
    for (const w of arsenal.weapons) {
      const g = inventory.getWeapon(w.def.id);
      w.fireRateMult = fr * (1 + affixSpdMult(g));
      w.magMult = runB.magMult;
      w.reloadMult = runB.reloadMult;
    }
    applyMaxHpGrowth();
  };

  // 天赋（读档；加成�?shell 创建后应用）
  const talentState = loadTalents(inventory);
  let bonuses = talentBonuses(talentState);
  let maxHp = 100 + bonuses.hp;

  const player = new PlayerController({
    speed: 5.2, jumpSpeed: 6.6, gravity: 16, eyeHeight: 1.6, boundRadius: 38,
    terrainHeight: (x, z) => {
      // 地形高度：丘陵高度场（基础） + 斜坡（线性插值）+ 平台（矩形返回高度）
      const hf = (mapRoot?.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? (() => 0);
      const plats = (mapRoot?.userData.platforms ?? []) as { x: number; z: number; w: number; d: number; h: number }[];
      const ramps = (mapRoot?.userData.ramps ?? []) as { x: number; z: number; w: number; d: number; h0: number; h1: number; along: 'x' | 'z' }[];
      let h = hf(x, z);
      for (const r of ramps) {
        if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2) {
          const t = r.along === 'z' ? (z - (r.z - r.d / 2)) / r.d : (x - (r.x - r.w / 2)) / r.w;
          const rh = hf(x, z) + r.h0 + (r.h1 - r.h0) * Math.min(1, Math.max(0, t));
          if (rh > h) h = rh;
        }
      }
      for (const p of plats) {
        if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) {
          const ph = hf(x, z) + p.h;
          if (ph > h) h = ph;
        }
      }
      return h;
    },
    // 障碍碰撞：平台侧壁推回（玩家/敌人不能穿入平台内部）
    collide: (p) => {
      const plats = (mapRoot?.userData.platforms ?? []) as { x: number; z: number; w: number; d: number; h: number }[];
      for (const plat of plats) {
        if (Math.abs(p.x - plat.x) <= plat.w / 2 && Math.abs(p.z - plat.z) <= plat.d / 2) {
          if (p.y < plat.h) {
            const dx = p.x - plat.x;
            const dz = p.z - plat.z;
            const ox = plat.w / 2 - Math.abs(dx);
            const oz = plat.d / 2 - Math.abs(dz);
            if (ox < oz) p.x = plat.x + (dx >= 0 ? 1 : -1) * plat.w / 2;
            else p.z = plat.z + (dz >= 0 ? 1 : -1) * plat.d / 2;
          }
        }
      }
    },
  });
  let hp = maxHp;
  const setHp = (v: number): void => {
    hp = clamp(v, 0, maxHp);
  };

  // 武器 viewmodel：跟随当前武器重建（加载开源枪模，失败回退程序化）
  let viewmodel: Viewmodel | null = null;
  const mountViewmodel = (): void => {
    if (viewmodel) world.camera.remove(viewmodel.group);
    const w = arsenal.current;
    viewmodel = new Viewmodel(w.def.archetype, w.def.color, (name, cb) => assets.load(name, cb));
    world.camera.add(viewmodel.group);
  };

  const tracer = new TracerPool(world.scene);
  const spawner = new Spawner(world.scene, 20260813);

  // 开源模型加载：小怪 RobotExpressive（轻量），BOSS=Soldier（放大），枪械 gun_*
  const assets = createAssetLib();
  assets.load('RobotExpressive', () => rebuildRayTargets());
  assets.load('Soldier', () => rebuildRayTargets());
  mountViewmodel();
  world.add(world.camera);

  let missionIndex = 0;
  const flow = new MissionFlow(MISSIONS[missionIndex], spawner, 20260813);
  let paused = false;

  // ---------- 波次宝箱（清�?BOSS 掉落�?----------
  interface Chest {
    mesh: THREE.Group;
    reward: string;
    amount: number;
  }
  const chests: Chest[] = [];

  // ---------- 局内 BUFF 球（击杀掉落，靠近拾取） ----------
  type OrbKind = 'fireSpd' | 'crit' | 'heal' | 'energy' | 'move';
  interface Orb {
    mesh: THREE.Group;
    kind: OrbKind;
  }
  const buffOrbs: Orb[] = [];
  const ORB_KINDS: { kind: OrbKind; color: number; label: string }[] = [
    { kind: 'fireSpd', color: 0xffd24a, label: '速射' },
    { kind: 'crit', color: 0xff6a4a, label: '暴击' },
    { kind: 'heal', color: 0x4aff8a, label: '回复' },
    { kind: 'energy', color: 0x4ad9ff, label: '充能' },
    { kind: 'move', color: 0xc9a0ff, label: '疾行' },
  ];
  /** 短期增益计时（8s） */
  const shortBuffs = { fireSpd: 0, crit: 0, move: 0 };
  const SHORT_BUFF_SECONDS = 8;

  const spawnBuffOrb = (pos: THREE.Vector3): void => {
    const pick = ORB_KINDS[Math.floor(Math.random() * ORB_KINDS.length)];
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: pick.color }));
    core.position.y = 0.9;
    g.add(core);
    g.position.copy(pos);
    g.position.y = 0;
    world.scene.add(g);
    buffOrbs.push({ mesh: g, kind: pick.kind });
  };

  const pickOrb = (kind: OrbKind): void => {
    if (kind === 'heal') setHp(hp + 30);
    else if (kind === 'energy') arsenal.current.state.energy = arsenal.current.def.energyMax;
    else shortBuffs[kind] = SHORT_BUFF_SECONDS;
    if (kind === 'fireSpd' || kind === 'move') refreshGrowth();
    const label = ORB_KINDS.find((k) => k.kind === kind)?.label ?? kind;
    addDamagePopup(player.position.clone().add(new THREE.Vector3(0, 1.5, 0)), `拾取 · ${label}`, '#d9a44a');
  };

  /** 击杀掉球：12% 概率 */
  const maybeDropOrb = (pos: THREE.Vector3): void => {
    if (Math.random() < 0.12) spawnBuffOrb(pos);
  };
  const spawnChest = (big: boolean): void => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: big ? 0xd9a44a : 0x8a7a5a, roughness: 0.5, metalness: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), mat);
    box.position.y = 0.25;
    g.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.5), mat);
    lid.position.y = 0.57;
    g.add(lid);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    glow.position.y = 0.75;
    g.add(glow);
    // 随机位置（远离玩家 4-10m）
    const a = Math.random() * Math.PI * 2;
    const d = 4 + Math.random() * 6;
    g.position.set(player.position.x + Math.cos(a) * d, 0, player.position.z + Math.sin(a) * d);
    g.position.x = clamp(g.position.x, -12, 12);
    g.position.z = clamp(g.position.z, -12, 12);
    world.scene.add(g);
    // 随机奖励
    const roll = Math.random();
    let reward = '合金碎片';
    let amount = 2;
    if (big) {
      reward = roll < 0.5 ? '核心晶体' : '金币';
      amount = roll < 0.5 ? 3 : 40;
    } else if (roll < 0.45) {
      reward = '合金碎片';
      amount = 2 + Math.floor(Math.random() * 3);
    } else if (roll < 0.75) {
      reward = '金币';
      amount = 10 + Math.floor(Math.random() * 15);
    } else {
      reward = 'medkit';
      amount = 1;
    }
    chests.push({ mesh: g, reward, amount });
  };
  const pickChests = (): void => {
    for (let i = chests.length - 1; i >= 0; i--) {
      const c = chests[i];
      if (c.mesh.position.distanceTo(player.position) < 2.0) {
        world.scene.remove(c.mesh);
        chests.splice(i, 1);
        addDailyProgress(dailyState, 'chests'); // 每日任务：开箱
        if (c.reward === '合金碎片') inventory.addMaterial('合金碎片', c.amount);
        else if (c.reward === '核心晶体') inventory.addMaterial('核心晶体', c.amount);
        else if (c.reward === '金币') inventory.addGold(c.amount);
        else if (c.reward === 'medkit') inventory.addConsumable('medkit', c.amount);
      }
    }
  };

  const rayTargets: THREE.Object3D[] = [];
  let activeBoss: import('./campaign').Boss | null = null;

  const shell = new Shell(inventory, {
    onStartMission: (missionId) => {
      if (!missionId) {
        shell.showSelect();
        return;
      }
      const idx = MISSIONS.findIndex((m) => m.id === missionId);
      if (idx >= 0) missionIndex = idx;      flow.mission = MISSIONS[missionIndex];
      beginMission();
    },
    onRestart: () => beginMission(),
    onResume: () => {
      escPaused = false;
      paused = false;
      shell.hidePause();
      lockMouse();
    },
    onExitMission: () => {
      escPaused = false;
      paused = false;
      spawner.clear();
      shell.showSelect();
    },
    onOpenArmory: () => {
      shell.currentWeaponId = arsenal.current.def.id;
      shell.showArmory();
    },
    onAddToLoadout: (id) => {
      if (arsenal.addToLoadout(id)) {
        shell.currentWeaponId = arsenal.current.def.id;
      }
    },
    onRemoveFromLoadout: (id) => {
      arsenal.removeFromLoadout(id);
      if (arsenal.weapons.length === 0) {
        arsenal.addToLoadout(arsenal.defs[0]?.id ?? 'pulse-rifle');
      }
      shell.currentWeaponId = arsenal.current.def.id;
    },
    onBackArmory: () => {
      if (armoryFromCombat) {
        armoryFromCombat = false;
        paused = false;
        escPaused = false;
        shell.hideArmory();
        shell.hud.root.style.display = 'block';
        lockMouse();
      } else {
        shell.hideArmory();
        shell.showMenu();
      }
    },
    onOpenShop: () => shell.showShop(),
    onBuy: (itemId, qty) => {
      // 内购破解（免费）：点击即得，支持批量
      if (itemId === 'alloy') inventory.addMaterial('合金碎片', 5 * qty);
      else if (itemId === 'core') inventory.addMaterial('核心晶体', 3 * qty);
      else if (itemId === 'medkit') inventory.addConsumable('medkit', qty);
      else if (itemId === 'atk') inventory.addConsumable('atk', qty);
      else if (itemId === 'shield') inventory.addConsumable('shield', qty);
      else if (itemId === 'speed') inventory.addConsumable('speed', qty);
      shell.showShop();
    },
    onOpenTalent: () => shell.showTalent(),
    onUpgradeTalent: (id) => {
      if (upgradeTalent(talentState, id, inventory)) {
        bonuses = talentBonuses(talentState);
        refreshGrowth();
        shell.showTalent();
      }
    },
    onOpenForge: () => shell.showForge(),
    onForgeUpgrade: () => {
      refreshGrowth();
      addDailyProgress(dailyState, 'upgrades');
    },
    onOpenRole: () => {
      shell.currentRoleId = selectedRoleId;
      shell.showRole();
    },
    onSelectRole: (id) => {
      selectedRoleId = id;
      shell.currentRoleId = id;
      try {
        localStorage.setItem('ss-role', id);
      } catch {
        // ignore
      }
    },
    onUpgradeRole: (id) => {
      if (inventory.upgradeRole(id)) {
        shell.showRole();
      }
    },
    onOpenAchievement: () => shell.showAchievement(),
    onOpenStats: () => shell.showStats(),
    onOpenDaily: () => shell.showDaily(),
    onClaimDaily: (id) => {
      if (claimDaily(dailyState, inventory, id)) shell.showDaily();
    },
    onCombatBuy: (id) => {
      if (inventory.gold < (id === 'heal' ? 30 : id === 'dmg' ? 40 : id === 'energy' ? 20 : 35)) return;
      inventory.spendGold(id === 'heal' ? 30 : id === 'dmg' ? 40 : id === 'energy' ? 20 : 35);
      if (id === 'heal') setHp(hp + 60);
      else if (id === 'dmg') applyBuff(buffs, 'atk');
      else if (id === 'energy') arsenal.current.state.energy = arsenal.current.def.energyMax;
      else if (id === 'shield') shieldTimer = 12;
      shell.showCombatShop(inventory.gold); // 刷新剩余金币
    },
    onCombatClose: () => {
      shopOpen = false;
      paused = false;
      shell.hideCombatShop();
      shell.hud.root.style.display = 'block';
      lockMouse();
    },
    onStatsQuery: () => computeStats(),
    onPickBoost: (id) => {
      const b = applyChoice(runState, id as Parameters<typeof applyChoice>[1]);
      refreshRun();
      paused = false;
      shell.hideLevelUp();
      shell.hud.root.style.display = 'block';
      lockMouse();
      // 选牌反馈
      addDamagePopup(player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), `获得 · ${b.name} ×${runState.boosts[id as keyof typeof runState.boosts]}`, '#e8c377');
    },
    onSetDifficulty: (d) => {
      difficulty = d;
    },
  });
  // 天赋状态必须与 Shell 共享同一对象引用（createTalentScreen 捕获的是构造时的引用）
  shell.talentState.talents = talentState.talents;
  shell.achievementState = loadAchievements();
  // 每日任务：与 Shell 共享同一对象引用（createDailyScreen 捕获的是构造时的引用）
  const dailyState = loadDaily();
  shell.dailyState.date = dailyState.date;
  shell.dailyState.progress = dailyState.progress;
  shell.dailyState.claimed = dailyState.claimed;
  const achAdd = (cond: 'kills' | 'clears' | 'upgrades' | 'ascensions', amount: number): void => {
    const newly = addProgress(shell.achievementState, cond, amount);
    for (const a of newly) grantReward(inventory, a);
  };
  let escPaused = false;
  let armoryFromCombat = false;
  /** 难度（普通 1 / 困难 1.5 / 噩梦 2.2） */
  let difficulty = 1;
  /** 菜单态（不渲染 3D，省性能） */
  let inMenu = true;
  /** 局内商店打开状态 */
  let shopOpen = false;

  function beginMission(): void {
    paused = false;
    escPaused = false;
    inMenu = false;
    shell.hideLevelUp();
    // 局内成长：每局重置
    runState = newRun();
    runB = runBonuses(runState);
    spawner.clear();
    // 跨局状态重置（否则重开一局后击杀/波次推进判定失效）
    lastKills = 0;
    prevWave = -1;
    prevPhase = '';
    // 清理上一局的场景附属物（宝箱/增益球/特效）
    for (const c of chests) world.scene.remove(c.mesh);
    chests.length = 0;
    for (const o of buffOrbs) world.scene.remove(o.mesh);
    buffOrbs.length = 0;
    // 重建关卡地图（移除旧障碍，按 mapId 生成新布局�?
    if (mapRoot) {
      world.scene.remove(mapRoot);
      // dispose 纹理/材质防显存泄漏
      mapRoot.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        const mats = Array.isArray(m) ? m : [m];
        for (const mm of mats) {
          const tex = (mm as THREE.MeshStandardMaterial).map;
          tex?.dispose();
          mm.dispose();
        }
      });
    }
    mapRoot = world.buildMap(flow.mission.mapId);
    // 可破坏箱（从地图配置重建）
    crates.length = 0;
    for (const c of (mapRoot.userData.crates ?? []) as { x: number; z: number }[]) {
      crates.push({ x: c.x, z: c.z, hp: 25, alive: true });
    }
    mountEnv(); // 挂载开源环境素材（Kenney CC0：岩石/树木/灌木）
    player.position.set(0, 0, 6);
    setHp(maxHp);
    flow.difficulty = difficulty;
    flow.start();
    rebuildRayTargets();
    shell.startGame();
  }

  let mapRoot: THREE.Group | null = null;
  /** 可破坏箱（打碎掉补给） */
  interface Crate { x: number; z: number; hp: number; alive: boolean }
  const crates: Crate[] = [];

  // ---------- 开源环境素材（Kenney CC0 nature-kit） ----------
  /** 按地图类型放置的环境模型清单 */
  const ENV_MODELS: Record<string, { name: string; count: number; scale: [number, number]; y: number }[]> = {
    facility: [
      { name: 'env/env_bush', count: 8, scale: [1.8, 3.2], y: 0 },
      { name: 'env/env_log', count: 4, scale: [1.8, 3.2], y: 0.25 },
      { name: 'env/env_rockSmall', count: 6, scale: [1.6, 3], y: 0 },
      { name: 'env/env_bush', count: 14, scale: [0.5, 0.9], y: 0.05 }, // 地表草丛
    ],
    quarry: [
      { name: 'env/env_rockA', count: 7, scale: [2.2, 4.2], y: 0 },
      { name: 'env/env_rockB', count: 6, scale: [2.2, 4.2], y: 0 },
      { name: 'env/env_rockTall', count: 4, scale: [2.2, 3.6], y: 0 },
      { name: 'env/env_log', count: 3, scale: [1.8, 3.2], y: 0.25 },
      { name: 'env/env_bush', count: 12, scale: [0.5, 0.9], y: 0.05 },
    ],
    lab: [
      { name: 'env/env_treePine', count: 7, scale: [2.5, 4.2], y: 0 },
      { name: 'env/env_treeDefault', count: 5, scale: [2.5, 4.2], y: 0 },
      { name: 'env/env_rockSmall', count: 6, scale: [1.6, 3], y: 0 },
      { name: 'env/env_bush', count: 14, scale: [0.5, 0.9], y: 0.05 },
    ],
  };
  let envRoot: THREE.Group | null = null;
  const mountEnv = (): void => {
    if (envRoot) {
      envRoot.removeFromParent();
      envRoot = null;
    }
    const list = ENV_MODELS[flow.mission.mapId] ?? [];
    if (list.length === 0) return;
    envRoot = new THREE.Group();
    mapRoot?.add(envRoot);
    for (const spec of list) {
      assets.load(spec.name, (src) => {
        const base = src.clone();
        for (let i = 0; i < spec.count; i++) {
          const inst = base.clone();
          const a = Math.random() * Math.PI * 2;
          // 部分靠近中心（3-8m，出生点可见），部分外围（8-20m）
          const d = i % 2 === 0 ? 3 + Math.random() * 5 : 8 + Math.random() * 12;
          inst.position.set(Math.cos(a) * d, spec.y, Math.sin(a) * d);
          inst.scale.setScalar(spec.scale[0] + Math.random() * (spec.scale[1] - spec.scale[0]));
          inst.rotation.y = Math.random() * Math.PI * 2;
          inst.userData.envInst = true;
          envRoot?.add(inst);
        }
      });
    }
  };

  function rebuildRayTargets(): void {
    rayTargets.length = 0;
    for (const e of spawner.all()) rayTargets.push(e.root);
    if (activeBoss) rayTargets.push(activeBoss.root);
    // 小怪模型（每个敌人独立 clone，避免共�?group �?add 移走�?
    const needEnemy = spawner.all().some((e) => !e.root.userData.hasModel);
    if (needEnemy) {
      for (const e of spawner.all()) {
        if (!e.root.userData.hasModel) {
          const g = assets.get('RobotExpressive');
          if (g) {
            e.applyModel(g);
            e.root.userData.hasModel = true;
          }
        }
      }
    }
    // BOSS 模型
    if (activeBoss && !activeBoss.root.userData.hasModel) {
      const bg = assets.get('Soldier');
      if (bg) {
        activeBoss.applyModel(bg);
        activeBoss.root.userData.hasModel = true;
      }
    }
  }

  let prevWave = -1;
  let prevPhase: string = '';
  /** 连杀计数 */
  let killStreak = 0;
  let killStreakTimer = 0;

  /** 全屏大字公告 */
  function showAnnouncement(text: string, color: string, durationMs: number): void {
    if (!text) { // 纯黑幕
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:#000;z-index:9999;pointer-events:none;opacity:0;transition:opacity .2s;';
      document.body.appendChild(ov);
      requestAnimationFrame(() => { ov.style.opacity = '1'; });
      setTimeout(() => { ov.style.opacity = '0'; }, durationMs - 200);
      setTimeout(() => ov.remove(), durationMs);
      return;
    }
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:9999;pointer-events:none;';
    const inner = document.createElement('div');
    inner.style.cssText = `color:${color};font:bold 48px/1 var(--mono);letter-spacing:.15em;text-shadow:0 2px 20px ${color}88,0 0 60px ${color}44;opacity:0;transition:opacity .3s;`;
    inner.textContent = text;
    div.appendChild(inner);
    document.body.appendChild(div);
    requestAnimationFrame(() => { inner.style.opacity = '1'; });
    setTimeout(() => { inner.style.opacity = '0'; }, durationMs - 400);
    setTimeout(() => div.remove(), durationMs);
  }
  flow.onPhaseChange = (phase, _mission) => {
    if (activeBoss) world.scene.remove(activeBoss.root);
    activeBoss = flow.activeBoss;
    if (activeBoss) world.scene.add(activeBoss.root);
    rebuildRayTargets();

    // ---- 波次预告 ----
    if (phase === 'wave' && flow.waveIndex > prevWave) {
      prevWave = flow.waveIndex;
      spawnChest(false);
      const totalWaves = _mission.waves.length;
      showAnnouncement(`WAVE ${flow.waveIndex + 1} / ${totalWaves}`, '#ffffff', 1800);
      if ((flow.waveIndex + 1) % 3 === 0) {
        setTimeout(() => showAnnouncement('\u26a0 精英波来袭', '#ff4444', 2000), 800);
      }
      if (_mission.tower && flow.waveIndex % 7 === 6) {
        spawnChest(true); spawnChest(false);
        setTimeout(() => showAnnouncement('\u{1F4E6} 补给层 \u00B7 双倍掉落', '#44ff88', 2000), 500);
      }
    }

    // ---- BOSS 登场演出 ----
    if (phase === 'boss' && activeBoss) {
      showAnnouncement('', '#000000', 600);
      setTimeout(() => {
        showAnnouncement(activeBoss!.spec.name, '#' + activeBoss!.spec.color.toString(16).padStart(6, '0'), 3000);
        shell.hud.boss(activeBoss!.spec.name, activeBoss!.hp / activeBoss!.spec.hp);
      }, 600);
    }

    if (phase === 'clear') {
      spawnChest(true);
      showAnnouncement('\u2726 通关 \u2726', '#ffd700', 3000);
    }

    // 塔模式：BOSS 击杀 → 掉大宝箱 + 即时奖励
    if (_mission.tower && prevPhase === 'boss' && phase === 'wave') {
      spawnChest(true);
      const floor = flow.waveIndex;
      const diffR = difficulty >= 2 ? 3 : difficulty >= 1.5 ? 1.8 : 1;
      const gold = Math.round(20 * (1 + floor * 0.15) * diffR * (1 + runB.luckyGold));
      const mat = Math.round(2 + floor * 0.5);
      inventory.addGold(gold);
      inventory.addMaterial('\u5408\u91d1\u788e\u7247', mat);
    }
    prevPhase = phase;
  };
  flow.onResult = (result) => {
    paused = true; // 死亡/通关后冻结战斗，等待界面操作
    inMenu = true;
    unlockMouse(); // 结算界面需要鼠标操作
    // 难度奖励倍率（普通 ×1 / 困难 ×1.8 / 噩梦 ×3）× 局内幸运金币
    const diffReward = (difficulty >= 2 ? 3 : difficulty >= 1.5 ? 1.8 : 1) * (1 + runB.luckyGold);
    if (result.phase === 'clear' && result.mission.tower) {
      // 塔模式失败结算：按层数给材料/金币（层数越高越丰厚）
      const floor = result.towerFloor;
      const mat = Math.round(result.rewardAmount * (1 + floor * 0.25) * diffReward);
      const gold = Math.round(30 * (1 + floor * 0.3) * (1 + bonuses.gold) * diffReward);
      inventory.addMaterial(result.rewardMaterial, mat);
      inventory.addGold(gold);
      addDailyProgress(dailyState, 'clears'); // 每日任务：通关
      const talentGain = Math.floor(result.kills / 15);
      if (talentGain > 0) inventory.addTalentPoints(talentGain);
      achAdd('clears', 1);
      refreshGrowth();
    } else if (result.phase === 'clear') {
      inventory.addMaterial(result.rewardMaterial, Math.round(result.rewardAmount * diffReward));
      // 金币掉落（天�?搜刮"加成�? 击杀积累天赋点（�?15 击杀 +1�?
      const goldReward = Math.round(30 * (1 + bonuses.gold) * diffReward);
      inventory.addGold(goldReward);
      const talentGain = Math.floor(result.kills / 15);
      if (talentGain > 0) inventory.addTalentPoints(talentGain);
      achAdd('clears', 1);
      addDailyProgress(dailyState, 'clears'); // 每日任务：通关
      refreshGrowth();
    } else if (result.phase === 'failed' && result.mission.tower) {
      // 塔模式：失败也按层数结算部分奖励（材料固定为合金碎片，避免空 key）
      const floor = Math.max(1, result.towerFloor);
      const mat = Math.max(2, Math.round(result.rewardAmount * (1 + floor * 0.2) * diffReward));
      inventory.addMaterial('合金碎片', mat);
      inventory.addGold(Math.round(20 * (1 + floor * 0.2) * diffReward));
      refreshGrowth();
    }
    shell.showResult(result);
  };

  /** 射线-球体求交，返回最近正距离�?null */
  function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
    const oc = origin.clone().sub(center);
    const b = oc.dot(dir);
    const c = oc.dot(oc) - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : null;
  }

  const fireCtx: FireContext = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    tracer,
    resolveHit(origin, dir) {
      // 逻辑命中：射线对敌人/BOSS 球体检测（不依赖模�?mesh raycast，稳定可靠）
      let bestT = 60;
      let bestPoint: THREE.Vector3 | null = null;
      // 可破坏箱优先（若命中箱子，先打箱子）
      for (const c of crates) {
        if (!c.alive) continue;
        const t = raySphere(origin, dir, new THREE.Vector3(c.x, 0.7, c.z), 1.0);
        if (t !== null && t < bestT) {
          bestT = t;
          bestPoint = origin.clone().addScaledVector(dir, t);
        }
      }
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        // 命中半径放宽到 1.1（容忍地形高度差，玩家平视可打高处敌人）
        const t = raySphere(origin, dir, e.center(), 1.1);
        if (t !== null && t < bestT) {
          bestT = t;
          bestPoint = origin.clone().addScaledVector(dir, t);
        }
      }
      if (activeBoss && activeBoss.alive) {
        const t = raySphere(origin, dir, activeBoss.center(), 3.2);
        if (t !== null && t < bestT) {
          bestT = t;
          bestPoint = origin.clone().addScaledVector(dir, t);
        }
      }
      if (bestPoint) return bestPoint;
      if (dir.y < -1e-4) {
        const t = -origin.y / dir.y;
        if (t > 0) return origin.clone().addScaledVector(dir, t);
      }
      return origin.clone().addScaledVector(dir, 60);
    },
    onHitEnemy(pos, damage, extra) {
      let hitSomething = false;
      // 可破坏箱：优先扣箱子血（打碎掉补给）
      for (const c of crates) {
        if (!c.alive) continue;
        if (new THREE.Vector3(c.x, 0.7, c.z).distanceToSquared(pos) < 1.6) {
          c.hp -= damage;
          if (c.hp <= 0) {
            c.alive = false;
            spawnBuffOrb(new THREE.Vector3(c.x, 0.8, c.z));
            maybeDropOrb(new THREE.Vector3(c.x, 0.8, c.z));
            addDamagePopup(new THREE.Vector3(c.x, 1.2, c.z), '箱子击碎', '#ffd24a');
          }
          return true;
        }
      }
      // 连杀增伤 + 隐身增伤 + 攻击倍率 + 局内成长 + 暴击（含词缀/暴击球）
      const st = computeStats();
      const curG = inventory.getWeapon(arsenal.current.def.id);
      const critBonus = affixCritMult(curG) + (shortBuffs.crit > 0 ? 0.2 : 0) + runB.critBonus;
      const streakMult = 1 + Math.min(killStreak, 6) * 0.05;
      const isCrit = Math.random() < st.critRate + critBonus;
      const critMult = (isCrit ? st.critMult : 1) + (isCrit ? runB.critDmgBonus : 0);
      let dmg = damage * streakMult * (stealthTimer > 0 ? 2 * (1 + inventory.roleLevel(selectedRoleId) * 0.15) : 1) * st.attackMult * critMult * runB.dmgMult;
      if (!Number.isFinite(dmg) || dmg <= 0) dmg = damage; // NaN 防护
      // 高地优势：玩家比目标高 0.6m 以上 → +20% 伤害
      const targetY = activeBoss && activeBoss.alive ? activeBoss.center().y : (spawner.all().find((e) => e.alive)?.root.position.y ?? 0);
      if (player.position.y > targetY + 0.6) dmg *= 1.2;
      if (activeBoss && activeBoss.alive) {
        const bd = activeBoss.center().distanceToSquared(pos);
        // 命中球体半径 3.2，判定半径需匹配（distance² < 12）
        if (bd < 12) {
          const dead = activeBoss.takeDamage(dmg);
          if (dead) {
            flow.kills += 1;
            rebuildRayTargets();
            // BOSS 必掉 2 个 BUFF 球
            spawnBuffOrb(activeBoss.root.position.clone());
            spawnBuffOrb(activeBoss.root.position.clone().add(new THREE.Vector3(1.5, 0, 0)));
            addKillBurst(activeBoss.root.position);
          }
          hitSomething = true;
        }
      }
      if (!hitSomething) {
        let best: { e: Enemy; d: number } | null = null;
        for (const e of spawner.all()) {
          if (!e.alive) continue;
          const d = e.center().distanceToSquared(pos);
          if (best === null || d < best.d) best = { e, d };
        }
        if (best && best.d <= 3.0) {
          const e = best.e;
          if (extra.slow !== undefined) e.applySlow(extra.slow, 1.6);
          // 烈焰风暴：命中施加灼�?DOT
          if (arsenal.current.def.mech.kind === 'beam') e.applyBurn(2.2, 5);
          // 精英猎手：对精英额外伤害；狂暴：伤害 ×1.5
          const furyMult = furyTimer > 0 ? 1.5 : 1;
          const finalDmg = (e.elite ? dmg * runB.eliteDmg : dmg) * furyMult;
          // 寒霜弹：命中减速
          if (runB.frost > 0) e.applySlow(1 - runB.frost, 1.5);
          const dead = e.takeDamage(finalDmg);
          if (dead) {
            flow.kills += 1;
            rebuildRayTargets();
            maybeDropOrb(e.root.position);
            addKillBurst(e.root.position);
            spawnParticles(e.root.position, 0xffd24a, 4, 3.5);
            // 连杀系统
            killStreak += 1;
            killStreakTimer = 2.5;
            if (killStreak >= 3) {
              const streakNames: Record<number, string> = {
                3: '🔥 三连杀!', 5: '⚡ 五连杀!', 8: '💀 八连杀!',
                10: '🌟 十连杀!!', 15: '👑 十五连杀!!!', 20: '🏆 无敌!!!',
              };
              const msg = streakNames[killStreak] || `🔥 ${killStreak}连杀!`;
              const color = killStreak >= 10 ? '#ffd700' : killStreak >= 5 ? '#ff6644' : '#ff9944';
              showAnnouncement(msg, color, 1200);
              // 连杀回血
              if (killStreak >= 5) setHp(hp + 5);
              if (killStreak >= 10) setHp(hp + 10);
            }
            // 武器熟练度
            const curG = inventory.getWeapon(arsenal.current.def.id);
            curG.kills += 1;
          }
          hitSomething = true;
        }
      }
      if (hitSomething) {
        shell.hud.hitConfirm();
        const st = computeStats();
        const isCrit = Math.random() < st.critRate + affixCritMult(inventory.getWeapon(arsenal.current.def.id));
        addDamagePopup(pos, `-${Math.round(dmg)}`, isCrit ? '#ffd24a' : '#ffb0a0', isCrit ? 27 : 20);
        // 命中火花（小而淡，避免遮挡视野）
        spawnParticles(pos, isCrit ? 0xffd24a : 0xffaa66, isCrit ? 3 : 2, 2);
        // 吸血：词缀吸血 + 局内嗜血
        const vamp = affixVampMult(inventory.getWeapon(arsenal.current.def.id)) + runB.vamp;
        if (vamp > 0) setHp(hp + dmg * vamp);
        // 分裂弹：命中附近敌人溅射（伤害 × 分裂系数）
        if (runB.split > 0) {
          const splitDmg = dmg * runB.split;
          for (const se of spawner.all()) {
            if (!se.alive) continue;
            if (se.center().distanceToSquared(pos) > 9) continue;
            const sdead = se.takeDamage(splitDmg);
            if (sdead) {
              flow.kills += 1;
              rebuildRayTargets();
            }
          }
        }
      }
      return hitSomething;
    },
    findTarget(origin, maxRange) {
      let best: { e: Enemy; d: number } | null = null;
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const d = e.center().distanceToSquared(origin);
        if (d > maxRange * maxRange) continue;
        if (best === null || d < best.d) best = { e, d };
      }
      return best ? best.e.center() : null;
    },
    resolvePierce(origin, dir, max) {
      // 沿方向收集射线附近敌人（按距离排序）
      const hits: { e: Enemy; t: number }[] = [];
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const t = raySphere(origin, dir, e.center(), 0.9);
        if (t !== null) hits.push({ e, t });
      }
      hits.sort((a, b) => a.t - b.t);
      return hits.slice(0, max).map((h) => h.e.center());
    },
    onChain(pos, damage, jumps, falloff) {
      // 连锁闪电：从命中点向附近敌人弹跳，伤害逐跳衰减
      let fromPos = pos;
      let dmg = damage;
      const alive = (): Enemy[] => spawner.all().filter((e) => e.alive);
      for (let j = 0; j < jumps; j++) {
        let best: { e: Enemy; d: number } | null = null;
        for (const e of alive()) {
          const d = e.center().distanceToSquared(fromPos);
          if (d < 1e-4) continue;
          if (d < 100 && (best === null || d < best.d)) best = { e, d };
        }
        if (!best) break;
        dmg *= falloff;
        const to = best.e.center();
        tracer.fire(fromPos, to, 0x7ab0ff, 1.8);
        const dead = best.e.takeDamage(dmg);
        if (dead) {
          flow.kills += 1;
          rebuildRayTargets();
        }
        fromPos = to;
      }
    },
    onHeal(amount) {
      setHp(hp + amount);
    },
  };

  const keyState = {
    skill: false,
    restart: false,
    next: false,
    upgrade: false,
    ascend: false,
    esc: false,
    shopTab: false,
    slotNum: -1,
    cycleQ: false,
    melee: false,
    bag: false,
    dash: false,
    shield: false,
    med: false,
    buff8: false,
    buff9: false,
    buff0: false,
    role: false,
  };
  let hitFlash = 0;
  let meleeCooldown = 0;
  let lastKills = 0;

  // ---------- 玩家属性（六维 + BUFF�?----------
  const buffs = { atk: 0, shield: 0, speed: 0 };
  /** 局内成长（升级选牌） */
  let runState = newRun();
  let runB = runBonuses(runState);
  const refreshRun = (): void => {
    runB = runBonuses(runState);
    refreshGrowth();
    applySpeedMult();
    applyMaxHpGrowth();
  };
  const computeStats = (): ReturnType<typeof applyBuffs> => {
    const base = baseStats(bonuses.dmg, bonuses.hp, bonuses.energyGain, growthSummary());
    return applyBuffs(base, buffs);
  };
  // 移速倍率应用到玩家控制器（含疾行球 + 局内疾行）
  const applySpeedMult = (): void => {
    player.speedMult = computeStats().speedMult * (shortBuffs.move > 0 ? 1.4 : 1) * runB.moveMult;
  };
  applySpeedMult();
  // 最大生命随成长更新（体质/巅峰 + 局内生命强化）
  const applyMaxHpGrowth = (): void => {
    const m = 100 + computeStats().maxHpBonus + runB.maxHpBonus;
    if (m !== maxHp) {
      maxHp = m;
      hp = Math.min(hp, maxHp);
    }
  };
  applyMaxHpGrowth();

  /** 玩家受伤统一结算（护甲 + 护盾减伤 + 局内铁壁 + 荆棘反弹 + 受击无敌帧） */  let hurtInvuln = 0;
  const applyDamageToPlayer = (v: number): void => {
    if (hurtInvuln > 0) return; // 无敌帧：防多敌人同帧秒杀
    if (!Number.isFinite(v) || v <= 0) return; // NaN 防护
    hurtInvuln = 0.4;
    // 受击红色碎片
    spawnParticles(player.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff4444, 2, 2.2);
    const st = computeStats();
    const furyResist = furyTimer > 0 ? 0.3 : 0;
    const afterArmor = v * (1 - st.armor - runB.armorBonus - furyResist) * (shieldTimer > 0 ? 0.3 : 1);
    setHp(hp - Math.max(0, afterArmor));
    if (runB.thorns > 0) {
      // 荆棘：反弹伤害给最近敌人
      let best: { e: Enemy; d: number } | null = null;
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const d = e.center().distanceToSquared(player.position);
        if (best === null || d < best.d) best = { e, d };
      }
      if (best) {
        const dead = best.e.takeDamage(runB.thorns);
        if (dead) {
          flow.kills += 1;
          rebuildRayTargets();
        }
      }
    }
  };

  // ---------- 伤害跳字（屏幕空间飘字） ----------
  const popupRoot = document.createElement('div');
  popupRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:17;overflow:hidden;font-family:monospace;';
  document.body.appendChild(popupRoot);
  interface Popup {
    el: HTMLElement;
    life: number;
    maxLife: number;
    world: THREE.Vector3;
    vy: number;
  }
  const popups: Popup[] = [];
  // ---------- 击杀爆点特效（金色扩散环） ----------
  const bursts: { mesh: THREE.Mesh; life: number }[] = [];
  const addKillBurst = (pos: THREE.Vector3): void => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9 }));
    ring.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    ring.rotation.x = Math.PI / 2;
    world.scene.add(ring);
    bursts.push({ mesh: ring, life: 0.32 });
  };

  // ---------- 粒子特效（枪口火光/命中火花/受击碎片/击杀粒子） ----------
  interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }
  const particles: Particle[] = [];
  const spawnParticles = (pos: THREE.Vector3, color: number, count: number, speed: number): void => {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2));
      const vel = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 0.5, (Math.random() - 0.5) * speed);
      world.scene.add(m);
      particles.push({ mesh: m, vel, life: 0.35 });
    }
  };
  const addDamagePopup = (worldPos: THREE.Vector3, text: string, color: string, size = 17): void => {
    const el2 = document.createElement('div');
    el2.textContent = text;
    // 大字号 + 双层黑描边 + 同色微光（更醒目）
    const glow = color.replace('#', '');
    el2.style.cssText =
      `position:absolute;color:${color};font-size:${size}px;font-weight:800;` +
      `text-shadow:0 0 6px rgba(${parseInt(glow.slice(0, 2), 16)},${parseInt(glow.slice(2, 4), 16)},${parseInt(glow.slice(4, 6), 16)},0.55),` +
      `-2px 0 0 rgba(0,0,0,0.9),2px 0 0 rgba(0,0,0,0.9),0 -2px 0 rgba(0,0,0,0.9),0 2px 0 rgba(0,0,0,0.9);` +
      `transform:translate(-50%,-50%);white-space:nowrap;font-family:"Cascadia Mono",Consolas,monospace;`;
    popupRoot.appendChild(el2);
    popups.push({ el: el2, life: 0.9, maxLife: 0.9, world: worldPos.clone(), vy: 0.7 + Math.random() * 0.35 });
  };
  const updatePopups = (dt: number): void => {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life -= dt;
      p.world.y += p.vy * dt;
      // 世界坐标投影到屏�?
      const v = p.world.clone().project(world.camera);
      if (v.z < 1) {
        const x = ((v.x + 1) / 2) * window.innerWidth;
        const y = ((-v.y + 1) / 2) * window.innerHeight;
        p.el.style.left = `${x}px`;
        p.el.style.top = `${y}px`;
      }
      p.el.style.opacity = String(Math.min(1, p.life / p.maxLife));
      if (p.life <= 0) {
        p.el.remove();
        popups.splice(i, 1);
      }
    }
  };
  let dashCooldown = 0;
  let shieldTimer = 0;
  let shieldCooldown = 0;

  // ---------- 角色系统（X 键大招） ----------
  let selectedRoleId = ROLES[0].id;
  try {
    selectedRoleId = localStorage.getItem('ss-role') || ROLES[0].id;
  } catch {
    /* 隐私模式/配额满：用默认角色 */
  }
  if (!ROLES.some((r) => r.id === selectedRoleId)) selectedRoleId = ROLES[0].id;
  let roleCooldown = 0;
  let stealthTimer = 0;
  let infernoMesh: THREE.Mesh | null = null;
  let infernoTimer = 0;
  let infernoDmg = 5;
  /** 圣徒治疗场 */
  let healMesh: THREE.Mesh | null = null;
  let healTimer = 0;
  /** 狂战士狂暴计时（射速 ×1.5、受伤 -30%） */
  let furyTimer = 0;
  let summonGroup: THREE.Group | null = null;
  let summonTimer = 0;
  let summonDmg = 12;
  let summonShoot = 0;

  function useRoleSkill(): void {
    if (roleCooldown > 0) return;
    const role = findRole(selectedRoleId);
    // 角色强化：每级技能效果 +15%
    const roleMult = 1 + inventory.roleLevel(role.id) * 0.15;
    roleCooldown = role.cooldown;
    if (role.kind === 'stealth') {
      stealthTimer = role.duration * roleMult;
      tracer.fire(player.eye(), player.eye().clone().addScaledVector(fireCtx.direction, 2), role.color, 1.6);
    } else if (role.kind === 'summon') {
      // 召唤机甲分身（程序化小机器人）
      if (summonGroup) world.scene.remove(summonGroup);
      summonGroup = buildSummon(role.color);
      summonGroup.position.copy(player.position).add(new THREE.Vector3(0, 0.2, 0));
      summonDmg = 12 * roleMult;
      summonTimer = role.duration * roleMult;
      world.scene.add(summonGroup);
    } else if (role.kind === 'inferno') {
      // 炼狱灼烧场（脚下环形）
      if (infernoMesh) world.scene.remove(infernoMesh);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 2.4, 32),
        new THREE.MeshBasicMaterial({ color: role.color, transparent: true, opacity: 0.35, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(player.position).add(new THREE.Vector3(0, 0.05, 0));
      world.scene.add(ring);
      infernoMesh = ring;
      infernoDmg = 5 * roleMult;
      infernoTimer = role.duration * roleMult;
    } else if (role.kind === 'heal') {
      // 圣光治疗场（脚下绿环，5 秒回血）
      if (healMesh) world.scene.remove(healMesh);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 2.0, 32),
        new THREE.MeshBasicMaterial({ color: role.color, transparent: true, opacity: 0.35, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(player.position).add(new THREE.Vector3(0, 0.05, 0));
      world.scene.add(ring);
      healMesh = ring;
      healTimer = role.duration * roleMult;
    } else if (role.kind === 'fury') {
      // 狂暴：射速 ×1.5、受伤 -30%（4 秒）
      furyTimer = role.duration * roleMult;
      tracer.fire(player.eye(), player.eye().clone().addScaledVector(fireCtx.direction, 2), role.color, 1.6);
    }
  }

  function buildSummon(color: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), mat);
    body.position.y = 0.55;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat);
    head.position.y = 0.95;
    g.add(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0x66e0ff }));
    eye.position.set(0, 0.95, 0.12);
    g.add(eye);
    g.userData.summon = true;
    return g;
  }

  /** 右键近战：前�?2.5m 扇形内命中首个敌�?BOSS */
  function meleeAttack(): void {
    if (meleeCooldown > 0) return;
    meleeCooldown = 0.55;
    const origin = fireCtx.origin;
    const dir = fireCtx.direction;
    const meleeDamage = 30 * arsenal.current.growthDamage;
    world.scene.updateMatrixWorld(true);

    let hitSomething = false;
    // 敌人
    for (const e of spawner.all()) {
      if (!e.alive) continue;
      const c = e.center();
      const to = c.clone().sub(origin);
      const dist = to.length();
      if (dist > 2.6) continue;
      const dot = to.dot(dir) / dist;
      if (dot < 0.5) continue; // 前方�?60° 扇形
      const dead = e.takeDamage(meleeDamage);
      if (dead) {
        flow.kills += 1;
        rebuildRayTargets();
      }
      hitSomething = true;
    }
    // BOSS
    if (activeBoss && activeBoss.alive) {
      const c = activeBoss.center();
      const to = c.clone().sub(origin);
      const dist = to.length();
      if (dist <= 3.4) {
        const dead = activeBoss.takeDamage(meleeDamage);
        if (dead) {
          flow.kills += 1;
          rebuildRayTargets();
        }
        hitSomething = true;
      }
    }
    // 近战特效：准星前方短弧亮�?+ 后坐
    const from = origin.clone().addScaledVector(dir, 0.7);
    const to = origin.clone().addScaledVector(dir, 1.8);
    tracer.fire(from, to, 0xe6e1d5, 1.3);
    viewmodel?.kickNow(1.2);
    if (hitSomething) shell.hud.hitConfirm();
  }

  const loop = new FixedLoop({
    fixedDt: 1 / 60,
    onFixed: (dt, time) => {
      const snap = input.snapshot();

      // 暂停态（死亡/通关/主动暂停）：冻结玩家与战斗逻辑
      if (paused) {
        if (escPaused && snap.key('Escape') && !keyState.esc) {
          escPaused = false;
          paused = false;
          shell.hidePause();
        }
        if (snap.key('KeyR') && !keyState.restart) {
          if (flow.phase === 'clear' || flow.phase === 'failed') beginMission();
        }
        keyState.restart = snap.key('KeyR');
        keyState.esc = snap.key('Escape');
        return;
      }

      const d = input.consumeMouseDelta();
      player.look(d.dx, d.dy);
      player.update(snap, dt);

      const eye = player.eye();
      world.camera.position.copy(eye);
      world.camera.rotation.order = 'YXZ';
      world.camera.rotation.y = player.yaw;
      world.camera.rotation.x = player.pitch;

      fireCtx.origin.copy(eye);
      fireCtx.direction.set(0, 0, -1).applyQuaternion(world.camera.quaternion).normalize();

      arsenal.current.update(dt, fireCtx);

      if (snap.fire) {
        arsenal.current.fire(fireCtx);
        viewmodel?.kickNow(0.6);
      } else {
        arsenal.current.releaseFire(fireCtx);
      }
      // 右键 = 近战攻击
      if (snap.altFire && !keyState.melee) {
        meleeAttack();
        keyState.melee = true;
      } else if (!snap.altFire) {
        keyState.melee = false;
      }
      // E = 武器技能（形态切�?能量爆发/索敌�?
      if (snap.skill && !keyState.skill) arsenal.current.skill(fireCtx);
      keyState.skill = snap.skill;

      // 武器切换：数字键 1-5 / Q 循环
      const numKey = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].findIndex((k) => snap.key(k));
      if (numKey >= 0 && numKey !== keyState.slotNum) {
        if (arsenal.select(numKey)) {
          mountViewmodel();
          refreshGrowth();
          shell.currentWeaponId = arsenal.current.def.id;
        }
        keyState.slotNum = numKey;
      } else if (numKey < 0) {
        keyState.slotNum = -1;
      }
      if (snap.key('KeyQ') && !keyState.cycleQ) {
        arsenal.cycle(1);
        mountViewmodel();
        refreshGrowth();
        shell.currentWeaponId = arsenal.current.def.id;
      }
      keyState.cycleQ = snap.key('KeyQ');

      if (snap.key('KeyR') && !keyState.restart) {
        if (flow.phase === 'clear' || flow.phase === 'failed') {
          beginMission();
        } else {
          arsenal.current.reload(); // 战斗�?R = 换弹
        }
      }
      keyState.restart = snap.key('KeyR');

      // Esc 主动暂停（仅战斗态）
      if (snap.key('Escape') && !keyState.esc) {
        escPaused = true;
        paused = true;
        shell.showPause();
      }
      keyState.esc = snap.key('Escape');

      // Tab 打开局内商店（战斗中金币购买补给）
      if (snap.key('Tab') && !keyState.shopTab && !shopOpen) {
        shopOpen = true;
        paused = true;
        unlockMouse();
        shell.showCombatShop(inventory.gold);
      }
      keyState.shopTab = snap.key('Tab');

      // B 键打开背包（暂停并进入仓库；返回继续战斗）
      if (snap.key('KeyB') && !keyState.bag) {
        armoryFromCombat = true;
        paused = true;
        shell.currentWeaponId = arsenal.current.def.id;
        shell.showArmory();
      }
      keyState.bag = snap.key('KeyB');

      meleeCooldown = Math.max(0, meleeCooldown - dt);
      dashCooldown = Math.max(0, dashCooldown - dt);
      shieldCooldown = Math.max(0, shieldCooldown - dt);
      shieldTimer = Math.max(0, shieldTimer - dt);

      // 角色大招 X �?+ 状态计�?
      if (snap.key('KeyX') && !keyState.role) useRoleSkill();
      keyState.role = snap.key('KeyX');
      roleCooldown = Math.max(0, roleCooldown - dt);
      stealthTimer = Math.max(0, stealthTimer - dt);
      // 炼狱灼烧场：范围持续伤害+减�?
      if (infernoMesh && infernoTimer > 0) {
        infernoTimer -= dt;
        for (const e of spawner.all()) {
          if (!e.alive) continue;
          if (e.root.position.distanceTo(infernoMesh.position) < 2.4) {
            const dead = e.takeDamage(infernoDmg * dt * 10);
            e.applySlow(0.5, 0.5);
            if (dead) {
              flow.kills += 1;
              rebuildRayTargets();
            }
          }
        }
        if (infernoTimer <= 0) {
          world.scene.remove(infernoMesh);
          infernoMesh = null;
        }
      }
      // 圣徒治疗场：每秒回血
      if (healMesh && healTimer > 0) {
        healTimer -= dt;
        setHp(hp + 12 * dt);
        if (healTimer <= 0) {
          world.scene.remove(healMesh);
          healMesh = null;
        }
      }
      // 狂暴计时
      if (furyTimer > 0) furyTimer = Math.max(0, furyTimer - dt);
      // 机甲分身：自动攻击最近敌�?
      if (summonGroup && summonTimer > 0) {
        summonTimer -= dt;
        summonShoot -= dt;
        if (summonShoot <= 0) {
          summonShoot = 0.55;
          let best: { e: Enemy; d: number } | null = null;
          for (const e of spawner.all()) {
            if (!e.alive) continue;
            const d = e.center().distanceToSquared(summonGroup.position);
            if (d < 196 && (best === null || d < best.d)) best = { e, d };
          }
          if (best) {
            const from = summonGroup.position.clone().add(new THREE.Vector3(0, 0.8, 0));
            tracer.fire(from, best.e.center(), 0x66e0ff, 1.4);
            const dead = best.e.takeDamage(summonDmg);
            if (dead) {
              flow.kills += 1;
              rebuildRayTargets();
            }
          }
        }
        if (summonTimer <= 0) {
          world.scene.remove(summonGroup);
          summonGroup = null;
        }
      }

      // F 冲刺：向面朝方向突进
      if (snap.key('KeyF') && !keyState.dash && dashCooldown <= 0) {
        dashCooldown = 4;
        const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(-6);
        player.position.add(dir);
        player.position.x = clamp(player.position.x, -13, 13);
        player.position.z = clamp(player.position.z, -13, 13);
        tracer.fire(player.eye(), player.eye().clone().addScaledVector(fireCtx.direction, 3), 0x9fc9e8, 1.4);
      }
      keyState.dash = snap.key('KeyF');

      // G 护盾�? 秒减�?
      if (snap.key('KeyG') && !keyState.shield && shieldCooldown <= 0) {
        shieldCooldown = 10;
        shieldTimer = 3;
      }
      keyState.shield = snap.key('KeyG');

      // 7 治疗�?
      if (snap.key('Digit7') && !keyState.med) {
        if (inventory.useConsumable('medkit')) setHp(hp + 40);
      }
      keyState.med = snap.key('Digit7');

      // 8/9/0 消耗品 BUFF：攻击药水 / 护盾药剂 / 加速药水
      if (snap.key('Digit8') && !keyState.buff8) {
        if (inventory.useConsumable('atk')) applyBuff(buffs, 'atk');
      }
      keyState.buff8 = snap.key('Digit8');
      if (snap.key('Digit9') && !keyState.buff9) {
        if (inventory.useConsumable('shield')) applyBuff(buffs, 'shield');
      }
      keyState.buff9 = snap.key('Digit9');
      if (snap.key('Digit0') && !keyState.buff0) {
        if (inventory.useConsumable('speed')) applyBuff(buffs, 'speed');
      }
      keyState.buff0 = snap.key('Digit0');

      // BUFF 计时 + 能量回复（含局内能量涌动）+ 局内再生回血
      tickBuffs(buffs, dt);
      applySpeedMult();
      const regen = computeStats().energyRegen + runB.energyRegen;
      arsenal.current.state.energy = clamp(arsenal.current.state.energy + regen * dt, 0, arsenal.current.def.energyMax);
      if (runB.regenPerSec > 0 && hp < maxHp) setHp(hp + runB.regenPerSec * dt);

      if (snap.key('KeyT') && !keyState.upgrade) {
        const r = tryUpgrade(arsenal.current.def, inventory);
        if (r) achAdd('upgrades', 1);
        refreshGrowth();
      }
      keyState.upgrade = snap.key('KeyT');
      if (snap.key('KeyY') && !keyState.ascend) {
        const r = tryAscend(arsenal.current.def, inventory);
        if (r) achAdd('ascensions', 1);
        refreshGrowth();
      }
      keyState.ascend = snap.key('KeyY');

      // 连杀计时器

    // 连杀计时器
    if (killStreakTimer > 0) {
      killStreakTimer -= dt;
      if (killStreakTimer <= 0) killStreak = 0;
    }

    // 敌人 AI（隐身时敌人不攻击）
      for (const e of spawner.all()) {
        e.updateFlash(dt);
        e.tickElite(dt);
        // 地形高度：敌人走上/走下平台
        const eGround = player.terrainHeight(e.root.position.x, e.root.position.z);
        if (e.root.position.y <= eGround) e.root.position.y = eGround;
        // 障碍碰撞：敌人不穿平台侧壁
        player.collide(e.root.position as unknown as { x: number; y: number; z: number });
        if (stealthTimer > 0) continue;
        const died = e.tickBurn(dt);
        if (died) {
          flow.kills += 1;
          rebuildRayTargets();
        }
        const evt = e.update(dt, player.position);
        if (evt) {
          if (evt.melee !== undefined || evt.blast !== undefined) {
            const dmg = evt.melee ?? evt.blast ?? 0;
            if (evt.blast !== undefined) e.alive = false;
            applyDamageToPlayer(dmg);

            shell.hud.hit();
          }
          if (evt.spit) {
            tracer.fire(evt.spit.from, evt.spit.to, 0x3fb96a, 1.5);
            applyDamageToPlayer(evt.spit.damage);
            shell.hud.hit();
          }
          if (evt.cast) {
            // 弹幕法师三连弹：紫色弹道 + 伤害
            for (const c of evt.cast) {
              tracer.fire(c.from, c.to, 0xcc88ff, 1.6);
              applyDamageToPlayer(c.damage);
            }
            shell.hud.hit();
          }
        }
      }

      // BOSS AI
      if (activeBoss && activeBoss.alive) {
        const bevt = activeBoss.update(dt, player.position);
        if (bevt) {
          if (bevt.melee !== undefined) {
            applyDamageToPlayer(bevt.melee);
            shell.hud.hit();
          } else if (bevt.chargeDir) {
            if (player.position.distanceTo(activeBoss.root.position) < 7) {
              applyDamageToPlayer(14);
              shell.hud.hit();
            }
          } else if (bevt.stompRadius) {
            if (player.position.distanceTo(activeBoss.root.position) < bevt.stompRadius) {
              applyDamageToPlayer(8);
              shell.hud.hit();
            }
          } else if (bevt.summon) {
            spawner.spawnWave({ chasers: bevt.summon, boomers: 0, spitters: 0 });
            rebuildRayTargets();
          }
        }
      }

      spawner.sweep();
      rebuildRayTargets();
      pickChests();
      updatePopups(dt);
      // 击杀爆点动画
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life -= dt;
        const t = 1 - b.life / 0.32;
        b.mesh.scale.setScalar(1 + t * 5);
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.32);
        if (b.life <= 0) {
          world.scene.remove(b.mesh);
          bursts.splice(i, 1);
        }
      }
      // 粒子动画（飞散 + 下落 + 渐隐）
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.vel.y -= 12 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / 0.35);
        if (p.life <= 0) {
          world.scene.remove(p.mesh);
          particles.splice(i, 1);
        }
      }
      flow.update(dt, hp > 0);

      // 击杀成就计数 + 连杀系统 + 局内升级
      if (flow.kills > lastKills) {
        const gained = flow.kills - lastKills;
        achAdd('kills', gained);
        addDailyProgress(dailyState, 'kills', gained); // 每日任务：击杀
        lastKills = flow.kills;
        killStreak += gained;
        killStreakTimer = 5;
        // 局内成长：击杀攒经验，升级时暂停弹出 3 选 1
        for (let i = 0; i < gained; i++) {
          if (addKillExp(runState, false)) {
            paused = true;
            unlockMouse(); // 选牌界面需要鼠标
            shell.hidePause();
            shell.showLevelUp(runState.level, rollChoices(runState).map((b) => ({ id: b.id, name: b.name, desc: b.desc })));
            break;
          }
        }
      }

      tracer.update(dt);
      viewmodel?.update(dt);

      // BUFF 球：拾取检测 + 旋转动画
      for (let i = buffOrbs.length - 1; i >= 0; i--) {
        const orb = buffOrbs[i];
        orb.mesh.rotation.y += dt * 2.2;
        orb.mesh.children[0]!.position.y = 0.9 + Math.sin(time * 3 + i) * 0.15;
        if (player.position.distanceToSquared(orb.mesh.position) < 2.6) {
          pickOrb(orb.kind);
          world.scene.remove(orb.mesh);
          buffOrbs.splice(i, 1);
        }
      }
      // 短期增益计时
      for (const k of ['fireSpd', 'crit', 'move'] as const) {
        if (shortBuffs[k] > 0) {
          const before = shortBuffs[k];
          shortBuffs[k] = Math.max(0, shortBuffs[k] - dt);
          if (before > 0 && shortBuffs[k] <= 0) refreshGrowth(); // 到期恢复
        }
      }

      // HUD 更新
      if (flow.phase === 'intro' || flow.phase === 'wave' || flow.phase === 'boss') {
        const g = inventory.getWeapon(arsenal.current.def.id);
        shell.hud.update({
          hp,
          maxHp,
          energy: arsenal.current.state.energy,
          maxEnergy: arsenal.current.def.energyMax,
          weaponName: arsenal.current.def.name,
          weaponLevel: g.level,
          weaponAsc: g.ascension,
          damageMult: arsenal.current.growthDamage,
          ammo: arsenal.current.state.ammo,
          mag: arsenal.current.def.mag,
          reloading: arsenal.current.state.reloading,
          phase: flow.phase,
          wave: flow.waveIndex,
          totalWaves: flow.mission.waves.length,
          tower: !!flow.mission.tower,
          missionName: flow.mission.name,
          skillLines: skillLinesFor(arsenal.current.def)
            .concat({
              key: '局',
              label: `等级 ${runState.level}`,
              value: `经验 ${runState.exp}/${expNeeded(runState.level)} · ${BOOST_POOL.filter((b) => (runState.boosts[b.id] ?? 0) > 0).map((b) => `${b.name}×${runState.boosts[b.id]}`).join(' ') || '无强化'}`,
            })
            .concat({
              key: 'X',
              label: findRole(selectedRoleId).name,
              value: roleCooldown > 0 ? `冷却 ${Math.ceil(roleCooldown)}s` : '就绪（大招）',
            })
            .concat(
              killStreak > 0
                ? [{ key: '连杀', label: `${killStreak} 连杀`, value: `伤害+${Math.min(killStreak, 6) * 5}%` }]
                : []
            ),
          slots: arsenal.defs.map((w) => ({ name: w.name, rarity: w.rarity })),
          slotIndex: arsenal.index,
        });
        shell.hud.setSpread(snap.fire ? 0.5 : 0);
        if (activeBoss && activeBoss.alive) {
          shell.hud.boss(activeBoss.spec.name, Math.max(0, (activeBoss.hp / activeBoss.spec.hp) * 100));
        } else {
          shell.hud.hideBoss();
        }
      }

      hitFlash = Math.max(0, hitFlash - dt);
      hurtInvuln = Math.max(0, hurtInvuln - dt);
      // 毒池陷阱：玩家/敌人踩入持续掉毒伤
      const pools = (mapRoot?.userData.poisonPools ?? []) as { x: number; z: number; r: number }[];
      if (pools.length > 0 && !inMenu && flow.phase !== 'clear' && flow.phase !== 'failed') {
        for (const pool of pools) {
          const dx = player.position.x - pool.x;
          const dz = player.position.z - pool.z;
          if (dx * dx + dz * dz < pool.r * pool.r && player.position.y < 1.2) {
            setHp(hp - 8 * dt);
            if (Math.random() < 0.08) spawnParticles(player.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x3a8a4a, 1, 0.5);
          }
          // 敌人同样受毒池影响
          for (const e of spawner.all()) {
            if (!e.alive) continue;
            const ex = e.root.position.x - pool.x;
            const ez = e.root.position.z - pool.z;
            if (ex * ex + ez * ez < pool.r * pool.r && e.root.position.y < 1.2) {
              const dead = e.takeDamage(8 * dt);
              if (dead) {
                flow.kills += 1;
                rebuildRayTargets();
              }
            }
          }
        }
      }
      events.emit('frame', { tick: Math.floor(time / dt) });
    },
    onRender: () => {
      // 仅战斗/结算画面渲染 3D（菜单态纯 DOM，省渲染开销）
      if (flow.phase !== 'clear' && flow.phase !== 'failed' && !inMenu) {
        world.render();
      }
    },
  });

  events.on('boot', (p) => console.log('[bus] boot at', p.time.toFixed(2)));
  events.emit('boot', { time: 0 });

  services.register('world', world);
  services.register('spawner', spawner);

  // 开发期调试钩子（正式发布前移除�?
  const dbg = window as unknown as { __ss?: Record<string, unknown> };
  dbg.__ss = {
    teleportEnemies(offsetX: number, offsetZ: number): void {
      for (const e of spawner.all()) {
        e.root.position.set(player.position.x + offsetX, 0, player.position.z + offsetZ);
      }
      rebuildRayTargets();
    },
    heal(): void {
      setHp(maxHp);
    },
    hurt(amount: number): void {
      setHp(hp - amount);
    },
    grant(material: string, amount: number): void {
      inventory.addMaterial(material, amount);
    },
    materialOf(material: string): number {
      return inventory.material(material);
    },
    enemyHealths(): { hp: number; max: number; alive: boolean }[] {
      return spawner.all().map((e) => ({ hp: Math.max(0, Math.ceil(e.hp)), max: e.def.hp, alive: e.alive }));
    },
    enemyDump(): { childTypes: string[]; modelApplied: boolean; barOk: boolean; modelVisible: boolean }[] {
      return spawner.all().map((e) => ({
        childTypes: e.root.children.map((c) => `${c.type}[${c.name || ''}] children=${c.children.length} vis=${c.visible}`),
        modelApplied: !!e.root.userData.hasModel,
        barOk: !!e['barMesh'],
        modelVisible: e.root.children.some((c) => c.visible),
      }));
    },
    enemyTypes(): { kind: string; elite: string | null; hp: number; maxHp: number; modelH: number }[] {
      return spawner.all().map((e) => {
        // 模型实际高度（含 scale）
        let h = 0;
        const box = new THREE.Box3().setFromObject(e.root);
        h = +(box.getSize(new THREE.Vector3()).y).toFixed(2);
        return { kind: e.def.kind, elite: e.elite ? e.elite.name : null, hp: Math.round(e.hp), maxHp: Math.round(e.def.hp), modelH: h };
      });
    },
    testShot(): string {
      const eye = player.eye();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(world.camera.quaternion).normalize();
      const hit = fireCtx.resolveHit(eye, dir);
      const dist = eye.distanceTo(hit);
      return dist < 59 ? `HIT d=${dist.toFixed(2)}` : 'NO HIT';
    },
    sceneStats(): { meshes: number; skinned: number; groups: number } {
      let meshes = 0;
      let skinned = 0;
      let groups = 0;
      world.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          meshes += 1;
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned += 1;
        }
        if ((o as THREE.Group).isGroup) groups += 1;
      });
      return { meshes, skinned, groups };
    },
    viewmodelInfo(): { meshes: number; hasGunModel: boolean; box: { size: number[]; center: number[] }; children: string[] } {
      const vg = viewmodel?.group;
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
      return { meshes, hasGunModel: meshes > 8, box, children: children.slice(0, 5) };
    },
    buffState(): { atk: number; shield: number; speed: number } {
      return { ...buffs };
    },
    runDump(): { level: number; exp: number; boosts: Record<string, number> } {
      return { level: runState.level, exp: runState.exp, boosts: { ...runState.boosts } };
    },
    killAll(): { killed: number; level: number } {
      // 调试：击杀场上所有敌人（走完整击杀结算：经验/升级/每日/熟练度）
      let killed = 0;
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        if (e.takeDamage(1e9)) {
          killed += 1;
          flow.kills += 1;
          rebuildRayTargets();
          const curG = inventory.getWeapon(arsenal.current.def.id);
          curG.kills += 1;
          addDailyProgress(dailyState, 'kills', 1);
        }
      }
      if (killed > 0) {
        lastKills = flow.kills;
        killStreak += killed;
        killStreakTimer = 5;
        for (let i = 0; i < killed; i++) {
          if (addKillExp(runState, false)) {
            paused = true;
            unlockMouse();
            shell.hidePause();
            shell.showLevelUp(runState.level, rollChoices(runState).map((b) => ({ id: b.id, name: b.name, desc: b.desc })));
            break;
          }
        }
      }
      return { killed, level: runState.level };
    },
    forcePick(id: string): void {
      applyChoice(runState, id as Parameters<typeof applyChoice>[1]);
      refreshRun();
    },
    mapInfo(): { platforms: { x: number; z: number; w: number; d: number; h: number }[]; crates: number; playerY: number; playerGround: number } {
      const plats = (mapRoot?.userData.platforms ?? []) as { x: number; z: number; w: number; d: number; h: number }[];
      return { platforms: plats, crates: crates.filter((c) => c.alive).length, playerY: +player.position.y.toFixed(2), playerGround: +player.terrainHeight(player.position.x, player.position.z).toFixed(2) };
    },
    envInfo(): { instances: number; scales: number[]; positions: number[][] } {
      const scales: number[] = [];
      const positions: number[][] = [];
      let instances = 0;
      envRoot?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const inst = o.parent;
          if (inst && (inst as THREE.Group).userData.envInst) {
            instances += 1;
            scales.push(+(inst as THREE.Group).scale.x.toFixed(2));
            if (positions.length < 5) positions.push([+(inst as THREE.Group).position.x.toFixed(1), +(inst as THREE.Group).position.z.toFixed(1)]);
          }
        }
      });
      return { instances, scales: scales.slice(0, 10), positions };
    },
    terrainAt(x: number, z: number): number {
      return +player.terrainHeight(x, z).toFixed(2);
    },
    addDailyKills(n: number): void {
      addDailyProgress(dailyState, 'kills', n);
    },
    orbState(): { orbs: number; short: { fireSpd: number; crit: number; move: number } } {
      return { orbs: buffOrbs.length, short: { ...shortBuffs } };
    },
    spawnOrbHere(kind?: string): void {
      if (kind) {
        const k = kind as 'fireSpd' | 'crit' | 'heal' | 'energy' | 'move';
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
        core.position.y = 0.9;
        g.add(core);
        g.position.copy(player.position);
        world.scene.add(g);
        buffOrbs.push({ mesh: g, kind: k });
      } else {
        spawnBuffOrb(player.position.clone());
      }
    },
    addConsumable(id: string, n: number): void {
      inventory.addConsumable(id, n);
    },
    grantGold(amount: number): void {
      inventory.addGold(amount);
    },
    grantTalentPoints(amount: number): void {
      inventory.addTalentPoints(amount);
    },
    talentStateDump(): { talents: Record<string, number>; points: number } {
      return { talents: { ...talentState.talents }, points: inventory.talentPoints };
    },
    skipWave(): void {
      for (const e of spawner.all()) e.alive = false;
      spawner.sweep();
      rebuildRayTargets();
    },
    killBoss(): void {
      if (activeBoss && activeBoss.alive) {
        activeBoss.hp = 0;
        activeBoss.alive = false;
        rebuildRayTargets();
      }
    },
  };

  shell.showMenu();
  // 首次进入游戏：弹出角色选择（之后可从主菜单"角色"卡更换）
  try {
    if (!localStorage.getItem('ss-role-picked')) {
      localStorage.setItem('ss-role-picked', '1');
      shell.showRole();
    }
  } catch {
    /* 隐私模式：跳过首登引导 */
  }
  loop.start((cb) => requestAnimationFrame(cb));
}

boot();
