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
import { World, SPAWN_POINT, ARENA_RADIUS } from './render';
import { Fx } from './render/fx';
import { createAssetLib } from './render/assets';
import { Input } from './play/input';
import { Radar } from './shell/radar';
import { drawRadar } from './shell/radarFeed';
import { createSettingsPanel, loadSettings } from './shell/settings';
import { PlayerController } from './play/controller';
import { TracerPool, Viewmodel, RARITY_COLORS } from './arsenal';
import type { FireContext } from './arsenal';
import { Enemy, NavField, Spawner, SpatialHash } from './horde';
import type { Element, NavObstacle } from './horde';
import { ProjectilePool } from './horde/projectiles';
import { MISSIONS, MissionFlow, createPlacement, rebuildMissionMap, loadDifficulty, saveDifficulty, recordMissionClear, clearRewards, towerFailureRewards, towerFloorClearRewards } from './campaign';
import type { MissionBarrel, MissionCrate } from './campaign';
import { Inventory, tryUpgrade, tryAscend, loadTalents, talentBonuses, upgradeTalent, loadAchievements, addProgress, grantReward, baseStats, applyBuffs, applyBuff, tickBuffs, affixCritMult, affixSpdMult, affixEnergyMult, affixVampMult, newRun, addKillExp, rollChoices, applyChoice, runBonuses, loadDaily, ensureDaily, addDailyProgress, claimDaily, suppressionDealt, suppressionTaken, overloadAscensionMods, activePreset, autoPickLabel, pickBoost, elementSynergyMult, recordTowerBest, resetAllProgress } from './growth';
import { Arsenal } from './play/arsenal';
import { ROLES, findRole } from './play/roles';
import { Shell } from './shell';
import { skillLinesFor } from './play/weaponBrief';
import { hudFrame } from './play/hudFrame';
import { separateCrowd } from './play/crowdStep';
import { clipToObstacles, pointOnObstacleSurface } from './play/raycast';
import { castHitscan } from './play/hitscan';
import {
  BARREL_BASE_DMG,
  BARREL_CHAIN_DELAY,
  BARREL_PLAYER_DMG,
  BARREL_RADIUS,
  barrelFalloff,
  collectChainBarrels,
} from './play/barrels';
import { streakEvent } from './play/streak';
import { shotDamage } from './play/shotDamage';
import { dashStep } from './play/dash';
import { mitigatedDamage } from './play/damageTaken';
import { emitStatusFx, tickOrbPickups, tickShortBuffs } from './play/fieldTicks';
import { tickEnemies } from './play/enemyTick';
import { tickBoss } from './play/bossTick';
import { applyHudFrame } from './shell/hudUpdate';
import { findNearestVisible, resolvePierceTargets } from './play/targeting';
import { chainLightning } from './play/chain';
import { weakpointFromAim } from './play/weakpoint';
import { POISON_DPS, inPoisonPool } from './play/hazards';
import type { PoisonPool } from './play/hazards';
import { ORB_KINDS, rollChestReward, rollOrbKind } from './play/loot';
import type { OrbKind } from './play/loot';
import { resolveCrowdObstacles, settleCrowd } from './play/enemyPhysics';
import type { EnemyPhysicsCtx } from './play/enemyPhysics';
import { combatGood } from './play/combatShop';
import { MOODS } from './play/ambience';
import type { QueryDeps } from './debug/queries';
import type { StateDeps } from './debug/stateQueries';
import { createDebugApi } from './debug/commands';
import { mountEnvModels } from './render/envMount';
import { buildChestMesh, buildOrbMesh, buildRoleRing, buildSummonMesh } from './render/lootModels';

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
  let pointerLockTries = 0;
  let pointerUnlockCalls = 0;
  const requestPointerLockSafe = (): void => {
    pointerLockTries += 1;
    try {
      const ret = world.renderer.domElement.requestPointerLock() as unknown;
      if (ret && typeof (ret as Promise<void>).catch === 'function') (ret as Promise<void>).catch(() => {});
    } catch {
      /* 环境不支持指针锁定：忽略，仍可继续游戏 */
    }
  };
  world.renderer.domElement.addEventListener('click', () => {
    // 商店/设置/暂停等模态打开时不要抢指针锁：光标消失会让界面看起来“卡死”
    if (paused || inMenu || shopOpen || settingsPanel.visible()) return;
    requestPointerLockSafe();
  });
  /** 弹出交互界面时解锁鼠标（升级选牌/暂停/结算）；返回战斗时重新锁定 */
  const unlockMouse = (): void => {
    pointerUnlockCalls += 1;
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
      // 天赋伤害加成统一走 computeStats().attackMult，不再折进武器自身倍率（否则乘两次）
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
    speed: 5.2, jumpSpeed: 6.6, gravity: 16, eyeHeight: 1.6, boundRadius: ARENA_RADIUS - 0.5,
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
  let viewmodelWeaponId = '';
  const mountViewmodel = (): void => {
    if (viewmodel) world.camera.remove(viewmodel.group);
    const w = arsenal.current;
    viewmodel = new Viewmodel(w.def.archetype, w.def.color);
    viewmodelWeaponId = w.def.id;
    world.camera.add(viewmodel.group);
  };

  const tracer = new TracerPool(world.scene);
  const spawner = new Spawner(world.scene, 20260813);
  /** 小怪导航流场：换图时烘焙，玩家跨格时更新 */
  const nav = new NavField();
  /** 地形射线（弹道遮挡用；绑定一次避免每次开火新建闭包） */
  const terrainRay = nav.terrainRayDistance.bind(nav);
  const navLos = nav.hasLineOfSight3D.bind(nav);
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
  interface Orb {
    mesh: THREE.Group;
    kind: OrbKind;
  }
  const buffOrbs: Orb[] = [];
  /** 短期增益计时（8s） */
  const shortBuffs = { fireSpd: 0, crit: 0, move: 0 };
  const SHORT_BUFF_SECONDS = 8;

  const spawnBuffOrb = (pos: THREE.Vector3): void => {
    const pick = rollOrbKind();
    const g = buildOrbMesh(pick.color);
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
    const g = buildChestMesh(big);
    // 随机位置（远离玩家 4-10m）：优先走导航落点，保证不埋墙/平台，且贴真实地形；
    // 同时避开场上已有宝箱，避免补给层多箱重叠成一堆
    const occupied = chests.map((c) => ({ x: c.mesh.position.x, z: c.mesh.position.z, r: 0.5 }));
    const spot = nav.findSpawnPoint(() => Math.random(), player.position.x, player.position.z, 4, 10, occupied, 1.0);
    if (spot) {
      g.position.set(spot.x, spot.y, spot.z);
    } else {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 6;
      const x = clamp(player.position.x + Math.cos(a) * d, -(ARENA_RADIUS - 1), ARENA_RADIUS - 1);
      const z = clamp(player.position.z + Math.sin(a) * d, -(ARENA_RADIUS - 1), ARENA_RADIUS - 1);
      g.position.set(x, player.terrainHeight(x, z), z);
    }
    world.scene.add(g);
    // 随机奖励
    const { reward, amount } = rollChestReward(big);
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
      // 返回任务简报是菜单态：必须冻结战斗并停止 3D 渲染，否则选关界面下
      // 流场仍会刷怪、玩家输入仍会移动射击。
      paused = true;
      inMenu = true;
      unlockMouse();
      spawner.clear();
      shell.showSelect();
    },
    onOpenArmory: () => {
      unlockMouse();
      shell.currentWeaponId = arsenal.current.def.id;
      shell.showArmory();
    },
    onAddToLoadout: (id) => {
      if (arsenal.addToLoadout(id)) {
        // 新建的 Weapon 实例需要重新注入局内倍率；第一人称模型也要跟随
        refreshGrowth();
        mountViewmodel();
        shell.currentWeaponId = arsenal.current.def.id;
      }
    },
    onRemoveFromLoadout: (id) => {
      arsenal.removeFromLoadout(id);
      if (arsenal.weapons.length === 0) {
        arsenal.addToLoadout(arsenal.defs[0]?.id ?? 'pulse-rifle');
      }
      refreshGrowth();
      mountViewmodel();
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
      // 价格/描述统一读 play/combatShop 的商品表，避免与界面各写一份
      const good = combatGood(id);
      if (!good || inventory.gold < good.price) return;
      inventory.spendGold(good.price);
      if (id === 'heal') setHp(hp + 60);
      else if (id === 'dmg') applyBuff(buffs, 'atk');
      else if (id === 'energy') arsenal.current.state.energy = arsenal.current.def.energyMax;
      else if (id === 'shield') shieldTimer = 12;
      else if (id === 'ammo') {
        for (const w of arsenal.weapons) {
          w.state.ammo = w.magCap();
          w.state.reloading = false;
        }
      } else if (id === 'crit') shortBuffs.crit = 12;
      shell.showCombatShop(inventory.gold); // 刷新剩余金币
    },
    onCombatClose: () => {
      shopOpen = false;
      paused = false;
      shell.hideCombatShop();
      shell.hud.root.style.display = 'block';
      lockMouse();
    },
    // 面板「暴击伤害」与战力按当前手持武器结算，与战斗一致（简报「暴击×N」即实际倍率）
    onStatsQuery: () => ({ ...computeStats(), critMult: arsenal.current.def.critMult }),
    onPickBoost: (id) => {
      applyBoostPick(id);
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
      saveDifficulty(d);
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
  const achAdd = (cond: 'kills' | 'clears' | 'upgrades' | 'ascensions' | 'autoPicks' | 'autoClears', amount: number): void => {
    const newly = addProgress(shell.achievementState, cond, amount);
    for (const a of newly) grantReward(inventory, a);
  };
  let escPaused = false;
  let armoryFromCombat = false;
  /** 难度（普通 1 / 困难 1.5 / 噩梦 2.2）；记住上次选择 */
  let difficulty = loadDifficulty();
  /** 菜单态（不渲染 3D，省性能） */
  let inMenu = true;
  /** 局内商店打开状态 */
  let shopOpen = false;
  /** 区域刷怪锚点（换图时从地图 userData 读取） */
  let spawnAnchors: { x: number; z: number }[] = [];
  const spawnPlacement = createPlacement({
    nav,
    anchors: () => spawnAnchors,
    rng: () => placementRng.next(),
    player: () => player.position,
  });

  function beginMission(): void {
    spawnPlacement.reset();
    runPickCount = 0;
    runAutoPickCount = 0;
    paused = false;
    escPaused = false;
    inMenu = false;
    settingsPanel.hide();
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
    dashInvuln = 0;
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
    // 重建关卡地图（移除旧地图并释放几何/材质，按 mapId + 任务变体生成新布局）
    const built = rebuildMissionMap(
      world,
      flow.mission.mapId,
      Math.max(0, MISSIONS.findIndex((m) => m.id === flow.mission.id)),
      mapRoot
    );
    mapRoot = built.mapRoot;
    spawnAnchors = built.spawnAnchors;
    // 可破坏箱（从地图配置重建；mesh 引用用于击碎后隐藏）
    crates.length = 0;
    for (const c of built.crates) crates.push(c);
    // 爆炸桶（每图 3~4 只，射击引爆）
    barrels.length = 0;
    for (const b of built.barrels) barrels.push(b);
    mountEnv(); // 挂载开源环境素材（Kenney CC0：岩石/树木/灌木）
    player.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
    // 换图后重新烘焙导航网格；刷怪落点由导航网格给出（不再随机刷在玩家脸上/墙里）
    buildNavsForMap();
    spawner.setPlacement(spawnPlacement.place);
    setHp(maxHp);
    flow.difficulty = difficulty;
    flow.start();
    syncBossModel();
    shell.startGame();
  }

  let mapRoot: THREE.Group | null = null;
  /** 可破坏箱（打碎掉补给） */
  const crates: MissionCrate[] = [];
  /** 爆炸桶（射击引爆，波及周围） */
  const barrels: MissionBarrel[] = [];

  /** 当前地图碰撞体 → 小怪/BOSS 两套导航网格（木箱/油桶移除后也必须重烘） */
  function buildNavsForMap(): void {
    const obs = (mapRoot?.userData.obstacles ?? []) as NavObstacle[];
    nav.build(obs, player.terrainHeight, { agentRadius: 0.62, stepHeight: 0.4, walkRadius: ARENA_RADIUS, minX: -ARENA_RADIUS - 1, maxX: ARENA_RADIUS + 1, minZ: -ARENA_RADIUS - 1, maxZ: ARENA_RADIUS + 1 });
    bossNav.build(obs, player.terrainHeight, { agentRadius: 1.3, stepHeight: 0.5, walkRadius: ARENA_RADIUS, minX: -ARENA_RADIUS - 1, maxX: ARENA_RADIUS + 1, minZ: -ARENA_RADIUS - 1, maxZ: ARENA_RADIUS + 1 });
  }

  /** 木箱/油桶从地图障碍中移除并重烘导航，打开被堵住的路线 */
  function removeCrateObstacle(c: { obstacle?: NavObstacle }): void {
    if (!c.obstacle) return;
    const obs = (mapRoot?.userData.obstacles ?? []) as NavObstacle[];
    const i = obs.indexOf(c.obstacle);
    if (i >= 0) obs.splice(i, 1);
    c.obstacle = undefined;
    buildNavsForMap();
  }

  /** 点燃引信（直射命中即近乎即时爆炸；链式引爆有短延时） */
  function igniteBarrel(b: MissionBarrel, delay = 0.02): void {
    if (!b.alive || b.fuse !== undefined) return;
    b.fuse = delay;
  }

  function explodeBarrel(b: MissionBarrel): void {
    if (!b.alive) return;
    b.alive = false;
    b.fuse = undefined;
    if (b.mesh) b.mesh.visible = false;
    removeCrateObstacle(b);
    const c = centerScratch.set(b.x, player.terrainHeight(b.x, b.z) + 0.6, b.z);
    spawnParticles(c, 0xff8a3a, 26, 7);
    spawnParticles(c, 0xffd24a, 14, 5);
    addShake(0.55, 0.4);
    sfx.boom();
    // 波及敌人：中心全额 → 边缘 35%
    for (const e of spawner.all()) {
      if (!e.alive) continue;
      e.centerInto(centerScratch);
      const d = Math.hypot(centerScratch.x - b.x, centerScratch.z - b.z);
      if (d > BARREL_RADIUS) continue;
      const dead = e.takeDamage(BARREL_BASE_DMG * barrelFalloff(d));
      if (dead) {
        registerEnemyKill(e);
        creditWeaponKill();
      }
    }
    if (activeBoss && activeBoss.alive) {
      activeBoss.centerInto(centerScratch);
      const d = Math.hypot(centerScratch.x - b.x, centerScratch.z - b.z);
      if (d <= BARREL_RADIUS + 1.5) {
        const dead = activeBoss.takeDamage(BARREL_BASE_DMG * barrelFalloff(Math.max(0, d - 1.5)));
        if (dead) onBossKilled(activeBoss);
      }
    }
    // 玩家站太近也有风险（冲刺无敌帧照常生效）
    const pd = Math.hypot(player.position.x - b.x, player.position.z - b.z);
    if (pd <= BARREL_RADIUS * 0.7) applyDamageToPlayer(BARREL_PLAYER_DMG * barrelFalloff(pd), { x: b.x, z: b.z });
    // 链式引爆邻近油桶 + 波及木箱（打碎掉补给）
    for (const nb of collectChainBarrels(barrels, b.x, b.z)) igniteBarrel(nb, BARREL_CHAIN_DELAY);
    for (const cr of crates) {
      if (!cr.alive) continue;
      const d = Math.hypot(cr.x - b.x, cr.z - b.z);
      if (d > BARREL_RADIUS) continue;
      cr.alive = false;
      if (cr.mesh) cr.mesh.visible = false;
      removeCrateObstacle(cr);
      spawnBuffOrb(new THREE.Vector3(cr.x, 0.8, cr.z));
      maybeDropOrb(new THREE.Vector3(cr.x, 0.8, cr.z));
      addDamagePopup(new THREE.Vector3(cr.x, 1.2, cr.z), '箱子击碎', '#ffd24a');
    }
  }

  /** 每帧推进引信并引爆炸桶 */
  function tickBarrels(dt: number): void {
    for (const b of barrels) {
      if (!b.alive || b.fuse === undefined) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) explodeBarrel(b);
    }
  }

  // ---------- 开源环境素材（Kenney CC0 nature-kit） ----------
  /** 按地图类型放置的环境模型清单 */
  let envRoot: THREE.Group | null = null;
  const envRef = { current: null as THREE.Group | null };
  const mountEnv = (): void => {
    if (envRoot) {
      envRoot.removeFromParent();
      envRoot = null;
      envRef.current = null;
    }
    if (!mapRoot) return;
    envRoot = mountEnvModels({
      mapRoot,
      mapId: flow.mission.mapId,
      assets,
      addProps: (parent, src, placements, tint) => world.addInstancedProps(parent, src, placements, tint),
      ref: envRef,
    });
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
  const radar = new Radar(148, 44);
  let radarFrame = 0;

  // 设置（O 键开关；音量/灵敏度/画质/雷达 即时生效并持久化）
  const settings = loadSettings();
  sfx.setVolume(settings.volume);
  sfx.setMuted(settings.muted);
  sfx.setMusic(settings.music);
  sfx.setMusicVolume(settings.musicVolume);
  world.camera.fov = settings.fov;
  world.camera.updateProjectionMatrix();
  world.setQuality(settings.quality === 'auto' ? 'medium' : settings.quality, settings.quality === 'auto');
  const settingsPanel = createSettingsPanel(settings, (s2) => {
    sfx.setVolume(s2.volume);
    sfx.setMuted(s2.muted);
    sfx.setMusic(s2.music);
    sfx.setMusicVolume(s2.musicVolume);
    world.setQuality(s2.quality === 'auto' ? 'medium' : s2.quality, s2.quality === 'auto');
    radar.el.style.display = s2.radar ? 'block' : 'none';
    if (world.camera.fov !== s2.fov) {
      world.camera.fov = s2.fov;
      world.camera.updateProjectionMatrix();
    }
    shell.hud.setCrosshairStyle(s2.crosshair);
  }, () => shell.showTips(), () => {
    resetAllProgress(localStorage);
    location.reload();
  });
  radar.el.style.display = settings.radar ? 'block' : 'none';
  shell.hud.setCrosshairStyle(settings.crosshair);
  let settingsWasOpen = false;

  // 打击停顿（hit-stop）：连杀/BOSS 死亡瞬间冻结逻辑几十毫秒，渲染继续，
  // 是动作游戏"顿挫感"的标准做法（比慢动作更干脆）
  let hitStopT = 0;
  let fixedTicks = 0;

  // 打击感：镜头微震 + FOV 冲击
  let shakeT = 0;
  let shakeDur = 0.001;
  let shakeAmp = 0;
  /** 镜头后坐力（当前帧上抬量） */
  let recoil = 0;
  let fovKick = 0;
  const baseFov = 60;
  const addShake = (amp: number, dur: number): void => {
    // 低动态：震屏强度/时长减半，避免晕动
    if (settings.lowMotion) {
      amp *= 0.45;
      dur *= 0.6;
    }
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
  /** 全屏闪白（转阶段/登场演出的冲击帧，纯表现层） */
  let flashEl: HTMLDivElement | null = null;
  function showWhiteFlash(opacity = 0.8, durationMs = 380): void {
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:9998;pointer-events:none;opacity:0;';
      document.body.appendChild(flashEl);
    }
    flashEl.style.transition = 'none';
    flashEl.style.opacity = String(opacity);
    requestAnimationFrame(() => {
      if (!flashEl) return;
      flashEl.style.transition = `opacity ${durationMs}ms ease-out`;
      flashEl.style.opacity = '0';
    });
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
    // 背景音乐按地图换情绪（火山低沉 / 冰原清冷 / 裂谷燥热）
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
        addShake(0.35, 0.8);
        showWhiteFlash(0.4, 500);
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
      const r = towerFloorClearRewards(flow.waveIndex, difficulty, runB.luckyGold);
      inventory.addGold(r.gold);
      inventory.addMaterial(r.material, r.materialAmount);
    }
    prevPhase = phase;
  };
  flow.onResult = (result) => {
    paused = true; // 死亡/通关后冻结战斗，等待界面操作
    inMenu = true;
    unlockMouse(); // 结算界面需要鼠标操作
    // 无尽塔：记录到达层数（失败也算），结算与选择页展示历史最佳
    const towerBest = result.mission.tower ? recordTowerBest(result.towerFloor) : undefined;
    const settleInput = {
      tower: !!result.mission.tower,
      towerFloor: result.towerFloor,
      // flow 在失败时会把 result 的奖励置 0；塔失败仍要按关卡基础奖励×层数缩放，
      // 所以这里直接读任务配表（通关时两者数值一致）
      rewardMaterial: result.mission.rewards.material,
      rewardAmount: result.mission.rewards.amount,
      kills: result.kills,
      missionLevel: result.mission.monsterLevel ?? 1,
      difficulty,
      luckyGold: runB.luckyGold,
      goldBonus: bonuses.gold,
    };
    let settleRewardText: string | undefined;
    if (result.phase === 'clear') {
      const r = clearRewards(settleInput);
      inventory.addMaterial(r.material, r.materialAmount);
      inventory.addGold(r.gold);
      settleRewardText =
        `${r.material} ×${r.materialAmount} · 金币 ${r.gold}` +
        (r.talentGain > 0 ? ` · 天赋点 +${r.talentGain}` : '');
      if (r.talentGain > 0) inventory.addTalentPoints(r.talentGain);
      addDailyProgress(dailyState, 'clears'); // 每日任务：通关
      achAdd('clears', 1);
      if (autoPickLabel()) achAdd('autoClears', 1);
      if (!result.mission.tower) recordMissionClear(result.mission.id, localStorage);
      refreshGrowth();
    } else if (result.phase === 'failed' && result.mission.tower) {
      const r = towerFailureRewards(settleInput);
      inventory.addMaterial(r.material, r.materialAmount);
      inventory.addGold(r.gold);
      settleRewardText = `${r.material} ×${r.materialAmount} · 金币 ${r.gold}`;
      refreshGrowth();
    }
    shell.showResult(result, {
      level: runState.level,
      picks: runPickCount,
      autoPicks: runAutoPickCount,
      preset: autoPickLabel(),
      towerBest,
      difficulty,
      rewardText: settleRewardText,
    });
  };

  /** 每帧复用的临时向量（避免热路径 new Vector3） */
  const eyeScratch = new THREE.Vector3();
  const muzzleScratch = new THREE.Vector3();
  const centerScratch = new THREE.Vector3();
  /** 敌人分离用空间哈希（复用，避免每帧分配） */
  const enemyHash = new SpatialHash(1.5);

  /**
   * 小怪水平碰撞：圆 vs 障碍 AABB。两次迭代，避免被相邻两个箱体夹住。
   * 站在障碍顶面（平台）时跳过，否则会被从平台上推下去。
   */
  const resolveEnemyObstacles = (pos: { x: number; y: number; z: number }, radius: number): void => {
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

  /** 限制在竞技场圆内（玩家 ARENA_RADIUS-0.5；敌人到 ARENA_RADIUS 给远程留空间） */
  const clampArena = (pos: { x: number; y: number; z: number }): void => {
    const r = Math.hypot(pos.x, pos.z);
    const maxR = ARENA_RADIUS;
    if (r > maxR) {
      const k = maxR / r;
      pos.x *= k;
      pos.z *= k;
    }
  };
  /** 敌人物理上下文（player.position 是 Vector3，结构化类型兼容 Vec3Like） */
  const enemyPhysicsCtx: EnemyPhysicsCtx = {
    player: player.position,
    terrainHeight: (x, z) => player.terrainHeight(x, z),
    clampArena,
    resolveObstacles: resolveEnemyObstacles,
  };

  // 音频上下文要在用户手势后创建/恢复（浏览器自动播放策略）
  const unlockAudio = (): void => sfx.resume();
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  /** 上一次 resolveHit 是否停在地形上（用于禁止对山后敌人的邻近结算） */
  let hitTerrainSurface = false;
  /** 最近一次命中点/目标中心（调试：验证弱点判定） */
  const lastHit = { y: 0, centerY: 0, weak: false, boss: false };

  /** 当前武器机制对应的伤害元素（烈焰/霜锋/雷暴/过载），其余按物理结算 */
  const currentElement = (): Element => {
    const kind = arsenal.current.def.mech.kind;
    if (kind === 'beam') return 'fire';
    if (kind === 'slow') return 'ice';
    if (kind === 'chain' || kind === 'energy' || kind === 'lockon') return 'energy';
    return 'physical';
  };

  /** 武器熟练度：本武器击杀 +1；每 20 杀 +2% 伤害，里程碑必须立即刷新缓存 */
  const creditWeaponKill = (): void => {
    const g = inventory.getWeapon(arsenal.current.def.id);
    g.kills += 1;
    if (g.kills % 20 === 0) refreshGrowth();
  };

  // 链式武器本发主命中的敌人：onChain 传给 chainLightning 排除，避免第一跳打回主目标
  let chainHitEnemy: Enemy | null = null;
  const fireCtx: FireContext = {
    origin: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    runPierce: { targets: 0, falloff: 0.6 },
    tracer,
    onShot: (): void => {
      sfx.shot(arsenal.current.def.archetype);
      // 枪口闪光：短促高亮粒子，配合 Bloom 形成枪口焰
      muzzleScratch.copy(fireCtx.origin).addScaledVector(fireCtx.direction, 0.85);
      fx.emit(muzzleScratch, 0xffd08a, settings.lowMotion ? 1 : 2, 0.9, 1.15);
      fovKick = Math.min(fovKick + (settings.lowMotion ? 0.35 : 0.9), 3.5);
      // 镜头后坐力：按枪型给不同的上抬，指数回落
      const kick: Record<string, number> = { rifle: 0.011, pistol: 0.008, smg: 0.006, shotgun: 0.028, sniper: 0.04 };
      recoil = Math.min(recoil + (kick[arsenal.current.def.archetype] ?? 0.012), 0.07);
    },
    resolveHit(origin, dir) {
      const cast = castHitscan({
        origin,
        dir,
        obstacles: nav.obstacles,
        terrainRay,
        crates,
        barrels,
        enemies: spawner.all(),
        boss: activeBoss && activeBoss.alive ? activeBoss : null,
      });
      hitTerrainSurface = cast.terrainSurface;
      return cast.point;
    },
    onHitEnemy(pos, damage, extra) {
      // 升级选牌已暂停：同一发/后续弹丸不再继续结算
      if (paused) return false;
      chainHitEnemy = null;
      // 射线停在掩体/地形表面：这一发不算命中任何单位（哪怕敌人贴在墙后/山后）
      if (pointOnObstacleSurface(pos, nav.obstacles)) return false;
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
      // 爆炸桶：先于敌人扣桶血，打空引信即爆
      for (const b of barrels) {
        if (!b.alive) continue;
        const bdx = b.x - pos.x;
        const bdz = b.z - pos.z;
        const bdy = 0.55 - pos.y;
        if (bdx * bdx + bdy * bdy + bdz * bdz < 0.95) {
          b.hp -= damage;
          spawnParticles(pos, 0xffd24a, 2, 1.6);
          if (b.hp <= 0) igniteBarrel(b);
          return true;
        }
      }
      /** 本次命中的跳字聚合键（BOSS / 兵种敌人各自一行不断累加） */
      let popupKey = '';
      let popupDmg = 0;
      let popupWeak = false;
      let popupKill = false;
      // 等级压制：玩家等级 vs 怪物等级（升级后打同级怪一定更轻松）
      const supDealt = suppressionDealt(runState.level - flow.monsterLevel);
      // 连杀增伤 + 隐身增伤 + 攻击倍率 + 局内成长 + 暴击（概率含词缀/暴击球；倍率取当前武器 def.critMult，与武器简报一致）
      const st = computeStats();
      const curG = inventory.getWeapon(arsenal.current.def.id);
      const critBonus = affixCritMult(curG) + (shortBuffs.crit > 0 ? 0.2 : 0) + runB.critBonus;
      const shot = shotDamage({
        base: damage,
        suppression: supDealt,
        killStreak,
        stealthMult: stealthTimer > 0 ? 2 * (1 + inventory.roleLevel(selectedRoleId) * 0.15) : 1,
        attackMult: st.attackMult,
        critChance: st.critRate + critBonus + (extra.critBonus ?? 0),
        critMult: arsenal.current.def.critMult + runB.critDmgBonus,
        runDamageMult: runB.dmgMult,
        // 高地优势：玩家比命中点低 0.4m 以上 → +20% 伤害
        highGround: player.position.y > pos.y - 0.6,
      });
      const isCrit = shot.isCrit;
      const dmg = shot.damage;
      popupDmg = dmg;
      if (activeBoss && activeBoss.alive) {
        activeBoss.centerInto(centerScratch);
        const bdx = centerScratch.x - pos.x;
        const bdy = centerScratch.y - pos.y;
        const bdz = centerScratch.z - pos.z;
        // 命中球体半径 3.2，判定半径需匹配（distance² < 12）
        if (bdx * bdx + bdy * bdy + bdz * bdz < 12) {
          popupKey = 'boss';
          const weakMult = weakpointFromAim(fireCtx.origin, fireCtx.direction, centerScratch);
          popupDmg = dmg * weakMult + (extra.flatBonus ?? 0);
          popupWeak = weakMult > 1;
          lastHit.y = +pos.y.toFixed(2);
          lastHit.centerY = +centerScratch.y.toFixed(2);
          lastHit.weak = popupWeak;
          lastHit.boss = true;
          const dead = activeBoss.takeDamage(popupDmg, elem);
          if (dead) onBossKilled(activeBoss);
          popupKill = dead;
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
          chainHitEnemy = e;
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
          if (extra.slow !== undefined) e.applySlow(extra.slow, extra.slowDur ?? 1.6);
          // 易伤（能量爆发进阶 2 命中附加）：持续时间内受伤 ×1.15
          if (extra.vuln !== undefined && extra.vuln > 0) e.applyVuln(extra.vuln);
          // 烈焰风暴：命中施加灼�?DOT
          if (arsenal.current.def.mech.kind === 'beam') e.applyBurn(2.2, 5);
          // 精英猎手：对精英额外伤害；狂暴：伤害 ×1.5；元素联动：冰缓暴击 / 灼烧易伤；弱点：命中头部 ×1.5
          const furyMult = furyTimer > 0 ? 1.5 : 1;
          const weakMult = weakpointFromAim(fireCtx.origin, fireCtx.direction, e.center());
          const finalDmg = (e.elite ? dmg * runB.eliteDmg : dmg) * furyMult * elementSynergyMult(isCrit, e.slowTimer > 0, e.burnTimer > 0) * weakMult + (extra.flatBonus ?? 0);
          popupDmg = finalDmg;
          popupWeak = weakMult > 1;
          lastHit.y = +pos.y.toFixed(2);
          lastHit.centerY = +e.center().y.toFixed(2);
          lastHit.weak = popupWeak;
          lastHit.boss = false;
          // 寒霜弹：命中减速
          if (runB.frost > 0) e.applySlow(1 - runB.frost, 1.5);
          const dead = e.takeDamage(finalDmg, elem);
          popupKill = dead;
          if (dead) {
            registerEnemyKill(e);
            fovKick = Math.max(fovKick, 2.2);
            creditWeaponKill();
          }
          hitSomething = true;
        }
      }
      if (hitSomething) {
        // 弱点命中（未击杀）轻顿 30ms；击杀的顿拍由 registerEnemyKill 统一给
        if (!popupKill && popupWeak) hitStopT = Math.max(hitStopT, 0.03);
        shell.hud.hitmark(popupKill ? 'kill' : popupWeak ? 'weak' : 'normal');
        sfx.hit();
        // 复用本发的实际暴击判定；不要再掷一次，否则跳字颜色/字号会与伤害不符
        if (settings.damageNumbers) {
          const txt = `${popupWeak ? '弱点 ' : ''}-${Math.round(popupDmg)}`;
          const color = popupWeak ? '#ffe066' : isCrit ? '#ffd24a' : '#ffb0a0';
          addDamagePopup(pos, txt, color, popupWeak ? 26 : isCrit ? 27 : 20, popupKey);
        }
        // 命中火花（小而淡，避免遮挡视野）；弱点命中更亮更大
        spawnParticles(pos, popupWeak ? 0xffe066 : isCrit ? 0xffd24a : 0xffaa66, popupWeak ? 4 : isCrit ? 3 : 2, popupWeak ? 2.6 : 2);
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
            if (sdead) {
              creditWeaponKill();
              if (registerEnemyKill(se)) break;
            }
          }
        }
      }
      return hitSomething;
    },
    findTarget(origin, maxRange) {
      return findNearestVisible(origin, maxRange, {
        enemies: () => spawner.all(),
        hasLineOfSight3D: navLos,
      });
    },
    resolvePierce(origin, dir, max) {
      return resolvePierceTargets(origin, dir, max, {
        enemies: () => spawner.all(),
        hasLineOfSight3D: navLos,
        obstacles: nav.obstacles,
        terrainRayDistance: terrainRay,
      });
    },
    onChain(pos, damage, jumps, falloff) {
      // 升级暂停后不再继续弹跳结算
      if (paused) return;
      chainLightning(pos, damage, jumps, falloff, {
        enemies: () => spawner.all(),
        hasLineOfSight3D: navLos,
        exclude: chainHitEnemy,
        fire: (from, to) => tracer.fire(from, to, 0x7ab0ff, 1.8),
        damage: (e, n) => e.takeDamage(n, 'energy'),
        onKill: (e) => {
          creditWeaponKill();
          return registerEnemyKill(e);
        },
      });
    },
    onHeal(amount) {
      setHp(hp + amount);
    },
    onShield(seconds) {
      shieldTimer = Math.max(shieldTimer, seconds);
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
  /** 本局成长统计（结算展示）：总领取数与自动领取数 */
  let runPickCount = 0;
  let runAutoPickCount = 0;
  const refreshRun = (): void => {
    runB = runBonuses(runState);
    // 局内「穿透弹」：主命中后继续穿透的目标数与衰减
    fireCtx.runPierce = { targets: runB.pierceStacks, falloff: runB.pierceFalloff };
    refreshGrowth();
    applySpeedMult();
    applyMaxHpGrowth();
  };

  /** 应用一次强化选择（手动/自动共用）：记层数、刷新增益、扣一次待选、弹提示 */
  function applyBoostPick(id: string, auto = false): void {
    const b = applyChoice(runState, id as Parameters<typeof applyChoice>[1]);
    runPickCount += 1;
    if (auto) {
      runAutoPickCount += 1;
      achAdd('autoPicks', 1);
    }
    refreshRun();
    pendingLevelUps = Math.max(0, pendingLevelUps - 1);
    addDamagePopup(player.position.clone().add(new THREE.Vector3(0, 1.6, 0)), `获得 · ${b.name} ×${runState.boosts[id as keyof typeof runState.boosts]}`, '#e8c377');
  }

  /** 展示当前待选的升级牌；每一级都会单独给一次选择（开启自动选择时直接按流派领取） */
  function showLevelUpChoices(): void {
    if (pendingLevelUps <= 0) return;
    const preset = activePreset();
    if (preset) {
      // 自动选择：不暂停、不弹牌；连升多级也逐级按优先级领完
      while (pendingLevelUps > 0) {
        const id = pickBoost(rollChoices(runState).map((b) => b.id), preset);
        if (!id) break;
        sfx.levelUp();
        applyBoostPick(id, true);
      }
      if (pendingLevelUps <= 0) return;
    }
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
    addKillBurst(e.root.position, elementBurstColor(currentElement()));
    spawnParticles(e.root.position, 0xffd24a, 4, 3.5);
    killStreak += 1;
    killStreakTimer = 2.5;
    // 击杀顿一拍：普通击杀 45ms，连杀 ≥3 加深到 70ms（BOSS 死亡另有 140ms 长顿）
    hitStopT = Math.max(hitStopT, killStreak >= 3 ? 0.07 : 0.045);
    const ev = streakEvent(killStreak);
    if (ev) {
      showAnnouncement(ev.text, ev.color, 1200);
      sfx.streak(killStreak);
      if (ev.heal > 0) setHp(hp + ev.heal);
    }
    return leveled;
  }
  const computeStats = (): ReturnType<typeof applyBuffs> => {
    if (statsCache) return statsCache;
    const base = baseStats(bonuses, growthSummary());
    statsCache = applyBuffs(base, buffs);
    return statsCache;
  };
  // 移速倍率应用到玩家控制器（含疾行球 + 局内疾行 + 过载形态进阶移速）
  const applySpeedMult = (): void => {
    const w = arsenal.current;
    const om = w.def.mech.kind === 'overload' && w.state.overloaded ? overloadAscensionMods(w.growthAscension).moveMult : 1;
    player.speedMult = computeStats().speedMult * (shortBuffs.move > 0 ? 1.4 : 1) * runB.moveMult * om;
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
  const applyDamageToPlayer = (v: number, src?: { x: number; z: number }): boolean => {
    // 等级压制：怪物等级高于玩家时伤害放大
    v *= suppressionTaken(runState.level - flow.monsterLevel);
    if (hurtInvuln > 0) return false; // 无敌帧：防多敌人同帧秒杀，也不再播放受击反馈
    if (dashInvuln > 0) {
      // 完美闪避：吃掉无敌帧并把冲刺冷却压到 ≤1.5s，鼓励主动读招
      dashInvuln = 0;
      dashCooldown = Math.min(dashCooldown, 1.5);
      addDamagePopup(player.position.clone().add(new THREE.Vector3(0, 1.7, 0)), '完美闪避 · 冲刺冷却缩短', '#9fc9e8', 16);
      sfx.pickup();
      return false;
    }
    if (!Number.isFinite(v) || v <= 0) return false; // NaN 防护
    hurtInvuln = 0.4;
    sfx.hurt();
    addShake(0.14, 0.32);
    // 受击红色碎片
    spawnParticles(player.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xff4444, 2, 2.2);
    if (src) {
      // 受击方向指示：来源超出视野中轴（>60°）才提示，准星弧指向来源侧
      const yawToSrc = Math.atan2(player.position.x - src.x, player.position.z - src.z);
      const rel = Math.atan2(Math.sin(yawToSrc - player.yaw), Math.cos(yawToSrc - player.yaw));
      if (Math.abs(rel) > Math.PI / 3) shell.hud.hitFrom((-rel * 180) / Math.PI);
    }
    const st = computeStats();
    const furyResist = furyTimer > 0 ? 0.3 : 0;
    // 总减伤（天赋韧性 + 局内铁壁 + 狂暴抗性）夹取到 85%，避免叠穿
    const afterArmor = mitigatedDamage(v, st.armor, runB.armorBonus, furyResist, shieldTimer > 0);
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
    return true;
  };

  // ---------- 特效封装（统一交给 fx：零分配 / 单 draw call / 单 canvas 跳字） ----------
  const spawnParticles = (pos: THREE.Vector3, color: number, count: number, speed: number): void => {
    fx.emit(pos, color, count, speed);
  };
  /** 击杀冲击环（贴地扩散） */
  /** 击杀冲击环颜色跟随武器元素（物理金 / 烈焰橙 / 霜锋蓝 / 能量紫） */
  const elementBurstColor = (elem: Element): number => {
    if (elem === 'fire') return 0xff7a33;
    if (elem === 'ice') return 0x6fd8ff;
    if (elem === 'energy') return 0xb48cff;
    return 0xffd24a;
  };
  const addKillBurst = (pos: THREE.Vector3, color = 0xffd24a): void => {
    fx.burst(pos, color, 2.0);
  };
  const addDamagePopup = (worldPos: THREE.Vector3, text: string, color: string, size = 17, key = ''): void => {
    fx.popup(worldPos, text, color, size, key);
  };
  let dashCooldown = 0;
  /** 冲刺无敌帧（秒）：起手短暂免伤，给玩家主动躲招的空间 */
  let dashInvuln = 0;
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
      summonGroup = buildSummonMesh(role.color);
      summonGroup.position.copy(player.position).add(new THREE.Vector3(0, 0.2, 0));
      summonDmg = 12 * roleMult;
      summonTimer = role.duration * roleMult;
      world.scene.add(summonGroup);
    } else if (role.kind === 'inferno') {
      // 炼狱灼烧场（脚下环形）
      if (infernoMesh) world.scene.remove(infernoMesh);
      const ring = buildRoleRing(role.color, 0.2, 2.4);
      ring.position.copy(player.position).add(new THREE.Vector3(0, 0.05, 0));
      world.scene.add(ring);
      infernoMesh = ring;
      infernoDmg = 5 * roleMult;
      infernoTimer = role.duration * roleMult;
    } else if (role.kind === 'heal') {
      // 圣光治疗场（脚下绿环，5 秒回血）
      if (healMesh) world.scene.remove(healMesh);
      const ring = buildRoleRing(role.color, 0.2, 2.0);
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

  /** F 冲刺：步进碰撞 + 0.35s 无敌帧 + 残影（战斗循环与调试口共用） */
  function performDash(): void {
    dashCooldown = 4;
    dashStep(player, player.yaw, { arenaRadius: ARENA_RADIUS, terrainHeightAt });
    dashInvuln = 0.35;
    muzzleScratch.copy(player.position);
    muzzleScratch.y += 1.0;
    fx.emit(muzzleScratch, 0x9fc9e8, 6, 2.4, 0.9);
    tracer.fire(player.eye(), player.eye().clone().addScaledVector(fireCtx.direction, 3), 0x9fc9e8, 1.4);
  }

  /** 右键近战：前�?2.5m 扇形内命中首个敌�?BOSS */
  function meleeAttack(): void {
    if (meleeCooldown > 0) return;
    meleeCooldown = 0.55;
    const origin = fireCtx.origin;
    const dir = fireCtx.direction;
    // 近战直接走 takeDamage，不经过 onHitEnemy 的统一结算，角色攻击倍率要在这里显式乘上
    const meleeDamage = 30 * arsenal.current.growthDamage * computeStats().attackMult;
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
      if (dead) {
        creditWeaponKill();
        if (registerEnemyKill(e)) break;
      }
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
      fixedTicks += 1;
      // 局内拦截 Tab/空格/方向键默认行为；主菜单/选关/结算保留键盘焦点导航
      input.captureDefaultKeys = !inMenu;
      // hit-stop：冻结逻辑（渲染继续，画面整体停住），比慢动作更有顿挫
      if (hitStopT > 0) {
        hitStopT = Math.max(0, hitStopT - dt * (settings.lowMotion ? 2.5 : 1));
        return;
      }
      const snap = input.snapshot();
      // 设置面板由按钮/O 关闭后恢复鼠标锁定（菜单态下 lockMouse 自行 no-op）
      const settingsNowOpen = settingsPanel.visible();
      if (settingsWasOpen && !settingsNowOpen) lockMouse();
      settingsWasOpen = settingsNowOpen;

      // 暂停/菜单态（死亡/通关/主动暂停/设置面板/主菜单）：冻结玩家与战斗逻辑
      // （直接读面板可见性，关面板的两种方式都能正确恢复）
      if (paused || inMenu || settingsPanel.visible()) {
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
        // Esc 也能关商店：Tab 被浏览器/输入法抢走时仍有一个退出键
        if (shopOpen && snap.key('Escape') && !keyState.esc) {
          shopOpen = false;
          paused = false;
          shell.hideCombatShop();
          shell.hud.root.style.display = 'block';
          lockMouse();
          keyState.esc = true;
          keyState.shopTab = snap.key('Tab');
          return;
        }
        keyState.shopTab = snap.key('Tab');
        if (settingsPanel.visible() && snap.key('KeyO') && !keyState.settings) {
          settingsPanel.toggle();
          keyState.settings = true;
          return;
        }
        // 主菜单没有设置卡片，O 仍应能打开设置
        if (inMenu && !settingsPanel.visible() && snap.key('KeyO') && !keyState.settings) {
          unlockMouse();
          settingsPanel.toggle();
          keyState.settings = true;
          return;
        }
        keyState.settings = snap.key('KeyO');
        if (escPaused && snap.key('Escape') && !keyState.esc) {
          escPaused = false;
          paused = false;
          shell.hidePause();
          lockMouse();
        }
        if (snap.key('KeyR') && !keyState.restart && shell.resultVisible()) {
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
        drawRadar({
          radar,
          playerX: player.position.x,
          playerZ: player.position.z,
          yaw: player.yaw,
          enemies: spawner.all(),
          boss: activeBoss,
          crates,
          chests,
          orbs: buffOrbs,
          poisonPools: (mapRoot?.userData.poisonPools ?? []) as { x: number; z: number }[],
        });
      }

      fireCtx.origin.copy(eye);
      fireCtx.direction.set(0, 0, -1).applyQuaternion(world.camera.quaternion).normalize();

      arsenal.current.update(dt, fireCtx);

      if (snap.fire || benchFire) {
        arsenal.current.fire(fireCtx);
        if (snap.fire) viewmodel?.kickNow(0.6);
      } else {
        arsenal.current.releaseFire(fireCtx);
      }
      // O = 设置面板（打开时释放鼠标，关闭后由可见性变化重新锁定）
      if (snap.key('KeyO') && !keyState.settings) {
        unlockMouse();
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
      if (snap.skill && !keyState.skill) {
        arsenal.current.skill(fireCtx);
        applySpeedMult(); // 过载开关即时生效于移速
      }
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
        unlockMouse();
        shell.showPause({ level: runState.level, picks: runPickCount, preset: autoPickLabel() });
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
        unlockMouse();
        shell.currentWeaponId = arsenal.current.def.id;
        shell.showArmory();
      }
      keyState.bag = snap.key('KeyB');

      meleeCooldown = Math.max(0, meleeCooldown - dt);
      dashCooldown = Math.max(0, dashCooldown - dt);
      dashInvuln = Math.max(0, dashInvuln - dt);
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

      // F 冲刺：向面朝方向突进（步进碰撞，避免穿墙/穿平台）
      if (snap.key('KeyF') && !keyState.dash && dashCooldown <= 0) performDash();
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
      tickEnemies(crowd, dt, {
        nav,
        playerPos: player.position,
        stealth: stealthTimer > 0,
        all: () => spawner.all(),
        onKill: (e) => registerEnemyKill(e),
        sfx,
        shake: addShake,
        damagePlayer: applyDamageToPlayer,
        hudHit: () => shell.hud.hit(),
        spawnProjectile: (from, to, color, speed, damage) => projectiles.spawn(from, to, color, speed, damage),
        clipProjectile: (from, to) => clipToObstacles(from, to, nav.obstacles, terrainRay),
        popup: addDamagePopup,
      });

      // 移动物理：障碍推回 → 体积分离 → 玩家体积 → 再次障碍 → 贴地/下落
      resolveCrowdObstacles(crowd, enemyPhysicsCtx);
      const sep = { x: 0, z: 0 };
      // 两次松弛：密集怪群里单次分离会因相互抵消而残留重叠。
      // 空间哈希只检查同格/邻格，避免同屏 40+ 时的 O(n²) 两两扫描。
      separateCrowd(crowd, enemyHash, sep);
      settleCrowd(crowd, dt, enemyPhysicsCtx);

      // 状态特效：燃烧火花 / 减速蓝霜 / 晕眩星火（10Hz，避免粒子风暴）
      statusFxAcc -= dt;
      if (statusFxAcc <= 0) {
        statusFxAcc = 0.1;
        emitStatusFx(crowd, fx, centerScratch);
      }

      // 敌人弹丸推进与命中
      const projDmg = projectiles.update(dt, player.position, terrainHeightAt);
      if (projDmg > 0 && applyDamageToPlayer(projDmg, projectiles.lastHitSrc ?? undefined)) shell.hud.hit();

      // BOSS AI
      if (activeBoss && activeBoss.alive) {
        bossPhaseSeen = tickBoss(activeBoss, {
          nav,
          playerPos: player.position,
          dt,
          phaseSeen: bossPhaseSeen,
          terrainHeightAt,
          clampArena,
          resolveObstacles: resolveEnemyObstacles,
          damagePlayer: applyDamageToPlayer,
          hudHit: () => shell.hud.hit(),
          shake: addShake,
          roar: () => sfx.roar(),
          announce: showAnnouncement,
          hitStop: (t) => { hitStopT = Math.max(hitStopT, t); },
          flashWhite: () => showWhiteFlash(0.65, 420),
          burst: (pos, color, scale) => fx.burst(pos, color, scale),
          emit: (pos, color, count, speed, scale) => fx.emit(pos, color, count, speed, scale),
          summon: (count, x, z) => {
            spawner.spawnWave(
              { chasers: count, boomers: 0, spitters: 0 },
              { center: { x, z }, placeMin: 3.5, placeMax: 9 }
            );
            syncBossModel();
          },
          scratch: centerScratch,
        });
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
      tickOrbPickups({
        orbs: buffOrbs,
        scene: world.scene,
        playerPos: player.position,
        dt,
        time,
        canPickup: canPickupLoot,
        pick: pickOrb,
        onPickup: () => sfx.pickup(),
      });
      // 短期增益计时
      if (tickShortBuffs(shortBuffs, dt)) refreshGrowth(); // 到期恢复
      tickBarrels(dt); // 爆炸桶引信（直射 0.02s ≈ 即爆；链式 0.15s）

      // HUD 更新（帧数据由 play/hudFrame 组装）
      if (flow.phase === 'intro' || flow.phase === 'wave' || flow.phase === 'boss') {
        const g = inventory.getWeapon(arsenal.current.def.id);
        applyHudFrame(
          shell.hud,
          hudFrame({
            hp,
            maxHp,
            energy: arsenal.current.state.energy,
            maxEnergy: arsenal.current.def.energyMax,
            weaponName: arsenal.current.def.name,
            weaponLevel: g.level,
            weaponAsc: g.ascension,
            damageMult: arsenal.current.growthDamage,
            ammo: arsenal.current.state.ammo,
            mag: arsenal.current.magCap(),
            reloading: arsenal.current.state.reloading,
            phase: flow.phase,
            wave: flow.waveIndex,
            totalWaves: flow.mission.waves.length,
            tower: !!flow.mission.tower,
            missionName: flow.mission.name,
            autoPick: autoPickLabel(),
            monsterLevel: flow.monsterLevel,
            playerLevel: runState.level,
            runLevel: runState.level,
            runExp: runState.exp,
            boosts: runState.boosts,
            weaponLines: skillLinesFor(arsenal.current.def),
            roleName: findRole(selectedRoleId).name,
            roleCooldown,
            dashCooldown,
            shieldCooldown,
            shieldTimer,
            killStreak,
            slots: arsenal.defs.map((w) => ({ name: w.name, rarity: w.rarity })),
            slotIndex: arsenal.index,
          }),
          snap.fire,
          activeBoss && activeBoss.alive
            ? {
                name: activeBoss.spec.name,
                hp: activeBoss.hp,
                maxHp: activeBoss.maxHp,
                phase: activeBoss.phase,
                thresholds: activeBoss.spec.phaseThresholds ?? [],
              }
            : null
        );
      }

      hitFlash = Math.max(0, hitFlash - dt);
      hurtInvuln = Math.max(0, hurtInvuln - dt);
      // 毒池陷阱：玩家/敌人踩入持续掉毒伤
      const pools = (mapRoot?.userData.poisonPools ?? []) as PoisonPool[];
      if (pools.length > 0 && !inMenu && flow.phase !== 'clear' && flow.phase !== 'failed') {
        const hf = (mapRoot?.userData.heightfield as ((x: number, z: number) => number) | undefined) ?? (() => 0);
        for (const pool of pools) {
          const poolGround = hf(pool.x, pool.z);
          if (inPoisonPool(player.position, pool, poolGround)) {
            setHp(hp - POISON_DPS * dt);
            if (Math.random() < 0.08) spawnParticles(player.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x3a8a4a, 1, 0.5);
          }
          // 敌人同样受毒池影响
          for (const e of spawner.all()) {
            if (!e.alive) continue;
            if (!inPoisonPool(e.root.position, pool, poolGround)) continue;
            const dead = e.takeDamage(POISON_DPS * dt);
            if (dead && registerEnemyKill(e)) break;
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

  // 开发期调试钩子（正式发布前移除）：查询映射在 debug/queries，可变命令在 debug/commands
  const dbg = window as unknown as { __ss?: Record<string, unknown> };
  /** 调试查询依赖（只读）：交给 debug/queries 做映射，便于单测 */
  const queryDeps: QueryDeps = {
    enemies: () => spawner.all(),
    player,
    mapRoot: () => mapRoot,
    chests: () => chests,
    crates: () => crates,
    nav: () => nav,
  };
  /** 调试状态查询依赖：全部用 getter，保证读到的是实时值 */
  const stateDeps: StateDeps = {
    paused: () => paused,
    shopOpen: () => shopOpen,
    settingsVisible: () => settingsPanel.visible(),
    menu: () => inMenu,
    phase: () => flow.phase,
    wave: () => flow.waveIndex,
    enemiesRemaining: () => spawner.remaining(),
    ticks: () => fixedTicks,
    lockTries: () => pointerLockTries,
    unlockCalls: () => pointerUnlockCalls,
    pointerLocked: () => !!document.pointerLockElement,
    hp: () => Math.round(hp),
    maxHp: () => Math.round(maxHp),
    weapon: () => {
      const w = arsenal.current;
      const g = inventory.getWeapon(w.def.id);
      return {
        id: w.def.id,
        name: w.def.name,
        index: arsenal.index,
        count: arsenal.weapons.length,
        viewmodelId: viewmodelWeaponId,
        kills: g.kills,
        growthDamage: w.growthDamage,
        magMult: w.magMult,
        magCap: w.magCap(),
        ammo: w.state.ammo,
        energy: +w.state.energy.toFixed(1),
        overloaded: w.state.overloaded,
        charging: w.state.charging,
        chargeTime: +w.state.chargeTime.toFixed(3),
      };
    },
    shortBuffs: () => shortBuffs,
    buffs: () => buffs,
    shield: () => shieldTimer,
    shieldCooldown: () => shieldCooldown,
    fury: () => furyTimer,
    stealth: () => stealthTimer,
    roleCooldown: () => roleCooldown,
    meleeCooldown: () => meleeCooldown,
    dashCooldown: () => dashCooldown,
    summonActive: () => !!summonGroup,
    infernoActive: () => !!infernoMesh,
    healActive: () => !!healMesh,
    killStreak: () => killStreak,
    run: () => runState,
  };
  dbg.__ss = createDebugApi({
    world,
    spawner,
    nav,
    player,
    arsenal,
    inventory,
    shell,
    flow,
    settings,
    placementRng,
    fireCtx,
    queryDeps,
    stateDeps,
    dailyState,
    talentState,
    boss: () => activeBoss,
    run: () => runState,
    mapRoot: () => mapRoot,
    envRoot: () => envRoot,
    viewmodel: () => viewmodel,
    viewmodelWeaponId: () => viewmodelWeaponId,
    perfFps: () => perfFps,
    perfFrameMs: () => perfFrameMs,
    hp: () => hp,
    maxHp: () => maxHp,
    killStreak: () => killStreak,
    expBonus: () => bonuses.expBonus,
    lastHit: () => ({ ...lastHit }),
    hitStopT: () => hitStopT,
    barrels,
    crates,
    orbs: buffOrbs,
    setMissionIndex: (i) => {
      missionIndex = i;
    },
    setBenchFire: (v) => {
      benchFire = v;
    },
    setPaused: (v) => {
      paused = v;
    },
    setSelectedRoleId: (id) => {
      selectedRoleId = id;
    },
    setKillStreak: (v) => {
      killStreak = v;
    },
    setKillStreakTimer: (v) => {
      killStreakTimer = v;
    },
    setLastKills: (v) => {
      lastKills = v;
    },
    beginMission,
    syncBossModel,
    remountViewmodel: mountViewmodel,
    castSkill: () => {
      arsenal.current.skill(fireCtx);
      applySpeedMult(); // 过载开关即时生效于移速
    },
    releaseFire: () => {
      arsenal.current.releaseFire(fireCtx);
    },
    setHp,
    performDash,
    applyDamageToPlayer,
    refreshRun,
    onBossKilled,
    spawnBuffOrb,
    igniteBarrel,
    unlockMouse,
  });

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
