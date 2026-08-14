/**
 * shell — 界面层：主菜单 / 关卡选择 / HUD / 结算+强化。
 *
 * 通过回调与游戏核心交互；游戏逻辑不直接触碰 DOM。
 */
import { injectTheme } from './ui';
import { createHud } from './hud';
import type { HudView } from './hud';
export type { SkillLine } from './hud';
import { createMenuScreen, createSelectScreen, createResultScreen, createArmoryPanel, createPauseScreen, createArmoryScreen, createShopScreen, createTalentScreen, createForgeScreen, createRoleScreen, createAchievementScreen, createStatsScreen, createLevelUpScreen, createDailyScreen, createCombatShop, weaponOf } from './screens';
import type { AchievementState } from '../growth';
import { ROLES } from '../play/roles';
import type { TalentState } from '../growth';
import type { FlowResult } from '../campaign';
import type { Inventory } from '../growth';
export interface ShellCallbacks {
  onStartMission: (missionId: string) => void;
  onRestart: () => void;
  onResume?: () => void;
  onExitMission?: () => void;
  onOpenArmory?: () => void;
  onAddToLoadout?: (id: string) => void;
  onRemoveFromLoadout?: (id: string) => void;
  onBackArmory?: () => void;
  onOpenShop?: () => void;
  onBuy?: (itemId: string, qty: number) => void;
  onOpenTalent?: () => void;
  onUpgradeTalent?: (id: string) => void;
  onOpenForge?: () => void;
  onForgeUpgrade?: () => void;
  onOpenRole?: () => void;
  onSelectRole?: (id: string) => void;
  onUpgradeRole?: (id: string) => void;
  onOpenAchievement?: () => void;
  onOpenStats?: () => void;
  onStatsQuery?: () => { attackMult: number; critRate: number; critMult: number; armor: number; speedMult: number; energyRegen: number; maxHpBonus: number; fireRateMult: number };
  /** 升级选牌 */
  onPickBoost?: (id: string) => void;
  onSetDifficulty?: (d: number) => void;
  onOpenDaily?: () => void;
  onClaimDaily?: (id: string) => void;
  onCombatBuy?: (id: string) => void;
  onCombatClose?: () => void;
}

export class Shell {
  readonly hud: HudView;
  private menu: { screen: HTMLElement; addGridCard: (ico: string, name: string, desc: string, num: string, fn: () => void) => void };
  private select: HTMLElement;
  private pause: HTMLElement;
  private result: { screen: HTMLElement; show: (r: FlowResult, w: ReturnType<typeof weaponOf>) => void };
  private armory: { root: HTMLElement; refresh: (w: ReturnType<typeof weaponOf>) => void };
  private armoryScreen: { screen: HTMLElement; refresh: () => void };
  private shopScreen: { screen: HTMLElement; refresh: () => void };
  private talentScreen: { screen: HTMLElement; refresh: () => void };
  private forgeScreen: { screen: HTMLElement; refresh: () => void };
  private roleScreen: { screen: HTMLElement; refresh: (currentId: string) => void };
  private achScreen: { screen: HTMLElement; refresh: () => void };
  private statsScreen: { screen: HTMLElement; refresh: () => void };
  private levelUpScreen: { screen: HTMLElement; show: (level: number, choices: { id: string; name: string; desc: string }[]) => void };
  private dailyScreen: { screen: HTMLElement; refresh: () => void };
  private combatShop: { screen: HTMLElement; show: (gold: number) => void };
  /** 每日任务状态（共享引用） */
  dailyState: { date: string; progress: Record<string, number>; claimed: string[] } = { date: '', progress: {}, claimed: [] };
  achievementState: AchievementState = { counters: { kills: 0, clears: 0, upgrades: 0, ascensions: 0 }, claimed: [] };
  talentState: TalentState = { talents: {} };

