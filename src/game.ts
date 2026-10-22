/**
 * eclipse-wasteland �?入口（内部代号：荒原防线）
 *
 * 完整功能：主菜单 �?任务选择 �?副本（HUD/准星/技能面�?背包栏）�?结算+强化
 *   - 武器背包：数字键 1-5 / Q 切换（各武器独立弹药/能量状态）
 *   - Esc 暂停菜单；死�?通关冻结战斗并显示结算界�? *   - 快捷键：R 重开（结算态）· N 换关（结算态）· T 强化 · Y 进阶
 */
import * as THREE from 'three';
import { EventBus, FixedLoop, Rng, ServiceRegistry, clamp } from './core';
import { sfx } from './core/sfx';
import { World, SPAWN_POINT, nearSpawn } from './render';
import { Fx } from './render/fx';
import { createAssetLib } from './render/assets';
import { Input } from './play/input';
import { Radar } from './shell/radar';
import { createSettingsPanel, loadSettings } from './shell/settings';
import { PlayerController } from './play/controller';
import { TracerPool, Viewmodel, RARITY_COLORS } from './arsenal';
import type { WeaponDef, FireContext } from './arsenal';
import { Enemy, NavField, Spawner, separationDelta } from './horde';
import type { Element, NavObstacle } from './horde';
import { ProjectilePool } from './horde/projectiles';
import { MISSIONS, MissionFlow } from './campaign';
import { Inventory, tryUpgrade, tryAscend, loadTalents, talentBonuses, upgradeTalent, loadAchievements, addProgress, grantReward, baseStats, applyBuffs, applyBuff, tickBuffs, affixCritMult, affixSpdMult, affixEnergyMult, affixVampMult, newRun, addKillExp, rollChoices, applyChoice, runBonuses, expNeeded, BOOST_POOL, loadDaily, ensureDaily, addDailyProgress, claimDaily, suppressionDealt, suppressionTaken } from './growth';
import { Arsenal } from './play/arsenal';
import { ROLES, findRole } from './play/roles';
import { Shell } from './shell';
import type { SkillLine } from './shell';