  constructor(inventory: Inventory, cb: ShellCallbacks) {
    injectTheme();
    const back = (): void => {
      this.showMenu();
    };
    const callbacks = {
      onStartMission: (id: string) => cb.onStartMission(id),
      onRestart: () => cb.onRestart(),
      onSetDifficulty: (d: number) => cb.onSetDifficulty?.(d),
      onBackToMenu: back,
      onUpgrade: () => this.armory.refresh(weaponOf('pulse-rifle')),
      onAscend: () => this.armory.refresh(weaponOf('pulse-rifle')),
    };

    this.menu = createMenuScreen(callbacks);
    this.select = createSelectScreen(callbacks);
    this.result = createResultScreen(callbacks);
    this.armory = createArmoryPanel(inventory, callbacks);
    this.result.screen.querySelector('.ss-card')!.appendChild(this.armory.root);
    this.pause = createPauseScreen({
      onResume: () => cb.onResume?.(),
      onExit: () => cb.onExitMission?.(),
    });
    this.armoryScreen = createArmoryScreen(inventory, {
      onAddToLoadout: (id) => cb.onAddToLoadout?.(id),
      onRemoveFromLoadout: (id) => cb.onRemoveFromLoadout?.(id),
      onBack: () => cb.onBackArmory?.(),
    });
    this.shopScreen = createShopScreen(inventory, {
      onBuy: (itemId, qty) => cb.onBuy?.(itemId, qty),
      onBack: () => this.showMenu(),
    });
    this.talentScreen = createTalentScreen(inventory, this.talentState, {
      onUpgrade: (id) => cb.onUpgradeTalent?.(id),
      onBack: () => this.showMenu(),
    });
    this.forgeScreen = createForgeScreen(inventory, {
      onUpgrade: () => cb.onForgeUpgrade?.(),
      onBack: () => this.showMenu(),
    });
    this.roleScreen = createRoleScreen(inventory, {
      onSelectRole: (id) => cb.onSelectRole?.(id),
      onUpgradeRole: (id) => cb.onUpgradeRole?.(id),
      onBack: () => this.showMenu(),
    });
    this.achScreen = createAchievementScreen(this.achievementState, { onBack: () => this.showMenu() });
    this.statsScreen = createStatsScreen(inventory, {
      getStats: () => cb.onStatsQuery?.() ?? { attackMult: 1, critRate: 0.06, critMult: 1.6, armor: 0, speedMult: 1, energyRegen: 1, maxHpBonus: 0, fireRateMult: 1 },
      onBack: () => this.showMenu(),
    });
    this.levelUpScreen = createLevelUpScreen({ onPick: (id) => cb.onPickBoost?.(id) });
    this.dailyScreen = createDailyScreen(inventory, this.dailyState, {
      onClaim: (id) => cb.onClaimDaily?.(id),
      onBack: () => this.showMenu(),
    });
    this.combatShop = createCombatShop({
      onBuy: (id) => cb.onCombatBuy?.(id),
      onClose: () => cb.onCombatClose?.(),
    });

    this.hud = createHud();
    document.body.append(this.menu.screen, this.select, this.result.screen, this.pause, this.armoryScreen.screen, this.shopScreen.screen, this.talentScreen.screen, this.forgeScreen.screen, this.roleScreen.screen, this.achScreen.screen, this.statsScreen.screen, this.levelUpScreen.screen, this.dailyScreen.screen, this.combatShop.screen);
    // 主菜单系统网格（图标 · 名称 · 简述）
    const menuGrid = this.menu;
    const cards: [string, string, string, string, (() => void) | undefined][] = [
      ['◈', '每日任务', '击杀 · 通关 · 开箱', '00', cb.onOpenDaily ? () => cb.onOpenDaily?.() : undefined],
      ['▦', '仓库', '武器 · 材料 · 出战', '01', cb.onOpenArmory ? () => cb.onOpenArmory?.() : undefined],
      ['⚒', '强化', '同步 · 进阶 · 附魔', '02', cb.onOpenForge ? () => cb.onOpenForge?.() : undefined],
      ['▣', '商店', '免费补给领取', '03', cb.onOpenShop ? () => cb.onOpenShop?.() : undefined],
      ['✦', '天赋', '能力树加点', '04', cb.onOpenTalent ? () => cb.onOpenTalent?.() : undefined],
      ['◈', '角色', '战术专精选择', '05', cb.onOpenRole ? () => cb.onOpenRole?.() : undefined],
      ['◉', '属性', '四围 · 战力 · 消耗品', '06', cb.onOpenStats ? () => cb.onOpenStats?.() : undefined],
      ['☆', '成就', '战功记录', '07', cb.onOpenAchievement ? () => cb.onOpenAchievement?.() : undefined],
    ];
    for (const [ico, name, desc, num, fn] of cards) {
      if (fn) menuGrid.addGridCard(ico, name, desc, num, fn);
    }
  }

  currentWeaponId = 'pulse-rifle';
  currentRoleId = ROLES[0].id;

  showRole(): void {
    this.menu.screen.classList.add('hidden');
    this.roleScreen.refresh(this.currentRoleId);
    this.roleScreen.screen.classList.remove('hidden');
  }

  showAchievement(): void {
    this.menu.screen.classList.add('hidden');
    this.achScreen.refresh();
    this.achScreen.screen.classList.remove('hidden');
  }

  showStats(): void {
    this.menu.screen.classList.add('hidden');
    this.statsScreen.refresh();
    this.statsScreen.screen.classList.remove('hidden');
  }

  /** 升级选牌（战斗暂停态弹出） */
  showLevelUp(level: number, choices: { id: string; name: string; desc: string }[]): void {
    this.levelUpScreen.show(level, choices);
  }

  hideLevelUp(): void {
    this.levelUpScreen.screen.classList.add('hidden');
  }

  showDaily(): void {
    this.menu.screen.classList.add('hidden');
    this.dailyScreen.refresh();
    this.dailyScreen.screen.classList.remove('hidden');
  }

  hideDaily(): void {
    this.dailyScreen.screen.classList.add('hidden');
  }

  showCombatShop(gold: number): void {
    this.combatShop.show(gold);
  }

  hideCombatShop(): void {
    this.combatShop.screen.classList.add('hidden');
  }

  showForge(): void {
    this.menu.screen.classList.add('hidden');
    this.forgeScreen.refresh();
    this.forgeScreen.screen.classList.remove('hidden');
  }

  showShop(): void {
    this.menu.screen.classList.add('hidden');
    this.shopScreen.refresh();
    this.shopScreen.screen.classList.remove('hidden');
  }

  showTalent(): void {
    this.talentScreen.refresh();
    this.talentScreen.screen.classList.remove('hidden');
    this.menu.screen.classList.add('hidden');
  }

  showArmory(): void {
    this.menu.screen.classList.add('hidden');
    this.armoryScreen.refresh();
    this.armoryScreen.screen.classList.remove('hidden');
  }

  hideArmory(): void {
    this.armoryScreen.screen.classList.add('hidden');
  }

  showPause(): void {
    this.pause.classList.remove('hidden');
    this.hud.root.style.display = 'none';
  }

  hidePause(): void {
    this.pause.classList.add('hidden');
    this.hud.root.style.display = 'block';
  }

  showMenu(): void {
    this.menu.screen.classList.remove('hidden');
    this.select.classList.add('hidden');
    this.result.screen.classList.add('hidden');
    this.armoryScreen.screen.classList.add('hidden');
    this.shopScreen.screen.classList.add('hidden');
    this.talentScreen.screen.classList.add('hidden');
    this.forgeScreen.screen.classList.add('hidden');
    this.roleScreen.screen.classList.add('hidden');
    this.achScreen.screen.classList.add('hidden');
    this.statsScreen.screen.classList.add('hidden');
    this.levelUpScreen.screen.classList.add('hidden');
    this.dailyScreen.screen.classList.add('hidden');
    this.combatShop.screen.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.root.style.display = 'none';
  }

  showSelect(): void {
    this.menu.screen.classList.add('hidden');
    this.select.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.hud.root.style.display = 'none';
  }

  startGame(): void {
    this.menu.screen.classList.add('hidden');
    this.select.classList.add('hidden');
    this.result.screen.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.root.style.display = 'block';
  }

  showResult(result: FlowResult): void {
    this.result.show(result, weaponOf('pulse-rifle'));
    this.armory.refresh(weaponOf('pulse-rifle'));
  }
}