/** 由武器配表生成技能面板文案（数值技能面板） */
function skillLinesFor(def: WeaponDef): SkillLine[] {  const m = def.mech;
  const lines: SkillLine[] = [];
  if (m.kind === 'energy') {
    lines.push({ key: 'E', label: '过载射击', value: `消耗 ${m.cost} 能量，伤害倍率 ${m.multiplier.toFixed(1)}` });
    lines.push({ key: '左键', label: '充能', value: `每发 +${def.energyGain} 能量` });
  } else if (m.kind === 'overload') {
    lines.push({ key: 'E', label: '过载形态', value: `耗能 ${m.energyPerSec}/s，伤害提升` });
  } else if (m.kind === 'lockon') {
    lines.push({ key: 'E', label: '电弧索敌', value: `范围 ${m.range}m，伤害倍率 ${m.damageFactor.toFixed(1)} · 冷却 ${m.cooldown.toFixed(1)}s` });
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

  const world = new World({ mount });
  /** 战斗特效层：粒子 / 冲击环 / 跳字统一走 GPU 与单 canvas */
  const fx = new Fx(world.scene);
  // 电影感压角（纯 CSS 合成，零 WebGL 开销）
  const grade = document.createElement('div');
  grade.id = 'ss-grade';
  document.body.appendChild(grade);

  const input = new Input();
  input.attach(mount);
  /** 指针锁定安全壳：sandbox/无头环境会抛 WrongDocumentError，不能让全局错误层接管 */
  const requestPointerLockSafe = (): void => {
    try {
      const ret = world.renderer.domElement.requestPointerLock() as unknown;
      if (ret && typeof (ret as Promise<void>).catch === 'function') (ret as Promise<void>).catch(() => {});
    } catch {
      /* 环境不支持指针锁定：忽略，仍可继续游戏 */
    }
  };
  world.renderer.domElement.addEventListener('click', requestPointerLockSafe);
  /** 弹出交互界面时解锁鼠标（升级选牌/暂停/结算）；返回战斗时重新锁定 */
  const unlockMouse = (): void => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const lockMouse = (): void => {
    if (!document.pointerLockElement && !paused && !inMenu) requestPointerLockSafe();
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

  /** 属性汇总缓存：computeStats 每帧被多处调用，避免重复遍历武器/背包 */
  let statsCache: ReturnType<typeof applyBuffs> | null = null;

  let refreshGrowth = (): void => {
    statsCache = null;
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

  // 地形高度：丘陵高度场（基础） + 斜坡（线性插值）+ 平台（矩形返回高度）
  const terrainHeightAt = (x: number, z: number): number => {
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
  };

  const player = new PlayerController({
    speed: 5.2, jumpSpeed: 6.6, gravity: 16, eyeHeight: 1.6, boundRadius: 38,
    terrainHeight: terrainHeightAt,
    // 障碍碰撞：按地图碰撞体把角色沿最小穿透方向推回。
    // 侧壁判定要兼顾平台顶面与斜坡收口：只看 p.y 会被重力每帧几毫米的下坠误判成"撞墙"，
    // 把站在平台上的玩家挤下去。
    collide: (p) => {
      const obs = (mapRoot?.userData.obstacles ?? []) as { x: number; z: number; hw: number; hd: number; top: number }[];
      const R = 0.34;
      const groundHere = terrainHeightAt(p.x, p.z);
      for (const o of obs) {
        if (p.y >= o.top - 0.2) continue; // 已站上/高于顶面
        // 斜坡收口：脚下地形已接近顶面且人贴着坡面走，允许迈上去
        if (groundHere >= o.top - 0.55 && p.y >= o.top - 0.55) continue;
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const ox = o.hw + R - Math.abs(dx);
        const oz = o.hd + R - Math.abs(dz);
        if (ox <= 0 || oz <= 0) continue;
        if (ox < oz) p.x = o.x + (dx >= 0 ? 1 : -1) * (o.hw + R);
        else p.z = o.z + (dz >= 0 ? 1 : -1) * (o.hd + R);
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
    viewmodel = new Viewmodel(w.def.archetype, w.def.color);
    world.camera.add(viewmodel.group);
  };

  const tracer = new TracerPool(world.scene);
  const spawner = new Spawner(world.scene, 20260813);
  /** 小怪导航流场：换图时烘焙，玩家跨格时更新 */
  const nav = new NavField();
  /** BOSS 专用导航：体积更大，用更宽的膨胀半径单独烘焙 */
  const bossNav = new NavField();
  /** 刷怪落点专用随机（与战斗随机分离，保证波次可复现） */
  const placementRng = new Rng(20260814);

  // 开源模型加载：BOSS=Soldier（放大），枪械 gun_*，环境装饰 env/*（小怪改为程序化合并网格）
  const assets = createAssetLib();
  assets.load('Soldier', () => syncBossModel());
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
    // 贴真实地面：平台/坡上的掉落物不能固定写 y=0
    g.position.set(pos.x, player.terrainHeight(pos.x, pos.z), pos.z);
    world.scene.add(g);
    buffOrbs.push({ mesh: g, kind: pick.kind });
  };

  /** 掉落拾取：同层 + 中间没有掩体阻挡（避免隔墙/隔平台吸走） */
  const canPickupLoot = (x: number, y: number, z: number): boolean =>
    Math.abs(player.position.y - y) < 0.9 &&
    nav.lineClear(player.position.x, player.position.z, x, z, player.position.y, 0.2);

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
    // 随机位置（远离玩家 4-10m）：优先走导航落点，保证不埋墙/平台，且贴真实地形；
    // 同时避开场上已有宝箱，避免补给层多箱重叠成一堆
    const occupied = chests.map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z, r: 0.5 }));
    const spot = nav.findSpawnPoint(() => Math.random(), player.position.x, player.position.z, 4, 10, occupied, 1.0);
    if (spot) {
      g.position.set(spot.x, spot.y, spot.z);
    } else {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 6;
      const x = clamp(player.position.x + Math.cos(a) * d, -38, 38);
      const z = clamp(player.position.z + Math.sin(a) * d, -38, 38);
      g.position.set(x, player.terrainHeight(x, z), z);
    }
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
      if (
        c.mesh.position.distanceTo(player.position) < 2.0 &&
        canPickupLoot(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z)
      ) {
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

  let activeBoss: import('./campaign').Boss | null = null;
  /** 已记录的 BOSS 阶段（转阶段演出用；-1 = 尚未记录） */
  let bossPhaseSeen = -1;
  /** 状态特效节拍器 */
  let statusFxAcc = 0;

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
    onForgeUpgrade: (action) => {
      refreshGrowth();
      addDailyProgress(dailyState, 'upgrades');
      achAdd('upgrades', 1);
      if (action === 'ascend') achAdd('ascensions', 1);
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
    onOpenDaily: () => {
      ensureDaily(dailyState);
      shell.showDaily();
    },
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
      pendingLevelUps = Math.max(0, pendingLevelUps - 1);
      // 选牌反馈
      addDamagePopup(player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), `获得 · ${b.name} ×${runState.boosts[id as keyof typeof runState.boosts]}`, '#e8c377');
      if (pendingLevelUps > 0) {
        // 还有欠着的等级：继续弹下一张，不解除暂停
        showLevelUpChoices();
        return;
      }
      paused = false;
      shell.hideLevelUp();
      shell.hud.root.style.display = 'block';
      lockMouse();
    },
    onSetDifficulty: (d) => {
      difficulty = d;
    },
  });
  // 天赋/成就/每日都必须与 Shell 共享同一外层对象（各界面捕获的是构造时的引用），
  // 整体替换会让界面一直读到旧空对象，跨天重置也会与界面脱节。
  shell.talentState.talents = talentState.talents;
  const loadedAch = loadAchievements();
  shell.achievementState.counters = loadedAch.counters;
  shell.achievementState.claimed = loadedAch.claimed;
  const loadedDaily = loadDaily();
  shell.dailyState.date = loadedDaily.date;
  shell.dailyState.progress = loadedDaily.progress;
  shell.dailyState.claimed = loadedDaily.claimed;
  const dailyState = shell.dailyState;
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
    pendingLevelUps = 0;
    // 跨局战斗状态：连杀、消耗品/短期 BUFF、角色技能与冷却、场景特效
    killStreak = 0;
    killStreakTimer = 0;
    shortBuffs.fireSpd = 0;
    shortBuffs.crit = 0;
    shortBuffs.move = 0;
    buffs.atk = 0;
    buffs.shield = 0;
    buffs.speed = 0;
    shieldTimer = 0;
    shieldCooldown = 0;
    furyTimer = 0;
    stealthTimer = 0;
    roleCooldown = 0;
    meleeCooldown = 0;
    dashCooldown = 0;
    if (summonGroup) {
      world.scene.remove(summonGroup);
      summonGroup = null;
    }
    summonTimer = 0;
    if (infernoMesh) {
      world.scene.remove(infernoMesh);
      infernoMesh = null;
    }
    infernoTimer = 0;
    if (healMesh) {
      world.scene.remove(healMesh);
      healMesh = null;
    }
    healTimer = 0;
    hitStopT = 0;
    hurtInvuln = 0;
    fovKick = 0;
    recoil = 0;
    shakeT = 0;
    shakeAmp = 0;
    benchFire = false;
    player.velocity.set(0, 0, 0);
    player.onGround = true;
    refreshRun();
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
      // 释放地图自建几何/材质（共享纹理与全局材质自动跳过）
      World.disposeMap(mapRoot);
    }
    mapRoot = world.buildMap(flow.mission.mapId);
    // 可破坏箱（从地图配置重建；mesh 引用用于击碎后隐藏）
    crates.length = 0;
    const crateGroup = mapRoot.userData.crateGroup as THREE.Group | undefined;
    const crateDefs = (mapRoot.userData.crates ?? []) as { x: number; z: number; obstacle?: NavObstacle }[];
    for (let i = 0; i < crateDefs.length; i++) {
      const c = crateDefs[i];
      crates.push({
        x: c.x,
        z: c.z,
        hp: 25,
        alive: true,
        mesh: crateGroup?.children[i] as THREE.Mesh | undefined,
        obstacle: c.obstacle,
      });
    }
    mountEnv(); // 挂载开源环境素材（Kenney CC0：岩石/树木/灌木）
    player.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
    // 换图后重新烘焙导航网格；刷怪落点由导航网格给出（不再随机刷在玩家脸上/墙里）
    buildNavsForMap();
    spawner.setPlacement((kind, _index, _total, placed, opts) =>
      nav.findSpawnPoint(
        () => placementRng.next(),
        opts?.center?.x ?? player.position.x,
        opts?.center?.z ?? player.position.z,
        opts?.placeMin ?? 13,
        opts?.placeMax ?? 22,
        placed,
        kind === 'boomer' ? 2.2 : 1.5
      )
    );
    setHp(maxHp);
    flow.difficulty = difficulty;
    flow.start();
    syncBossModel();
    shell.startGame();
  }

  let mapRoot: THREE.Group | null = null;
  /** 可破坏箱（打碎掉补给） */
  interface Crate { x: number; z: number; hp: number; alive: boolean; mesh?: THREE.Mesh; obstacle?: NavObstacle }
  const crates: Crate[] = [];

  /** 当前地图碰撞体 → 小怪/BOSS 两套导航网格（木箱击碎后也必须重烘） */
  function buildNavsForMap(): void {
    const obs = (mapRoot?.userData.obstacles ?? []) as NavObstacle[];
    nav.build(obs, player.terrainHeight, { agentRadius: 0.62, stepHeight: 0.4, walkRadius: 38.5 });
    bossNav.build(obs, player.terrainHeight, { agentRadius: 1.3, stepHeight: 0.5, walkRadius: 38.5 });
  }

  /** 木箱被击碎：从地图障碍中移除并重烘导航，打开被堵住的路线 */
  function removeCrateObstacle(c: Crate): void {
    if (!c.obstacle) return;
    const obs = (mapRoot?.userData.obstacles ?? []) as NavObstacle[];
    const i = obs.indexOf(c.obstacle);
    if (i >= 0) obs.splice(i, 1);
    c.obstacle = undefined;
    buildNavsForMap();
  }

  // ---------- 开源环境素材（Kenney CC0 nature-kit） ----------
  /** 按地图类型放置的环境模型清单 */
  const ENV_MODELS: Record<string, { name: string; count: number; scale: [number, number]; y: number }[]> = {
    facility: [
      { name: 'env/env_rockSmall', count: 7, scale: [1.6, 3], y: 0 },
      { name: 'env/env_log', count: 5, scale: [1.8, 3], y: 0.25 },
      { name: 'env/env_bush', count: 9, scale: [0.35, 0.62], y: 0.02 }, // 地表草丛（小、不抢眼）
    ],
    quarry: [
      { name: 'env/env_rockA', count: 7, scale: [2.2, 4.2], y: 0 },
      { name: 'env/env_rockB', count: 6, scale: [2.2, 4.2], y: 0 },
      { name: 'env/env_rockTall', count: 4, scale: [2.2, 3.6], y: 0 },
      { name: 'env/env_log', count: 3, scale: [1.8, 3.2], y: 0.25 },
      { name: 'env/env_bush', count: 9, scale: [0.35, 0.6], y: 0.02 },
    ],
    lab: [
      { name: 'env/env_treePine', count: 6, scale: [2.0, 3.2], y: 0 },
      { name: 'env/env_treeDefault', count: 5, scale: [1.9, 2.9], y: 0 },
      { name: 'env/env_rockSmall', count: 6, scale: [1.6, 3], y: 0 },
      { name: 'env/env_bush', count: 10, scale: [0.35, 0.6], y: 0.02 },
    ],
  };
  /** 开源环境素材的地图化配色（压掉 Kenney 原色的荧光感） */
  const ENV_TINT: Record<string, number> = {
    facility: 0x5f7a45,
    quarry: 0x7a6a48,
    lab: 0x4d7a5c,
    volcano: 0x5a3a2a,
    ice: 0x6d8296,
  };
  let envRoot: THREE.Group | null = null;
  const mountEnv = (): void => {
    if (envRoot) {
      envRoot.removeFromParent();
      envRoot = null;
    }
    const list = ENV_MODELS[flow.mission.mapId] ?? [];
    if (list.length === 0) return;
    const group = new THREE.Group();
    envRoot = group;
    mapRoot?.add(group);
    const hf = (mapRoot?.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? ((): number => 0);
    for (const spec of list) {
      assets.load(spec.name, (src) => {
        // 关卡可能已切换：只在当前 envRoot 仍是本次挂载目标时落地
        if (envRoot !== group) return;
        const placements: { x: number; y: number; z: number; scale: number; rotY: number }[] = [];
        // 大件（树木/巨石）只放场地外圈，避免插进掩体与平台；小草丛可以留在场内
        const big = spec.scale[1] > 1.6;
        for (let i = 0; i < spec.count; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = big ? 15 + Math.random() * 14 : 3.5 + Math.random() * 12;
          const x = Math.cos(a) * d;
          const z = Math.sin(a) * d;
          if (nearSpawn(x, z)) continue; // 出生点附近留白，避免开局被灌木/石头糊脸
          if (big && Math.hypot(x, z) < 14) continue;
          placements.push({
            x,
            // 贴合地形高度（旧实现固定 y=0，坡地上的装饰会浮空）
            y: hf(x, z) + spec.y,
            z,
            scale: (spec.scale[0] + Math.random() * (spec.scale[1] - spec.scale[0])) * (big ? 0.8 : 1),
            rotY: Math.random() * Math.PI * 2,
          });
        }
        // 实例化：每个模型只占 1 个 draw call（旧实现每株草都是一个 Group）
        world.addInstancedProps(group, src, placements, ENV_TINT[flow.mission.mapId] ?? 0x5a6a4a);
      });
    }
  };

  /**
   * BOSS 模型挂载（开源 Soldier GLB）。
   * 小怪已改为程序化合并网格，不再需要每次重建射线目标列表——
   * 旧实现每个逻辑帧都遍历全体敌人重建数组，属于纯浪费。
   */
  function syncBossModel(): void {
    if (activeBoss && !activeBoss.root.userData.hasModel) {
      const bg = assets.get('Soldier');
      if (bg) {
        activeBoss.applyModel(bg, assets.clips('Soldier'));
        activeBoss.root.userData.hasModel = true;
      }
    }
  }

  let prevWave = -1;
  let prevPhase: string = '';
  /** 连杀计数 */
  let killStreak = 0;
  let killStreakTimer = 0;

  /** 雷达小地图（上 1/3 之外的右上角，每 2 帧画一次） */
  /** 敌人远程弹丸（真飞行物，可躲） */
  const projectiles = new ProjectilePool(world.scene, fx);
  const radar = new Radar(148, 34);
  let radarFrame = 0;

  // 设置（O 键开关；音量/灵敏度/画质/雷达 即时生效并持久化）
  const settings = loadSettings();
  sfx.setVolume(settings.volume);
  sfx.setMuted(settings.muted);
  sfx.setMusic(settings.music);
  world.setQuality(settings.quality === 'auto' ? 'medium' : settings.quality, settings.quality === 'auto');
  const settingsPanel = createSettingsPanel(settings, (s2) => {
    sfx.setVolume(s2.volume);
    sfx.setMuted(s2.muted);
    sfx.setMusic(s2.music);
    world.setQuality(s2.quality === 'auto' ? 'medium' : s2.quality, s2.quality === 'auto');
    radar.el.style.display = s2.radar ? 'block' : 'none';
  });
  radar.el.style.display = settings.radar ? 'block' : 'none';

  // 打击停顿（hit-stop）：连杀/BOSS 死亡瞬间冻结逻辑几十毫秒，渲染继续，
  // 是动作游戏"顿挫感"的标准做法（比慢动作更干脆）
  let hitStopT = 0;

  // 打击感：镜头微震 + FOV 冲击
  let shakeT = 0;
  let shakeDur = 0.001;
  let shakeAmp = 0;
  /** 镜头后坐力（当前帧上抬量） */
  let recoil = 0;
  let fovKick = 0;
  const baseFov = 60;
  const addShake = (amp: number, dur: number): void => {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, dur);
    shakeDur = Math.max(shakeDur, dur);
  };

  /** 全屏大字公告（单例元素，替换式显示，位置在上 1/3 避开准星与 BOSS 血条） */
  let announceEl: HTMLDivElement | null = null;
  let announceText: HTMLDivElement | null = null;
  let announceTimers: number[] = [];
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
    // 单例公告：新公告直接替换旧的（否则连杀/WAVE/BOSS 公告会叠成一团乱码）
    if (!announceEl || !announceText) {
      announceEl = document.createElement('div');
      announceEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:flex-start;justify-content:center;padding-top:17vh;z-index:9999;pointer-events:none;';
      announceText = document.createElement('div');
      announceEl.appendChild(announceText);
      document.body.appendChild(announceEl);
    }
    for (const t of announceTimers) clearTimeout(t);
    announceTimers = [];
    const inner = announceText;
    inner.style.color = color;
    inner.style.textShadow = `0 2px 20px ${color}88, 0 0 60px ${color}44`;
    inner.style.opacity = '0';
    inner.textContent = text;
    announceTimers.push(window.setTimeout(() => { inner.style.opacity = '1'; }, 30));
    announceTimers.push(window.setTimeout(() => { inner.style.opacity = '0'; }, Math.max(300, durationMs - 400)));
  }
  flow.onPhaseChange = (phase, _mission) => {
    if (activeBoss) world.scene.remove(activeBoss.root);
    activeBoss = flow.activeBoss;
    bossPhaseSeen = -1;
    // BOSS 出生点：用更大的体宽导航落点，避免从中央高台里面/墙体里钻出来
    if (phase === 'boss' && activeBoss) {
      bossNav.updateTarget(player.position.x, player.position.z);
      let spot: { x: number; z: number; y: number } | null = null;
      for (let i = 0; i < 12; i++) {
        const p = bossNav.findSpawnPoint(() => placementRng.next(), player.position.x, player.position.z, 9, 16, [], 2.5);
        if (!p) continue;
        if (bossNav.reachable(p.x, p.z)) {
          spot = p;
          break;
        }
        if (!spot) spot = p;
      }
      if (spot) activeBoss.root.position.set(spot.x, spot.y, spot.z);
    }
    projectiles.clear();
    // 背景音乐按地图换情绪（火山低沉 / 冰原清冷）
    const MOODS: Record<string, [number, number[]]> = {
      facility: [55, [0, 3, 5, 7, 10]],
      quarry: [49, [0, 3, 5, 7, 10]],
      lab: [65.41, [0, 3, 5, 7, 10]],
      volcano: [43.65, [0, 1, 5, 7, 8]],
      ice: [82.41, [0, 2, 4, 7, 9]],
    };
    const mood = MOODS[flow.mission.mapId];
    if (mood) sfx.setMood(mood[0], mood[1]);
    if (activeBoss) world.scene.add(activeBoss.root);
    syncBossModel();

    // ---- 波次预告 ----
    if (phase === 'wave' && flow.waveIndex > prevWave) {
      prevWave = flow.waveIndex;
      spawnChest(false);
      const totalWaves = _mission.waves.length;
      showAnnouncement(
        _mission.tower ? `第 ${flow.waveIndex + 1} 层` : `WAVE ${flow.waveIndex + 1} / ${totalWaves}`,
        '#ffffff',
        1800
      );
      sfx.wave();
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
      const boss = activeBoss;
      showAnnouncement('', '#000000', 600);
      setTimeout(() => {
        // 600ms 内可能已被击杀/进入下一阶段，定时器不能再访问已置空的 activeBoss
        if (activeBoss !== boss || !boss.alive) return;
        showAnnouncement(boss.spec.name, '#' + boss.spec.color.toString(16).padStart(6, '0'), 3000);
        sfx.roar();
        shell.hud.boss(boss.spec.name, (boss.hp / boss.maxHp) * 100);
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
      const diffR = difficulty >= 2 ? 3 : difficulty >= 1.5 ? 1.8 : difficulty <= 0.8 ? 0.8 : 1;
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
    const diffReward = (difficulty >= 2 ? 3 : difficulty >= 1.5 ? 1.8 : difficulty <= 0.8 ? 0.8 : 1) * (1 + runB.luckyGold);
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
      // 金币掉落（天赋"搜刮"加成；基数随关卡怪物等级成长，与材料奖励同步）
      const missionLv = result.mission.monsterLevel ?? 1;
      const goldReward = Math.round((30 + missionLv * 5) * (1 + bonuses.gold) * diffReward);
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

  /** 射线-球体求交，返回最近正距离或 null（零分配：命中点写入 hitScratch） */
  function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
    const ox = origin.x - center.x;
    const oy = origin.y - center.y;
    const oz = origin.z - center.z;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : null;
  }

  /** 每帧复用的临时向量（避免热路径 new Vector3） */
  const eyeScratch = new THREE.Vector3();
  const hitScratch = new THREE.Vector3();
  const centerScratch = new THREE.Vector3();
  const clipDir = new THREE.Vector3();

  /**
   * 射线与 AABB 的最近命中距离（slab 法，障碍从地面延伸到 top）。
   * 返回 null 表示不相交；t=0 表示起点已在盒内。
   */
  function rayAabbT(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    maxT: number
  ): number | null {
    let tmin = 0;
    let tmax = maxT;
    if (Math.abs(dir.x) < 1e-8) {
      if (origin.x < minX || origin.x > maxX) return null;
    } else {
      let t1 = (minX - origin.x) / dir.x;
      let t2 = (maxX - origin.x) / dir.x;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (Math.abs(dir.y) < 1e-8) {
      if (origin.y < minY || origin.y > maxY) return null;
    } else {
      let t1 = (minY - origin.y) / dir.y;
      let t2 = (maxY - origin.y) / dir.y;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (Math.abs(dir.z) < 1e-8) {
      if (origin.z < minZ || origin.z > maxZ) return null;
    } else {
      let t1 = (minZ - origin.z) / dir.z;
      let t2 = (maxZ - origin.z) / dir.z;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  /** 命中点是否落在障碍物表面（打在墙上时不能再按邻近伤害到墙后的敌人） */
  const pointOnObstacleSurface = (pos: THREE.Vector3): boolean => {
    const eps = 0.08;
    for (const o of nav.obstacles) {
      // 木箱本身是射击目标，不当作“墙命中”吞掉伤害
      if (o.crate) continue;
      if (pos.y > o.top + eps) continue;
      const ax = Math.abs(pos.x - o.x);
      const az = Math.abs(pos.z - o.z);
      if (ax > o.hw + eps || az > o.hd + eps) continue;
      if (Math.abs(ax - o.hw) <= eps || Math.abs(az - o.hd) <= eps || Math.abs(pos.y - o.top) <= eps) return true;
    }
    return false;
  };

  /** 弹道被掩体遮挡时截断（精确射线-AABB，不再用 10 步采样漏掉薄墙） */
  const clipToObstacles = (from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 => {
    clipDir.subVectors(to, from);
    const len = clipDir.length();
    if (len < 1e-6) return to;
    clipDir.multiplyScalar(1 / len);
    let best = len;
    for (const o of nav.obstacles) {
      const t = rayAabbT(from, clipDir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, len);
      if (t !== null && t < best) best = t;
    }
    const terrainT = nav.terrainRayDistance(from.x, from.y, from.z, to.x, to.y, to.z);
    if (terrainT !== null && terrainT < best) best = terrainT;
    return best < len ? from.clone().addScaledVector(clipDir, best) : to;
  };

  /**
   * 小怪水平碰撞：圆 vs 障碍 AABB。两次迭代，避免被相邻两个箱体夹住。
   * 站在障碍顶面（平台）时跳过，否则会被从平台上推下去。
   */
  const resolveEnemyObstacles = (pos: THREE.Vector3, radius: number): void => {
    const groundHere = player.terrainHeight(pos.x, pos.z);
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const o of nav.obstacles) {
        // 站在顶面，或贴着斜坡走到顶面收口：不算撞墙。
        // 注意必须同时看脚下高度：被挤进平台底部（y=0、地面=1.2）时不能放行。
        if (pos.y >= o.top - 0.2) continue;
        if (groundHere >= o.top - 0.55 && pos.y >= o.top - 0.55) continue;
        const dx = pos.x - o.x;
        const dz = pos.z - o.z;
        const closestX = clamp(dx, -o.hw, o.hw);
        const closestZ = clamp(dz, -o.hd, o.hd);
        const nx = dx - closestX;
        const nz = dz - closestZ;
        const d = Math.hypot(nx, nz);
        if (d >= radius) continue;
        if (d > 1e-5) {
          const push = radius - d;
          pos.x += (nx / d) * push;
          pos.z += (nz / d) * push;
        } else {
          // 圆心在 AABB 内部：沿最小穿透轴推出
          const ox = o.hw + radius - Math.abs(dx);
          const oz = o.hd + radius - Math.abs(dz);
          if (ox < oz) pos.x = o.x + (dx >= 0 ? 1 : -1) * (o.hw + radius);
          else pos.z = o.z + (dz >= 0 ? 1 : -1) * (o.hd + radius);
        }
        moved = true;
      }
      if (!moved) break;
    }
  };

  /** 限制在竞技场圆内（玩家 38；敌人略大一点给远程留空间） */
  const clampArena = (pos: THREE.Vector3): void => {
    const r = Math.hypot(pos.x, pos.z);
    const maxR = 38.5;
    if (r > maxR) {
      const k = maxR / r;
      pos.x *= k;
      pos.z *= k;
    }
  };

  // 音频上下文要在用户手势后创建/恢复（浏览器自动播放策略）
  const unlockAudio = (): void => sfx.resume();
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  /** 上一次 resolveHit 是否停在地形上（用于禁止对山后敌人的邻近结算） */
  let hitTerrainSurface = false;

  /** 当前武器机制对应的伤害元素（烈焰/霜锋/雷暴/过载），其余按物理结算 */
  const currentElement = (): Element => {
    const kind = arsenal.current.def.mech.kind;
    if (kind === 'beam') return 'fire';
    if (kind === 'slow') return 'ice';
    if (kind === 'chain' || kind === 'energy' || kind === 'lockon') return 'energy';
    return 'physical';
  };

  const fireCtx: FireContext = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    tracer,
    onShot: (): void => {
      sfx.shot(arsenal.current.def.archetype);
      fovKick = Math.min(fovKick + 0.9, 3.5);
      // 镜头后坐力：按枪型给不同的上抬，指数回落
      const kick: Record<string, number> = { rifle: 0.011, pistol: 0.008, smg: 0.006, shotgun: 0.028, sniper: 0.04 };
      recoil = Math.min(recoil + (kick[arsenal.current.def.archetype] ?? 0.012), 0.07);
    },
    resolveHit(origin, dir) {
      // 逻辑命中：射线对敌人/BOSS 球体检测（不依赖模型 mesh raycast，稳定可靠）
      hitTerrainSurface = false;
      let bestT = 60;
      let hit = false;
      // 先算最近的掩体交点：玩家射击是 hitscan，必须和敌人弹丸一样被墙截断
      let wallT = Infinity;
      for (const o of nav.obstacles) {
        const t = rayAabbT(origin, dir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, 60);
        if (t !== null && t > 0.02 && t < wallT) wallT = t;
      }
      // 山坡/丘陵同样截断 hitscan（否则可以隔山点杀）
      const terrainT = nav.terrainRayDistance(
        origin.x,
        origin.y,
        origin.z,
        origin.x + dir.x * 60,
        origin.y + dir.y * 60,
        origin.z + dir.z * 60
      );
      if (terrainT !== null && terrainT < wallT) wallT = terrainT;
      // 可破坏箱优先（若命中箱子，先打箱子）
      for (const c of crates) {
        if (!c.alive) continue;
        hitScratch.set(c.x, 0.7, c.z);
        const t = raySphere(origin, dir, hitScratch, 1.0);
        if (t !== null && t < bestT && t < wallT) {
          bestT = t;
          hit = true;
        }
      }
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        // 命中半径放宽到 1.1（容忍地形高度差，玩家平视可打高处敌人）
        e.centerInto(centerScratch);
        const t = raySphere(origin, dir, centerScratch, 1.1);
        if (t !== null && t < bestT && t < wallT) {
          bestT = t;
          hit = true;
        }
      }
      if (activeBoss && activeBoss.alive) {
        activeBoss.centerInto(centerScratch);
        const t = raySphere(origin, dir, centerScratch, 3.2);
        if (t !== null && t < bestT && t < wallT) {
          bestT = t;
          hit = true;
        }
      }
      if (hit) return hitScratch.copy(origin).addScaledVector(dir, bestT);
      if (wallT < 60) {
        hitTerrainSurface = terrainT !== null && terrainT <= wallT;
        return hitScratch.copy(origin).addScaledVector(dir, wallT);
      }
      if (dir.y < -1e-4) {
        const t = -origin.y / dir.y;
        if (t > 0) {
          hitTerrainSurface = true;
          return hitScratch.copy(origin).addScaledVector(dir, t);
        }
      }
      return hitScratch.copy(origin).addScaledVector(dir, 60);
    },
    onHitEnemy(pos, damage, extra) {
      // 升级选牌已暂停：同一发/后续弹丸不再继续结算
      if (paused) return false;
      // 射线停在掩体/地形表面：这一发不算命中任何单位（哪怕敌人贴在墙后/山后）
      if (pointOnObstacleSurface(pos)) return false;
      if (hitTerrainSurface) return false;
      const elem = currentElement();
      let hitSomething = false;
      // 可破坏箱：优先扣箱子血（打碎掉补给）
      for (const c of crates) {
        if (!c.alive) continue;
        const cdx = c.x - pos.x;
        const cdz = c.z - pos.z;
        const cdy = 0.7 - pos.y;
        if (cdx * cdx + cdy * cdy + cdz * cdz < 1.6) {
          c.hp -= damage;
          if (c.hp <= 0) {
            c.alive = false;
            // 视觉与碰撞同步：藏掉箱子并移除障碍/导航阻挡
            if (c.mesh) c.mesh.visible = false;
            removeCrateObstacle(c);
            spawnBuffOrb(new THREE.Vector3(c.x, 0.8, c.z));
            maybeDropOrb(new THREE.Vector3(c.x, 0.8, c.z));
            addDamagePopup(new THREE.Vector3(c.x, 1.2, c.z), '箱子击碎', '#ffd24a');
          }
          return true;
        }
      }
      /** 本次命中的跳字聚合键（BOSS / 兵种敌人各自一行不断累加） */
      let popupKey = '';
      // 等级压制：玩家等级 vs 怪物等级（升级后打同级怪一定更轻松）
      const supDealt = suppressionDealt(runState.level - flow.monsterLevel);
      // 连杀增伤 + 隐身增伤 + 攻击倍率 + 局内成长 + 暴击（含词缀/暴击球）
      const st = computeStats();
      const curG = inventory.getWeapon(arsenal.current.def.id);
      const critBonus = affixCritMult(curG) + (shortBuffs.crit > 0 ? 0.2 : 0) + runB.critBonus;
      const streakMult = 1 + Math.min(killStreak, 6) * 0.05;
      const isCrit = Math.random() < st.critRate + critBonus;
      const critMult = (isCrit ? st.critMult : 1) + (isCrit ? runB.critDmgBonus : 0);
      let dmg = damage * supDealt * streakMult * (stealthTimer > 0 ? 2 * (1 + inventory.roleLevel(selectedRoleId) * 0.15) : 1) * st.attackMult * critMult * runB.dmgMult;
      if (!Number.isFinite(dmg) || dmg <= 0) dmg = damage; // NaN 防护
      // 高地优势：玩家比命中点低 0.4m 以上 → +20% 伤害（旧实现每次命中扫全部敌人找高度）
      if (player.position.y > pos.y - 0.6) dmg *= 1.2;
      if (activeBoss && activeBoss.alive) {
        activeBoss.centerInto(centerScratch);
        const bdx = centerScratch.x - pos.x;
        const bdy = centerScratch.y - pos.y;
        const bdz = centerScratch.z - pos.z;
        // 命中球体半径 3.2，判定半径需匹配（distance² < 12）
        if (bdx * bdx + bdy * bdy + bdz * bdz < 12) {
          popupKey = 'boss';
          const dead = activeBoss.takeDamage(dmg, elem);
          if (dead) onBossKilled(activeBoss);
          hitSomething = true;
        }
      }
      if (!hitSomething) {
        let bestE: Enemy | null = null;
        let bestD = 3.0;
        for (const e of spawner.all()) {
          if (!e.alive) continue;
          e.centerInto(centerScratch);
          const dx = centerScratch.x - pos.x;
          const dy = centerScratch.y - pos.y;
          const dz = centerScratch.z - pos.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d <= bestD) {
            bestD = d;
            bestE = e;
          }
        }
        if (bestE) {
          const e = bestE;
          popupKey = `en${e.id}`;
          // 击退：沿弹道方向推（重武器更强 / 暴击加成；盾兵与厚甲精英抗性高）
          const kdx = e.root.position.x - player.position.x;
          const kdz = e.root.position.z - player.position.z;
          const kl = Math.hypot(kdx, kdz) || 1;
          const heavy = arsenal.current.def.archetype === 'shotgun' || arsenal.current.def.archetype === 'sniper';
          let imp = (heavy ? 2.8 : 1.5) * (isCrit ? 1.6 : 1);
          if (e.def.kind === 'guard') imp *= 0.35;
          if (e.elite?.kind === 'armored') imp *= 0.5;
          e.applyKnockback(kdx / kl, kdz / kl, imp);
          // 晕眩：狙击枪 35% 概率短晕
          if (arsenal.current.def.archetype === 'sniper' && Math.random() < 0.35) e.applyStun(0.6);
          if (extra.slow !== undefined) e.applySlow(extra.slow, 1.6);
          // 烈焰风暴：命中施加灼�?DOT
          if (arsenal.current.def.mech.kind === 'beam') e.applyBurn(2.2, 5);
          // 精英猎手：对精英额外伤害；狂暴：伤害 ×1.5
          const furyMult = furyTimer > 0 ? 1.5 : 1;
          const finalDmg = (e.elite ? dmg * runB.eliteDmg : dmg) * furyMult;
          // 寒霜弹：命中减速
          if (runB.frost > 0) e.applySlow(1 - runB.frost, 1.5);
          const dead = e.takeDamage(finalDmg, elem);
          if (dead) {
            registerEnemyKill(e);
            fovKick = Math.max(fovKick, 2.2);
            // 武器熟练度
            const curG = inventory.getWeapon(arsenal.current.def.id);
            curG.kills += 1;
          }
          hitSomething = true;
        }
      }
      if (hitSomething) {
        shell.hud.hitConfirm();
        sfx.hit();
        const st = computeStats();
        const isCrit = Math.random() < st.critRate + affixCritMult(inventory.getWeapon(arsenal.current.def.id));
        addDamagePopup(pos, `-${Math.round(dmg)}`, isCrit ? '#ffd24a' : '#ffb0a0', isCrit ? 27 : 20, popupKey);
        // 命中火花（小而淡，避免遮挡视野）
        spawnParticles(pos, isCrit ? 0xffd24a : 0xffaa66, isCrit ? 3 : 2, 2);
        // 吸血：词缀吸血 + 局内嗜血
        const vamp = affixVampMult(inventory.getWeapon(arsenal.current.def.id)) + runB.vamp;
        if (vamp > 0) setHp(hp + dmg * vamp);
        // 分裂弹：命中附近敌人溅射（伤害 × 分裂系数；升级暂停后不再继续结算）
        if (!paused && runB.split > 0) {
          const splitDmg = dmg * runB.split;
          for (const se of spawner.all()) {
            if (!se.alive) continue;
            se.centerInto(centerScratch);
            const sdx = centerScratch.x - pos.x;
            const sdy = centerScratch.y - pos.y;
            const sdz = centerScratch.z - pos.z;
            if (sdx * sdx + sdy * sdy + sdz * sdz > 9) continue;
            if (!nav.hasLineOfSight3D(pos.x, pos.y, pos.z, centerScratch.x, centerScratch.y, centerScratch.z)) continue;
            const sdead = se.takeDamage(splitDmg, elem);
            if (sdead && registerEnemyKill(se)) break;
          }
        }
      }
      return hitSomething;
    },
    findTarget(origin, maxRange) {
      let best: { e: Enemy; d: number } | null = null;
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const c = e.center();
        const d = c.distanceToSquared(origin);
        if (d > maxRange * maxRange) continue;
        if (!nav.hasLineOfSight3D(origin.x, origin.y, origin.z, c.x, c.y, c.z)) continue;
        if (best === null || d < best.d) best = { e, d };
      }
      return best ? best.e.center() : null;
    },
    resolvePierce(origin, dir, max) {
      // 穿透也要被墙截断：先求墙距，挡在墙后的目标不进列表
      let wallT = Infinity;
      for (const o of nav.obstacles) {
        const t = rayAabbT(origin, dir, o.x - o.hw, o.x + o.hw, -1000, o.top, o.z - o.hd, o.z + o.hd, 60);
        if (t !== null && t > 0.02 && t < wallT) wallT = t;
      }
      const terrainT = nav.terrainRayDistance(
        origin.x,
        origin.y,
        origin.z,
        origin.x + dir.x * 60,
        origin.y + dir.y * 60,
        origin.z + dir.z * 60
      );
      if (terrainT !== null && terrainT < wallT) wallT = terrainT;
      // 沿方向收集射线附近敌人（按距离排序）
      const hits: { e: Enemy; t: number }[] = [];
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const c = e.center();
        const t = raySphere(origin, dir, c, 0.9);
        if (t !== null && t < wallT) hits.push({ e, t });
      }
      hits.sort((a, b) => a.t - b.t);
      return hits.slice(0, max).map((h) => h.e.center());
    },
    onChain(pos, damage, jumps, falloff) {
      // 升级暂停后不再继续弹跳结算
      if (paused) return;
      // 连锁闪电：从命中点向附近敌人弹跳，伤害逐跳衰减；每跳都要求视线
      let fromPos = pos;
      let dmg = damage;
      const alive = (): Enemy[] => spawner.all().filter((e) => e.alive);
      for (let j = 0; j < jumps; j++) {
        let best: { e: Enemy; d: number } | null = null;
        for (const e of alive()) {
          const c = e.center();
          const d = c.distanceToSquared(fromPos);
          if (d < 1e-4) continue;
          if (d >= 100) continue;
          if (!nav.hasLineOfSight3D(fromPos.x, fromPos.y, fromPos.z, c.x, c.y, c.z)) continue;
          if (best === null || d < best.d) best = { e, d };
        }
        if (!best) break;
        dmg *= falloff;
        const to = best.e.center();
        tracer.fire(fromPos, to, 0x7ab0ff, 1.8);
        const dead = best.e.takeDamage(dmg, 'energy');
        if (dead && registerEnemyKill(best.e)) break;
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
    settings: false,
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

  // ---------- 性能采样（调试钩子 __ss.perf 使用） ----------
  /** 自动开火压力测试开关（仅调试钩子置位，正常运行恒为 false） */
  let benchFire = false;
  let perfFrames = 0;
  let perfAccum = 0;
  let perfLast = 0;
  let perfFps = 0;
  let perfFrameMs = 0;
  const perfSample = (): void => {
    const now = performance.now();
    if (perfLast > 0) {
      perfAccum += now - perfLast;
      perfFrames += 1;
      if (perfAccum >= 500) {
        perfFrameMs = perfAccum / perfFrames;
        perfFps = perfFrames > 0 ? 1000 / perfFrameMs : 0;
        perfAccum = 0;
        perfFrames = 0;
      }
    }
    perfLast = now;
  };

  // ---------- 玩家属性（六维 + BUFF�?----------
  const buffs = { atk: 0, shield: 0, speed: 0 };
  /** 局内成长（升级选牌） */
  let runState = newRun();
  let runB = runBonuses(runState);
  /** 待选的升级次数（一次经验结算可能跨多级，必须逐级给牌） */
  let pendingLevelUps = 0;
  const refreshRun = (): void => {
    runB = runBonuses(runState);
    refreshGrowth();
    applySpeedMult();
    applyMaxHpGrowth();
  };

  /** 展示当前待选的升级牌；每一级都会单独给一次选择 */
  function showLevelUpChoices(): void {
    if (pendingLevelUps <= 0) return;
    sfx.levelUp();
    paused = true;
    unlockMouse();
    shell.hidePause();
    const showLevel = runState.level - pendingLevelUps + 1;
    shell.showLevelUp(showLevel, rollChoices(runState).map((b) => ({ id: b.id, name: b.name, desc: b.desc })));
  }

  /** 记录跨级产生的待选次数；若当前没弹牌则立即弹第一张 */
  function queueLevelUps(gained: number): void {
    if (gained <= 0) return;
    pendingLevelUps += gained;
    if (!paused) showLevelUpChoices();
  }

  /** 小怪击杀经验：所有玩家来源统一结算，返回是否触发升级 */
  function awardKillExp(e: Enemy): boolean {
    const before = runState.level;
    const leveled = addKillExp(runState, !!e.elite, e.level, 1 + bonuses.expBonus);
    if (leveled) queueLevelUps(runState.level - before);
    return leveled;
  }

  /** BOSS 死亡统一结算：经验/掉落/爆点；普通副本由结算界面接管升级牌 */
  function onBossKilled(boss: import('./campaign').Boss): void {
    flow.kills += 1;
    syncBossModel();
    // BOSS 必掉 2 个 BUFF 球
    spawnBuffOrb(boss.root.position.clone());
    spawnBuffOrb(boss.root.position.clone().add(new THREE.Vector3(1.5, 0, 0)));
    // BOSS 经验按怪物等级结算（天赋战意加成）
    const before = runState.level;
    const leveled = addKillExp(runState, true, boss.monsterLevel, 1 + bonuses.expBonus);
    const gained = runState.level - before;
    // 死亡爆点：双环 + 大量火花（一次性事件，允许临时分配）
    const bp = boss.root.position;
    fx.burst(bp, 0xff8844, 5);
    fx.burst(bp, 0xffd24a, 2.6);
    fx.emit(new THREE.Vector3(bp.x, bp.y + 1.6, bp.z), 0xff7a33, 26, 7.5, 2.2);
    addKillBurst(bp);
    addShake(0.3, 0.6);
    hitStopT = 0.14; // BOSS 死亡长顿
    // 普通副本紧接着通关结算；塔模式要逐级展示升级选牌
    if (leveled && flow.mission.tower) queueLevelUps(gained);
  }

  /**
   * 小怪击杀统一结算（所有玩家来源）：
   * 击杀数/经验/连杀/掉落/爆点，返回是否触发升级。
   */
  function registerEnemyKill(e: Enemy): boolean {
    flow.kills += 1;
    syncBossModel();
    sfx.kill();
    const leveled = awardKillExp(e);
    maybeDropOrb(e.root.position);
    addKillBurst(e.root.position);
    spawnParticles(e.root.position, 0xffd24a, 4, 3.5);
    killStreak += 1;
    killStreakTimer = 2.5;
    if (killStreak >= 3) hitStopT = 0.07; // 连杀瞬间顿一拍
    if (killStreak >= 3) {
      const streakNames: Record<number, string> = {
        3: '🔥 三连杀!', 5: '⚡ 五连杀!', 8: '💀 八连杀!',
        10: '🌟 十连杀!!', 15: '👑 十五连杀!!!', 20: '🏆 无敌!!!',
      };
      const msg = streakNames[killStreak] || `🔥 ${killStreak}连杀!`;
      const color = killStreak >= 10 ? '#ffd700' : killStreak >= 5 ? '#ff6644' : '#ff9944';
      showAnnouncement(msg, color, 1200);
      sfx.streak(killStreak);
      if (killStreak >= 5) setHp(hp + 5);
      if (killStreak >= 10) setHp(hp + 10);
    }
    return leveled;
  }
  const computeStats = (): ReturnType<typeof applyBuffs> => {
    if (statsCache) return statsCache;
    const base = baseStats(bonuses, growthSummary());
    statsCache = applyBuffs(base, buffs);
    return statsCache;
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
    // 等级压制：怪物等级高于玩家时伤害放大
    v *= suppressionTaken(runState.level - flow.monsterLevel);
    sfx.hurt();
    addShake(0.14, 0.32);
    if (hurtInvuln > 0) return; // 无敌帧：防多敌人同帧秒杀
    if (!Number.isFinite(v) || v <= 0) return; // NaN 防护
    hurtInvuln = 0.4;
    // 受击红色碎片
    spawnParticles(player.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff4444, 2, 2.2);
    const st = computeStats();
    const furyResist = furyTimer > 0 ? 0.3 : 0;
    // 总减伤（天赋韧性 + 局内铁壁 + 狂暴抗性）夹取到 85%，避免叠穿
    const mitig = Math.min(0.85, st.armor + runB.armorBonus + furyResist);
    const afterArmor = v * (1 - mitig) * (shieldTimer > 0 ? 0.3 : 1);
    setHp(hp - Math.max(0, afterArmor));
    if (runB.thorns > 0) {
      // 荆棘：反弹给最近的可见敌人（不能反弹给墙后的怪）
      let best: { e: Enemy; d: number } | null = null;
      const pe = player.eye();
      for (const e of spawner.all()) {
        if (!e.alive) continue;
        const c = e.center();
        if (!nav.hasLineOfSight3D(pe.x, pe.y, pe.z, c.x, c.y, c.z)) continue;
        const d = c.distanceToSquared(player.position);
        if (best === null || d < best.d) best = { e, d };
      }
      if (best) {
        const dead = best.e.takeDamage(runB.thorns);
        if (dead) registerEnemyKill(best.e);
      }
    }
  };

  // ---------- 特效封装（统一交给 fx：零分配 / 单 draw call / 单 canvas 跳字） ----------
  const spawnParticles = (pos: THREE.Vector3, color: number, count: number, speed: number): void => {
    fx.emit(pos, color, count, speed);
  };
  /** 击杀冲击环（贴地扩散） */
  const addKillBurst = (pos: THREE.Vector3): void => {
    fx.burst(pos, 0xffd24a, 2.0);
  };
  const addDamagePopup = (worldPos: THREE.Vector3, text: string, color: string, size = 17, key = ''): void => {
    fx.popup(worldPos, text, color, size, key);
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
    // 逻辑判定不依赖 world matrix（旧实现在这里强制整场景 updateMatrixWorld，开销极大）

    let hitSomething = false;
    // 敌人
    for (const e of spawner.all()) {
      if (!e.alive) continue;
      const c = e.center();
      const to = c.clone().sub(origin);
      const dist = to.length();
      if (dist > 2.6) continue;
      const dot = to.dot(dir) / dist;
      if (dot < 0.5) continue; // 前方 ±60° 扇形
      if (!nav.hasLineOfSight3D(origin.x, origin.y, origin.z, c.x, c.y, c.z)) continue;
      const dead = e.takeDamage(meleeDamage);
      hitSomething = true;
      if (dead && registerEnemyKill(e)) break;
    }
    // BOSS（小怪击杀触发升级暂停后不再继续结算 BOSS）
    if (!paused && activeBoss && activeBoss.alive) {
      const c = activeBoss.center();
      const to = c.clone().sub(origin);
      const dist = to.length();
      if (dist <= 3.4 && nav.hasLineOfSight3D(origin.x, origin.y, origin.z, c.x, c.y, c.z)) {
        const dead = activeBoss.takeDamage(meleeDamage);
        if (dead) onBossKilled(activeBoss);
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
      // hit-stop：冻结逻辑（渲染继续，画面整体停住），比慢动作更有顿挫
      if (hitStopT > 0) {
        hitStopT -= dt;
        return;
      }
      const snap = input.snapshot();

      // 暂停态（死亡/通关/主动暂停/设置面板）：冻结玩家与战斗逻辑
      // （直接读面板可见性，关面板的两种方式都能正确恢复）
      if (paused || settingsPanel.visible()) {
        // 局内商店/设置面板打开时主循环在上面就返回了，关闭键必须在这里处理
        if (shopOpen && snap.key('Tab') && !keyState.shopTab) {
          shopOpen = false;
          paused = false;
          shell.hideCombatShop();
          shell.hud.root.style.display = 'block';
          lockMouse();
          keyState.shopTab = true;
          return;
        }
        keyState.shopTab = snap.key('Tab');
        if (settingsPanel.visible() && snap.key('KeyO') && !keyState.settings) {
          settingsPanel.toggle();
          keyState.settings = true;
          return;
        }
        keyState.settings = snap.key('KeyO');
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
      player.look(d.dx, d.dy, 0.12 * settings.sens);
      viewmodel?.applyLook(d.dx, d.dy);
      player.update(snap, dt);

      const eye = player.eyeInto(eyeScratch);
      world.camera.position.copy(eye);
      world.camera.rotation.order = 'YXZ';
      world.camera.rotation.y = player.yaw;
      world.camera.rotation.x = player.pitch;
      // 阴影框跟随玩家（26m 内保持高精度阴影，远处自然淡出）
      world.focusShadow(player.position.x, player.position.y, player.position.z);
      // 打击感：镜头微震（受击/爆炸触发，线性衰减）
      if (shakeT > 0) {
        shakeT -= dt;
        const a = shakeAmp * Math.max(0, shakeT / shakeDur);
        world.camera.position.x += (Math.random() - 0.5) * a;
        world.camera.position.y += (Math.random() - 0.5) * a * 0.6;
        world.camera.rotation.z += (Math.random() - 0.5) * a * 0.03;
        if (shakeT <= 0) shakeAmp = 0;
      }
      // FOV 冲击：开火/击杀时轻微推近再回落
      fovKick *= Math.exp(-dt * 7);
      const fovNow = baseFov + fovKick;
      if (Math.abs(world.camera.fov - fovNow) > 0.01) {
        world.camera.fov = fovNow;
        world.camera.updateProjectionMatrix();
      }
      // 镜头后坐力：上抬后回落（不写入 player.pitch，松开即回准）
      recoil *= Math.exp(-dt * 9);
      world.camera.rotation.x = player.pitch + recoil;
      // 雷达小地图（每 2 帧画一次）
      radarFrame += 1;
      if (radarFrame % 2 === 0) {
        radar.begin(player.position.x, player.position.z, player.yaw);
        for (const e of spawner.all()) {
          if (!e.alive) continue;
          radar.dot(e.root.position.x, e.root.position.z, '#' + e.def.color.toString(16).padStart(6, '0'), 3);
        }
        if (activeBoss && activeBoss.alive) {
          radar.dot(activeBoss.root.position.x, activeBoss.root.position.z, '#ff4400', 5);
        }
        for (const c of crates) if (c.alive) radar.dot(c.x, c.z, '#d9a44a', 2);
        const pools = (mapRoot?.userData.poisonPools ?? []) as { x: number; z: number }[];
        for (const pool of pools) radar.dot(pool.x, pool.z, 'rgba(62,160,85,0.85)', 4);
        radar.end();
      }

      fireCtx.origin.copy(eye);
      fireCtx.direction.set(0, 0, -1).applyQuaternion(world.camera.quaternion).normalize();

      arsenal.current.update(dt, fireCtx);
      if (benchFire && !snap.fire) arsenal.current.fire(fireCtx);

      if (snap.fire) {
        arsenal.current.fire(fireCtx);
        viewmodel?.kickNow(0.6);
      } else {
        arsenal.current.releaseFire(fireCtx);
      }
      // O = 设置面板
      if (snap.key('KeyO') && !keyState.settings) {
        settingsPanel.toggle();
        keyState.settings = true;
      } else if (!snap.key('KeyO')) {
        keyState.settings = false;
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
          arsenal.current.reload(); // 战斗中 R = 换弹
          viewmodel?.reload();
          sfx.reload();
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
            const c = e.center();
            if (!nav.hasLineOfSight3D(infernoMesh.position.x, infernoMesh.position.y + 0.5, infernoMesh.position.z, c.x, c.y, c.z)) continue;
            const dead = e.takeDamage(infernoDmg * dt * 10, 'fire');
            e.applySlow(0.5, 0.5);
            if (dead && registerEnemyKill(e)) break;
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
          const from = summonGroup.position.clone().add(new THREE.Vector3(0, 0.8, 0));
          let best: { e: Enemy; d: number } | null = null;
          for (const e of spawner.all()) {
            if (!e.alive) continue;
            const c = e.center();
            const d = c.distanceToSquared(from);
            if (d >= 196) continue;
            if (!nav.hasLineOfSight3D(from.x, from.y, from.z, c.x, c.y, c.z)) continue;
            if (best === null || d < best.d) best = { e, d };
          }
          if (best) {
            tracer.fire(from, best.e.center(), 0x66e0ff, 1.4);
            const dead = best.e.takeDamage(summonDmg);
            if (dead) registerEnemyKill(best.e);
          }
        }
        if (summonTimer <= 0) {
          world.scene.remove(summonGroup);
          summonGroup = null;
        }
      }

      // F 冲刺：向面朝方向突进。
      // 旧实现直接 position += 6m，会穿墙/穿平台；改为 0.25m 步进的碰撞与台阶检查。
      if (snap.key('KeyF') && !keyState.dash && dashCooldown <= 0) {
        dashCooldown = 4;
        const dx = -Math.sin(player.yaw);
        const dz = -Math.cos(player.yaw);
        const steps = 24;
        const step = 6 / steps;
        const probe = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < steps; i++) {
          const nx = player.position.x + dx * step;
          const nz = player.position.z + dz * step;
          // 与 PlayerController 的活动半径一致（旧的 ±13 方形是遗留的中央竞技场限制）
          if (Math.hypot(nx, nz) > 38) break;
          const ng = terrainHeightAt(nx, nz);
          if (ng - player.position.y > 0.55) break; // 高台阶：冲刺不能上
          probe.x = nx;
          probe.y = player.position.y;
          probe.z = nz;
          player.collide(probe);
          const movedX = probe.x - player.position.x;
          const movedZ = probe.z - player.position.z;
          if (movedX * dx + movedZ * dz < step * 0.25) break; // 撞墙
          player.position.x = probe.x;
          player.position.z = probe.z;
          const gHere = terrainHeightAt(player.position.x, player.position.z);
          if (gHere > player.position.y && gHere - player.position.y <= 0.55) player.position.y = gHere;
        }
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
      // 属性缓存每逻辑帧失效一次（BUFF 随时间衰减；帧内多次查询共用一次汇总）
      statsCache = null;
      tickBuffs(buffs, dt);
      applySpeedMult();
      const regen = computeStats().energyRegen + runB.energyRegen;
      arsenal.current.state.energy = clamp(arsenal.current.state.energy + regen * dt, 0, arsenal.current.def.energyMax);
      if (runB.regenPerSec > 0 && hp < maxHp) setHp(hp + runB.regenPerSec * dt);

      if (snap.key('KeyT') && !keyState.upgrade) {
        const r = tryUpgrade(arsenal.current.def, inventory);
        if (r) {
          achAdd('upgrades', 1);
          addDailyProgress(dailyState, 'upgrades');
        }
        refreshGrowth();
      }
      keyState.upgrade = snap.key('KeyT');
      if (snap.key('KeyY') && !keyState.ascend) {
        const r = tryAscend(arsenal.current.def, inventory);
        if (r) {
          achAdd('ascensions', 1);
          addDailyProgress(dailyState, 'upgrades');
        }
        refreshGrowth();
      }
      keyState.ascend = snap.key('KeyY');

      // 连杀计时器

    // 连杀计时器
    if (killStreakTimer > 0) {
      killStreakTimer -= dt;
      if (killStreakTimer <= 0) killStreak = 0;
    }

      // 敌人 AI：导航流场给出绕障方向，视线决定能否出手（隐身时敌人不攻击）
      const crowd = spawner.all();
      nav.updateTarget(player.position.x, player.position.z);
      const navDir = { x: 0, z: 0 };
      for (const e of crowd) {
        e.updateFlash(dt);
        e.tickElite(dt);
        if (!e.alive) {
          e.tickCorpse(dt); // 倒地动画（播完由 spawner.sweep 回收）
          continue;
        }
        if (stealthTimer > 0) continue;
        const died = e.tickBurn(dt);
        if (died) {
          if (registerEnemyKill(e)) break;
          continue;
        }
        const ep = e.root.position;
        const sees = nav.hasLineOfSight3D(ep.x, ep.y + 1.15, ep.z, player.position.x, player.position.y + 1.1, player.position.z);
        navDir.x = 0;
        navDir.z = 0;
        nav.steer(ep.x, ep.z, ep.y, navDir);
        const evt = e.update(dt, player.position, { navX: navDir.x, navZ: navDir.z, seesPlayer: sees });
        if (evt) {
          if (evt.melee !== undefined || evt.blast !== undefined) {
            if (evt.blast !== undefined) {
              e.die();
              sfx.boom();
              addShake(0.22, 0.45);
              // 爆炸按真实半径 + 遮挡结算：跑出范围和隔墙都不掉血
              const dx = player.position.x - e.root.position.x;
              const dz = player.position.z - e.root.position.z;
              const dy = player.position.y - e.root.position.y;
              const radius = e.def.blastRadius > 0 ? e.def.blastRadius : 2.6;
              const exposed = nav.hasLineOfSight3D(
                e.root.position.x,
                e.root.position.y + 0.8,
                e.root.position.z,
                player.position.x,
                player.position.y + 1.0,
                player.position.z
              );
              if (dx * dx + dz * dz <= radius * radius && Math.abs(dy) < 2.2 && exposed) {
                applyDamageToPlayer(evt.blast);
                shell.hud.hit();
              }
            } else {
              applyDamageToPlayer(evt.melee ?? 0);
              shell.hud.hit();
            }
          }
          if (evt.spit) {
            // 真弹丸：飞行时间可躲，命中后统一结算；弹道被掩体截断
            sfx.spit();
            projectiles.spawn(evt.spit.from, clipToObstacles(evt.spit.from, evt.spit.to), 0x3fb96a, 13, evt.spit.damage);
          }
          if (evt.cast) {
            // 弹幕法师三连弹：紫色弹丸
            sfx.spit();
            for (const c of evt.cast) {
              projectiles.spawn(c.from, clipToObstacles(c.from, c.to), 0xcc88ff, 11, c.damage);
            }
          }
        }
      }

      // 移动物理：障碍推回 → 体积分离 → 玩家体积 → 再次障碍 → 贴地/下落
      for (const e of crowd) {
        if (!e.alive) continue;
        clampArena(e.root.position);
        e.refuseClimb(player.terrainHeight(e.root.position.x, e.root.position.z));
        resolveEnemyObstacles(e.root.position, e.def.radius + 0.06);
      }
      const sep = { x: 0, z: 0 };
      // 两次松弛：密集怪群里单次分离会因相互抵消而残留重叠
      for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < crowd.length; i++) {
          const a = crowd[i];
          if (!a.alive) continue;
          for (let j = i + 1; j < crowd.length; j++) {
            const b = crowd[j];
            if (!b.alive) continue;
            if (Math.abs(a.root.position.y - b.root.position.y) > 1.4) continue;
            if (separationDelta(
              a.root.position.x,
              a.root.position.z,
              a.def.radius + 0.06,
              b.root.position.x,
              b.root.position.z,
              b.def.radius + 0.06,
              sep,
              ((i * 7 + j) * 2.399) % (Math.PI * 2),
              0.6
            )) {
              a.root.position.x += sep.x;
              a.root.position.z += sep.z;
              b.root.position.x -= sep.x;
              b.root.position.z -= sep.z;
            }
          }
        }
      }
      for (const e of crowd) {
        if (!e.alive) continue;
        const ep = e.root.position;
        // 不许钻进玩家身体（近战仍能贴到 0.7~0.9m 出手）
        const dx = ep.x - player.position.x;
        const dz = ep.z - player.position.z;
        const d = Math.hypot(dx, dz);
        const minD = 0.3 + e.def.radius;
        if (d < minD && Math.abs(ep.y - player.position.y) < 1.4) {
          if (d > 1e-4) {
            ep.x = player.position.x + (dx / d) * minD;
            ep.z = player.position.z + (dz / d) * minD;
          } else {
            ep.x = player.position.x + minD;
          }
        }
        clampArena(ep);
        resolveEnemyObstacles(ep, e.def.radius + 0.06);
        e.refuseClimb(player.terrainHeight(ep.x, ep.z));
        e.applyGroundMotion(player.terrainHeight(ep.x, ep.z), dt);
      }

      // 状态特效：燃烧火花 / 减速蓝霜 / 晕眩星火（10Hz，避免粒子风暴）
      statusFxAcc -= dt;
      if (statusFxAcc <= 0) {
        statusFxAcc = 0.1;
        for (const e of crowd) {
          if (!e.alive) continue;
          if (e.isBurning()) {
            e.centerInto(centerScratch);
            centerScratch.y += 0.6 + Math.random() * 0.5;
            fx.emit(centerScratch, 0xff7a33, 1, 0.9, 0.8);
          }
          if (e.isSlowed()) {
            e.centerInto(centerScratch);
            centerScratch.y += 0.5 + Math.random() * 0.7;
            fx.emit(centerScratch, 0x66c8ff, 1, 0.6, 0.7);
          }
          if (e.isStunned()) {
            e.centerInto(centerScratch);
            centerScratch.y += 1.35 + Math.random() * 0.25;
            fx.emit(centerScratch, 0xffd24a, 2, 1.1, 0.6);
          }
        }
      }

      // 敌人弹丸推进与命中
      const projDmg = projectiles.update(dt, player.position, terrainHeightAt);
      if (projDmg > 0) {
        applyDamageToPlayer(projDmg);
        shell.hud.hit();
      }

      // BOSS AI
      if (activeBoss && activeBoss.alive) {
        // 转阶段演出：吼叫 + 公告 + 冲击环（bossPhase<0 表示刚记录，不触发）
        if (activeBoss.phase !== bossPhaseSeen) {
          if (bossPhaseSeen >= 0) {
            sfx.roar();
            showAnnouncement('⚠ 狂暴化', '#ff4444', 1500);
            fx.burst(activeBoss.root.position, 0xff4a22, 6);
            activeBoss.centerInto(centerScratch);
            fx.emit(centerScratch, 0xff5a22, 22, 6.5, 2);
          }
          bossPhaseSeen = activeBoss.phase;
        }
        // BOSS 追击也走导航流场绕障；地面高度每帧注入（践踏跳跃叠在地形上）
        bossNav.updateTarget(player.position.x, player.position.z);
        const bossDir = { x: 0, z: 0 };
        bossNav.steer(activeBoss.root.position.x, activeBoss.root.position.z, activeBoss.root.position.y, bossDir);
        const bevt = activeBoss.update(dt, player.position, { navX: bossDir.x, navZ: bossDir.z });
        activeBoss.applyGround(terrainHeightAt(activeBoss.root.position.x, activeBoss.root.position.z));
        // BOSS 体积碰撞兜底：冲锋/被击退都不得穿墙，也不许站进斜坡体内
        clampArena(activeBoss.root.position);
        resolveEnemyObstacles(activeBoss.root.position, 1.25);
        activeBoss.applyGround(terrainHeightAt(activeBoss.root.position.x, activeBoss.root.position.z));
        if (bevt) {
          const bp = activeBoss.root.position;
          // BOSS 的所有直接伤害都要过视线：隔墙不结算
          const bossLos = nav.hasLineOfSight3D(
            bp.x,
            bp.y + 1.2,
            bp.z,
            player.position.x,
            player.position.y + 1.0,
            player.position.z
          );
          if (bevt.melee !== undefined) {
            // 横扫 / 冲锋撞击（撞击是冲锋结束帧的 melee 结算）
            if (bossLos) {
              applyDamageToPlayer(bevt.melee);
              shell.hud.hit();
            }
          } else if (bevt.chargeDir) {
            // 冲锋起手只做预警，伤害只在撞击帧结算；不能起手瞬发
            addShake(0.1, 0.2);
          } else if (bevt.stompRadius) {
            addShake(0.2, 0.4);
            if (bossLos && player.position.distanceTo(bp) < bevt.stompRadius) {
              applyDamageToPlayer(8);
              shell.hud.hit();
            }
          } else if (bevt.summon) {
            // 召唤物围绕 BOSS 出现，而不是全图随机位置 / 玩家脚下
            spawner.spawnWave(
              { chasers: bevt.summon, boomers: 0, spitters: 0 },
              { center: { x: activeBoss.root.position.x, z: activeBoss.root.position.z }, placeMin: 3.5, placeMax: 9 }
            );
            syncBossModel();
          }
        }
      }

      spawner.sweep();
      pickChests();
      // 特效层统一推进（粒子/冲击环在 GPU 侧，跳字在单张 2D canvas）
      fx.update(dt, world.camera);
      flow.update(dt, hp > 0);

      // 击杀成就计数 + 连杀系统 + 局内升级
      if (flow.kills > lastKills) {
        const gained = flow.kills - lastKills;
        achAdd('kills', gained);
        addDailyProgress(dailyState, 'kills', gained); // 每日任务：击杀
        lastKills = flow.kills;
        // 击杀经验/连杀已由各击杀来源统一结算，这里只做成就/每日进度
      }

      tracer.update(dt);
      const moving = snap.forward || snap.back || snap.left || snap.right;
      viewmodel?.update(dt, moving);

      // BUFF 球：拾取检测 + 旋转动画
      for (let i = buffOrbs.length - 1; i >= 0; i--) {
        const orb = buffOrbs[i];
        orb.mesh.rotation.y += dt * 2.2;
        orb.mesh.children[0]!.position.y = 0.9 + Math.sin(time * 3 + i) * 0.15;
        if (
          player.position.distanceToSquared(orb.mesh.position) < 2.6 &&
          canPickupLoot(orb.mesh.position.x, orb.mesh.position.y, orb.mesh.position.z)
        ) {
          pickOrb(orb.kind);
          world.scene.remove(orb.mesh);
          sfx.pickup();
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
          monsterLevel: flow.monsterLevel,
          playerLevel: runState.level,
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
          shell.hud.boss(activeBoss.spec.name, Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100));
        } else {
          shell.hud.hideBoss();
        }
      }

      hitFlash = Math.max(0, hitFlash - dt);
      hurtInvuln = Math.max(0, hurtInvuln - dt);
      // 毒池陷阱：玩家/敌人踩入持续掉毒伤
      const pools = (mapRoot?.userData.poisonPools ?? []) as { x: number; z: number; r: number }[];
      if (pools.length > 0 && !inMenu && flow.phase !== 'clear' && flow.phase !== 'failed') {
        const hf = (mapRoot?.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? (() => 0);
        for (const pool of pools) {
          // 以池子所在地面为基准：高地上的池照样生效，平台上的玩家/敌人不会被隔空毒到
          const poolGround = hf(pool.x, pool.z);
          const dx = player.position.x - pool.x;
          const dz = player.position.z - pool.z;
          if (dx * dx + dz * dz < pool.r * pool.r && Math.abs(player.position.y - poolGround) < 0.7) {
            setHp(hp - 8 * dt);
            if (Math.random() < 0.08) spawnParticles(player.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x3a8a4a, 1, 0.5);
          }
          // 敌人同样受毒池影响
          for (const e of spawner.all()) {
            if (!e.alive) continue;
            const ex = e.root.position.x - pool.x;
            const ez = e.root.position.z - pool.z;
            if (ex * ex + ez * ez < pool.r * pool.r && Math.abs(e.root.position.y - poolGround) < 0.7) {
              const dead = e.takeDamage(8 * dt);
              if (dead && registerEnemyKill(e)) break;
            }
          }
        }
      }
      events.emit('frame', { tick: Math.floor(time / dt) });
    },
    onRender: () => {
      perfSample();
      // 仅战斗/结算画面渲染 3D（菜单态纯 DOM，省渲染开销）
      if (flow.phase !== 'clear' && flow.phase !== 'failed' && !inMenu) {
        world.render();
      }
    },
  });

  events.on('boot', (p) => console.debug('[bus] boot at', p.time.toFixed(2)));
  events.emit('boot', { time: 0 });

  services.register('world', world);
  services.register('spawner', spawner);

  // 开发期调试钩子（正式发布前移除�?
  const dbg = window as unknown as { __ss?: Record<string, unknown> };
  dbg.__ss = {
    /** 性能快照：FPS / 绘制调用 / 三角形 / 资源数 / 场上次级对象数 */
    perf(): Record<string, number> {
      const info = world.renderer.info;
      return {
        fps: +perfFps.toFixed(1),
        frameMs: +perfFrameMs.toFixed(2),
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        dpr: +world.renderer.getPixelRatio().toFixed(2),
        enemies: spawner.all().length,
      };
    },
    /** 画质档位切换（low/medium/high，auto=true 恢复自动升降档） */
    setQuality(level: 'low' | 'medium' | 'high', auto = false): string {
      world.setQuality(level, auto);
      return world.quality;
    },
    /** 直接进入指定副本（跳过菜单，压测用） */
    enterCombat(index = 0): void {
      document.querySelectorAll('.ss-screen').forEach((s) => s.classList.add('hidden'));
      missionIndex = Math.max(0, Math.min(MISSIONS.length - 1, index));
      flow.mission = MISSIONS[missionIndex];
      beginMission();
    },
    /** 压力测试：一次刷 n 只追击怪（hpMult 拉高避免被打死，便于稳态采样） */
    spawnStress(n = 20, spread = 14, hpMult = 1e6): void {
      spawner.spawnWave({ chasers: n, boomers: 0, spitters: 0 }, { hpMult });
      syncBossModel();
      const placed: { x: number; z: number; r: number }[] = [];
      for (const e of spawner.all()) {
        const spot = nav.findSpawnPoint(
          () => placementRng.next(),
          player.position.x,
          player.position.z,
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
      player.yaw = yaw;
      player.pitch = Math.max(-1.5, Math.min(1.5, pitch));
    },
    /** 传送到指定水平位置（贴地） */
    moveTo(x: number, z: number): void {
      player.position.set(x, player.terrainHeight(x, z), z);
    },
    /** 调试：把 BOSS 挪到指定水平位置（寻路回归用） */
    moveBoss(x: number, z: number): void {
      if (!activeBoss) return;
      activeBoss.root.position.set(x, player.terrainHeight(x, z), z);
    },
    /** BOSS 状态与动画（调试用） */
    bossInfo(): Record<string, unknown> | null {
      if (!activeBoss) return null;
      const p = activeBoss.root.position;
      return {
        hp: Math.round(activeBoss.hp),
        maxHp: Math.round(activeBoss.maxHp),
        phase: activeBoss.phase,
        children: activeBoss.root.children.length,
        anim: activeBoss.animState(),
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        z: +p.z.toFixed(2),
        ground: +player.terrainHeight(p.x, p.z).toFixed(2),
        dist: +Math.hypot(p.x - player.position.x, p.z - player.position.z).toFixed(2),
        alive: activeBoss.alive,
        charging: activeBoss.isCharging(),
      };
    },
    /** 按兵种刷怪（调试/截图用） */
    spawnKinds(counts: Partial<Record<string, number>>, hpMult = 1e6): number {
      spawner.spawnWave(
        {
          chasers: counts.chaser ?? 0,
          boomers: counts.boomer ?? 0,
          spitters: counts.spitter ?? 0,
          guards: counts.guard ?? 0,
          berserkers: counts.berserker ?? 0,
          casters: counts.caster ?? 0,
        },
        { hpMult }
      );
      syncBossModel();
      // 排成一排摆在玩家正前方（截图/对比用），落点贴地
      const list = spawner.all();
      for (let i = 0; i < list.length; i++) {
        const off = (i - (list.length - 1) / 2) * 1.55;
        const x = player.position.x + off;
        const z = player.position.z - 5;
        list[i].place(x, z, player.terrainHeight(x, z));
      }
      return list.length;
    },
    /** 关卡切换用的环境统计已由 envInfo 提供 */

    /** 开关自动开火（压测命中特效链路） */
    setBenchFire(on: boolean): void {
      benchFire = on;
    },
    teleportEnemies(offsetX: number, offsetZ: number): void {
      for (const e of spawner.all()) {
        const x = player.position.x + offsetX;
        const z = player.position.z + offsetZ;
        e.place(x, z, player.terrainHeight(x, z));
      }
      syncBossModel();
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
    /** 敌人运动采样：位置/地面高度/与玩家距离/卡位状态（AI 调试与回归用） */
    enemyMotion(): {
      kind: string;
      x: number;
      y: number;
      z: number;
      ground: number;
      dist: number;
      radius: number;
      alive: boolean;
      stunned: boolean;
    }[] {
      return spawner.all().map((e) => ({
        kind: e.def.kind,
        radius: e.def.radius,
        x: +e.root.position.x.toFixed(2),
        y: +e.root.position.y.toFixed(2),
        z: +e.root.position.z.toFixed(2),
        ground: +player.terrainHeight(e.root.position.x, e.root.position.z).toFixed(2),
        dist: +Math.hypot(e.root.position.x - player.position.x, e.root.position.z - player.position.z).toFixed(2),
        alive: e.alive,
        stunned: e.isStunned(),
      }));
    },
    playerHp(): number {
      return Math.round(hp);
    },
    /** 调试：UI/暂停状态（验证面板开关与输入分支） */
    uiState(): { paused: boolean; shopOpen: boolean; settings: boolean; menu: boolean } {
      return { paused, shopOpen, settings: settingsPanel.visible(), menu: inMenu };
    },
    /** 调试：跨局战斗状态（验证重开清理） */
    combatState(): {
      killStreak: number;
      shortBuffs: { fireSpd: number; crit: number; move: number };
      buffs: { atk: number; shield: number; speed: number };
      shield: number;
      shieldCooldown: number;
      fury: number;
      stealth: number;
      roleCooldown: number;
      meleeCooldown: number;
      dashCooldown: number;
      summon: boolean;
      inferno: boolean;
      heal: boolean;
      maxHp: number;
      hp: number;
    } {
      return {
        killStreak,
        shortBuffs: { ...shortBuffs },
        buffs: { ...buffs },
        shield: +shieldTimer.toFixed(2),
        shieldCooldown: +shieldCooldown.toFixed(2),
        fury: +furyTimer.toFixed(2),
        stealth: +stealthTimer.toFixed(2),
        roleCooldown: +roleCooldown.toFixed(2),
        meleeCooldown: +meleeCooldown.toFixed(2),
        dashCooldown: +dashCooldown.toFixed(2),
        summon: !!summonGroup,
        inferno: !!infernoMesh,
        heal: !!healMesh,
        maxHp: Math.round(maxHp),
        hp: Math.round(hp),
      };
    },
    /** 调试：毒池位置与所在地面高度 */
    poolsInfo(): { x: number; z: number; r: number; ground: number }[] {
      const hf = (mapRoot?.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? (() => 0);
      return ((mapRoot?.userData.poisonPools ?? []) as { x: number; z: number; r: number }[]).map((p) => ({
        x: +p.x.toFixed(2),
        z: +p.z.toFixed(2),
        r: +p.r.toFixed(2),
        ground: +hf(p.x, p.z).toFixed(2),
      }));
    },
    /** 调试：宝箱落点/奖励 */
    chestsInfo(): { x: number; y: number; z: number; ground: number; reward: string; amount: number }[] {
      return chests.map((c) => ({
        x: +c.mesh.position.x.toFixed(2),
        y: +c.mesh.position.y.toFixed(2),
        z: +c.mesh.position.z.toFixed(2),
        ground: +player.terrainHeight(c.mesh.position.x, c.mesh.position.z).toFixed(2),
        reward: c.reward,
        amount: c.amount,
      }));
    },
    /** 调试：木箱位置/存活（校验是否被平台吞掉） */
    cratesInfo(): { x: number; z: number; alive: boolean; ground: number }[] {
      return crates.map((c) => ({
        x: c.x,
        z: c.z,
        alive: c.alive,
        ground: +player.terrainHeight(c.x, c.z).toFixed(2),
      }));
    },
    playerPos(): { x: number; y: number; z: number; ground: number; onGround: boolean } {
      return {
        x: +player.position.x.toFixed(2),
        y: +player.position.y.toFixed(2),
        z: +player.position.z.toFixed(2),
        ground: +player.terrainHeight(player.position.x, player.position.z).toFixed(2),
        onGround: player.onGround,
      };
    },
    /** 调试：切换角色（验证召唤/炼狱等角色技能的视线判定） */
    setRole(id: string): boolean {
      if (!ROLES.some((r) => r.id === id)) return false;
      selectedRoleId = id;
      return true;
    },
    /** 导航网格状态（校验换图后是否成功烘焙） */
    navInfo(): { ready: boolean; obstacles: number; cell: number } {
      return { ready: nav.ready, obstacles: nav.obstacles.length, cell: nav.cell };
    },
    /** 碰撞体列表（地图调试：确认随机道具是否堵路） */
    obstaclesDump(): { x: number; z: number; hw: number; hd: number; top: number; crate: boolean }[] {
      return nav.obstacles.map((o) => ({ x: o.x, z: o.z, hw: o.hw, hd: o.hd, top: +o.top.toFixed(2), crate: !!o.crate }));
    },
    /** 单点导航探针：可走/可达/流场方向（AI 调试用） */
    navProbe(x: number, z: number): { walkable: boolean; reachable: boolean; dx: number; dz: number; dist: number; rawDx: number; rawDz: number } {
      nav.updateTarget(player.position.x, player.position.z);
      const out = { x: 0, z: 0 };
      nav.steer(x, z, player.terrainHeight(x, z), out);
      const raw = { x: 0, z: 0 };
      const rawOk = nav.rawFlow(x, z, raw);
      return {
        walkable: nav.isWalkable(x, z),
        reachable: nav.reachable(x, z),
        dx: +out.x.toFixed(2),
        dz: +out.z.toFixed(2),
        dist: nav.distanceAt(x, z),
        rawDx: rawOk ? +raw.x.toFixed(2) : 0,
        rawDz: rawOk ? +raw.z.toFixed(2) : 0,
      };
    },
    enemyDump(): { childTypes: string[]; modelApplied: boolean; barOk: boolean; modelVisible: boolean }[] {
      return spawner.all().map((e) => ({
        childTypes: e.root.children.map((c) => `${c.type}[${c.name || ''}] children=${c.children.length} vis=${c.visible}`),
        modelApplied: e.root.children.some((c) => (c as THREE.Mesh).isMesh),
        // 血条为精灵（第 2 个子节点），满血时隐藏
        barOk: e.root.children.some((c) => (c as THREE.Sprite).isSprite),
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
          syncBossModel();
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
          if (addKillExp(runState, false, 1, 1 + bonuses.expBonus)) {
            sfx.levelUp();
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
      return +player.terrainHeight(x, z).toFixed(2);
    },
    addDailyKills(n: number): void {
      addDailyProgress(dailyState, 'kills', n);
    },
    orbState(): { orbs: number; short: { fireSpd: number; crit: number; move: number } } {
      return { orbs: buffOrbs.length, short: { ...shortBuffs } };
    },
    /** 调试：在指定水平位置生成 BUFF 球（校验平台/坡上的贴地） */
    spawnOrbAt(x: number, z: number): void {
      spawnBuffOrb(new THREE.Vector3(x, 0, z));
    },
    orbsInfo(): { x: number; y: number; z: number; ground: number }[] {
      return buffOrbs.map((o) => ({
        x: +o.mesh.position.x.toFixed(2),
        y: +o.mesh.position.y.toFixed(2),
        z: +o.mesh.position.z.toFixed(2),
        ground: +player.terrainHeight(o.mesh.position.x, o.mesh.position.z).toFixed(2),
      }));
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
      syncBossModel();
    },
    killBoss(): void {
      if (activeBoss && activeBoss.alive) {
        activeBoss.hp = 0;
        activeBoss.alive = false;
        syncBossModel();
      }
    },
    /** 调试：对 BOSS 造成伤害并走统一死亡结算（验证经验/掉落/塔模式升级队列） */
    damageBoss(amount: number): { dead: boolean; hp: number } | null {
      if (!activeBoss || !activeBoss.alive) return null;
      const boss = activeBoss;
      const dead = boss.takeDamage(amount);
      if (dead) onBossKilled(boss);
      return { dead, hp: Math.max(0, Math.round(boss.hp)) };
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
