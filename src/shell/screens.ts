/**
 * shell/screens — 各界面构建：主菜单 / 任务简报 / 暂停 / 结算 / 强化 / 商店 / 天赋 / 仓库 / 属性 / 角色 / 成就 / 升级选牌。
 *
 * 设计语言（用户覆盖默认风格）：暗色战术作战终端
 *   - 深墨底、纸白文字、细线、直角、靛蓝高光、等宽数据、衬线标题
 *   - 拒绝：紫色渐变、圆角卡片堆砌、玻璃拟态、发光 blob
 */
import { el, button } from './ui';
import { MISSIONS } from '../campaign';
import { ARSENAL } from '../arsenal';
import type { WeaponDef } from '../arsenal';
import type { Inventory } from '../growth';
import { genDailyTasks, damageMultiplier, mechMultiplier, MAX_ASCENSION, MAX_RUNE, MAX_ENCHANT, MAX_PINNACLE, ENCHANT_SPD_STEP, PINNACLE_DMG_STEP, PINNACLE_HP_STEP, tryAscend, tryRuneUpgrade, tryUpgrade, tryUpgradeN, tryUpgradeMax, tryEnchant, tryEnchantN, tryPinnacle, tryPinnacleN, critFromGrowth, affixSlots, AFFIX_POOL, ascensionEffectsFor, TALENT_NODES, talentLevel, ACHIEVEMENTS, fourStats, powerScore } from '../growth';
import type { AchievementDef } from '../growth';
import { ROLES } from '../play/roles';
import type { FlowResult } from '../campaign';

export interface ScreenCallbacks {
  onStartMission: (missionId: string) => void;
  onRestart: () => void;
  onBackToMenu: () => void;
  onUpgrade: () => void;
  onAscend: () => void;
  onSetDifficulty?: (difficulty: number) => void;
}

/** 武器机制中文名 */
export function mechLabel(d: WeaponDef): string {
  switch (d.mech.kind) {
    case 'energy': return '能量爆发';
    case 'overload': return '过载形态';
    case 'lockon': return '电弧索敌';
    case 'slow': return '霜缓控制';
    case 'charge': return '蓄力射击';
    case 'beam': return '持续射线';
    case 'chain': return '连锁闪电';
    case 'guard': return '治疗光环';
    case 'burst': return '三连发';
    case 'pierce': return '穿透射击';
    default: return '标准射击';
  }
}

export function createMenuScreen(cb: ScreenCallbacks): { screen: HTMLElement; addGridCard: (ico: string, name: string, desc: string, num: string, fn: () => void) => void } {
  const screen = el('div', 'ss-screen');
  // 标题区
  const head = el('div', '', '');
  head.style.cssText = 'text-align:center;margin-bottom:30px;';
  const kicker = el('div', '', 'ADVENTURE OPS · PVE');
  kicker.style.cssText = 'font-family:var(--mono);font-size:11px;letter-spacing:0.42em;color:var(--ink-faint);margin-bottom:10px;';
  kicker.style.setProperty('font-family', 'var(--mono)');
  head.appendChild(kicker);
  const title = el('div', '', 'ECLIPSE 荒原防线');
  title.style.cssText = 'font-family:var(--serif);font-size:34px;font-weight:800;letter-spacing:0.26em;color:var(--ink);';
  head.appendChild(title);
  const sub = el('div', '', '冒险作战终端 · 内部代号');
  sub.style.cssText = 'font-size:12px;letter-spacing:0.24em;color:var(--ink-dim);margin-top:10px;padding-bottom:18px;border-bottom:1px solid var(--line);';
  screen.appendChild(head);

  const grid = el('div', 'tw-grid', '');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(150px,190px));gap:12px;width:min(880px,94vw);';
  // 主卡：开始任务
  const main = el('div', '', '');
  main.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px 24px;cursor:pointer;' +
    'border:1px solid var(--ink);background:linear-gradient(180deg,#1c2230,#141821 60%);position:relative;overflow:hidden;';
  const bar = el('div', '', '');
  bar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cinnabar),transparent 60%);';
  main.appendChild(bar);
  const mainTxt = el('div', '', '');
  const mn = el('div', '', '开始任务');
  mn.style.cssText = 'font-family:var(--serif);font-size:20px;font-weight:700;letter-spacing:0.18em;color:var(--ink);';
  mainTxt.appendChild(mn);
  const md = el('div', '', '进入任务简报 · 选择关卡或挑战试炼之塔');
  md.style.cssText = 'font-size:12px;color:var(--ink-dim);margin-top:6px;letter-spacing:0.05em;';
  mainTxt.appendChild(md);
  main.appendChild(mainTxt);
  const go = button('primary', '出击', () => cb.onStartMission(''));
  go.style.cssText = 'background:var(--cinnabar);color:#0d1016;border:1px solid var(--cinnabar);padding:10px 30px;font-weight:600;letter-spacing:0.2em;';
  main.appendChild(go);
  main.addEventListener('click', (e) => { if ((e.target as HTMLElement).tagName !== 'BUTTON') cb.onStartMission(''); });
  grid.appendChild(main);
  screen.appendChild(grid);
  const tip = el('div', '', 'WASD 移动 · 鼠标瞄准 · 左键射击 · 右键近战 · E 武器技能 · R 换弹 · B 背包 · Esc 暂停');
  tip.style.cssText = 'margin-top:22px;color:var(--ink-faint);font-size:11px;letter-spacing:0.12em;font-family:var(--mono);';
  screen.appendChild(tip);

  const addGridCard = (ico: string, name: string, desc: string, num: string, fn: () => void): void => {
    const c = el('div', '', '');
    c.style.cssText = 'position:relative;cursor:pointer;user-select:none;padding:18px 16px 16px;overflow:hidden;' +
      'background:linear-gradient(180deg,var(--panel-2),var(--panel) 50%);border:1px solid var(--line);' +
      'transition:border-color .14s,transform .06s,background .14s;';
    const hl = el('div', '', '');
    hl.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--indigo),transparent 65%);opacity:0.45;';
    c.appendChild(hl);
    c.innerHTML += `<div style="position:absolute;top:10px;right:12px;font-family:var(--mono);font-size:11px;color:var(--ink-faint)">${num}</div>`;
    const ic = el('div', '', ico);
    ic.style.cssText = 'font-size:22px;color:var(--indigo-soft);margin-bottom:8px;';
    c.appendChild(ic);
    const nm = el('div', '', name);
    nm.style.cssText = 'font-size:14px;letter-spacing:0.16em;color:var(--ink);font-family:var(--serif);font-weight:700;';
    c.appendChild(nm);
    const dc = el('div', '', desc);
    dc.style.cssText = 'font-size:11px;color:var(--ink-faint);margin-top:4px;letter-spacing:0.05em;';
    c.appendChild(dc);
    c.addEventListener('mouseenter', () => { c.style.borderColor = 'var(--ink)'; c.style.background = 'var(--panel-3)'; hl.style.opacity = '1'; });
    c.addEventListener('mouseleave', () => { c.style.borderColor = 'var(--line)'; c.style.background = 'linear-gradient(180deg,var(--panel-2),var(--panel) 50%)'; hl.style.opacity = '0.45'; });
    c.addEventListener('click', fn);
    grid.appendChild(c);
  };
  return { screen, addGridCard };
}

export function createSelectScreen(cb: ScreenCallbacks): HTMLElement {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '任务简报'));
  screen.appendChild(el('div', 'ss-subtitle', '选择出击任务'));
  // 难度选择
  const diffRow = el('div', 'ss-diff-row', '');
  diffRow.appendChild(el('span', '', '难度：'));
  const DIFFS: { d: number; label: string; hint: string }[] = [
    { d: 1, label: '普通', hint: '敌人 ×1 · 奖励 ×1' },
    { d: 1.5, label: '困难', hint: '敌人 ×1.5 · 奖励 ×1.8' },
    { d: 2.2, label: '噩梦', hint: '敌人 ×2.2 · 奖励 ×3' },
  ];
  let curDiff = 1;
  const btns: HTMLElement[] = [];
  const hintEl = el('div', '', DIFFS[0].hint);
  hintEl.style.cssText = 'font-size:11px;color:var(--ink-faint);font-family:var(--mono);';
  for (const df of DIFFS) {
    const b = el('div', 'ss-diff-item' + (df.d === curDiff ? ' active' : ''), df.label);
    b.title = df.hint;
    b.addEventListener('click', () => {
      curDiff = df.d;
      cb.onSetDifficulty?.(df.d);
      for (const x of btns) x.classList.remove('active');
      b.classList.add('active');
      hintEl.textContent = df.hint;
    });
    btns.push(b);
    diffRow.appendChild(b);
  }
  diffRow.appendChild(hintEl);
  screen.appendChild(diffRow);
  const brief = el('div', 'ss-brief', '');
  MISSIONS.forEach((m, i) => {
    const row = el('div', 'ss-brief-row');
    row.appendChild(el('div', 'ss-brief-num', String(i + 1).padStart(2, '0')));
    const info = el('div', '', '');
    info.appendChild(el('div', 'ss-brief-name', m.name + (m.tower ? '（无尽）' : '')));
    info.appendChild(el('div', 'ss-brief-meta', m.tower
      ? `无限层 · 每 5 层 BOSS · 敌人逐层强化 · 精英词缀`
      : `波次 ${m.waves.length} · BOSS ${m.boss ? m.boss.name : '无'} · 奖励 ${m.rewards.material}×${m.rewards.amount}`));
    row.appendChild(info);
    row.appendChild(el('div', 'ss-brief-cta', m.tower ? '挑战' : '出击'));
    row.addEventListener('click', () => cb.onStartMission(m.id));
    brief.appendChild(row);
  });
  screen.appendChild(brief);
  screen.appendChild(button('', '返回', () => cb.onBackToMenu()));
  return screen;
}

export function createPauseScreen(cb: { onResume: () => void; onExit: () => void }): HTMLElement {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '暂停'));
  screen.appendChild(el('div', 'ss-subtitle', '作战中断'));
  screen.appendChild(button('primary', '继续作战', () => cb.onResume()));
  screen.appendChild(button('', '返回任务简报', () => cb.onExit()));
  return screen;
}

export function createRoleScreen(
  inventory: Inventory,
  cb: { onSelectRole: (id: string) => void; onUpgradeRole: (id: string) => void; onBack: () => void }
): { screen: HTMLElement; refresh: (currentId: string) => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '角色'));
  screen.appendChild(el('div', 'ss-subtitle', 'X 键释放角色大招 · 强化提升技能效果'));
  const list = el('div', 'ss-brief', '');
  screen.appendChild(list);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const refresh = (currentId: string): void => {
    list.innerHTML = '';
    for (const r of ROLES) {
      const lvl = inventory.roleLevel(r.id);
      const cost = 6 + lvl * 4;
      const row = el('div', 'ss-brief-row');
      const info = el('div', '', '');
      info.appendChild(el('div', 'ss-brief-name', `${r.name} Lv.${lvl}/5${r.id === currentId ? '（当前）' : ''}`));
      info.appendChild(el('div', 'ss-brief-meta', `${r.desc} · 技能效果 +${lvl * 15}%`));
      row.appendChild(info);
      const act = el('div', '', '');
      act.style.cssText = 'display:flex;gap:8px;align-items:center;';
      const sel = el('div', 'ss-brief-cta', r.id === currentId ? '已装备' : '选择');
      sel.addEventListener('click', () => cb.onSelectRole(r.id));
      act.appendChild(sel);
      if (lvl < 5) {
        const up = el('div', '', `强化 Lv.${lvl}→${lvl + 1}（核心×${cost}）`);
        up.style.cssText = 'cursor:pointer;font-size:12px;padding:6px 14px;border:1px solid var(--amber);color:var(--amber-soft);white-space:nowrap;letter-spacing:0.08em;';
        if (inventory.material('核心晶体') < cost) {
          up.style.opacity = '0.4';
          up.style.cursor = 'not-allowed';
          up.title = '核心晶体不足';
        } else {
          up.addEventListener('click', () => {
            cb.onUpgradeRole(r.id);
            refresh(currentId);
          });
        }
        act.appendChild(up);
      }
      row.appendChild(act);
      list.appendChild(row);
    }
  };
  return { screen, refresh };
}

export function createAchievementScreen(
  state: { counters: Record<string, number>; claimed: string[] },
  cb: { onBack: () => void }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '成就'));
  screen.appendChild(el('div', 'ss-subtitle', '击杀 · 通关 · 锻造'));
  const card = el('div', 'ss-card', '');
  card.style.minWidth = '560px';
  const list = el('div', '', '');
  card.appendChild(list);
  screen.appendChild(card);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const refresh = (): void => {
    list.innerHTML = '';
    for (const a of ACHIEVEMENTS as AchievementDef[]) {
      const cur = state.counters[a.id] ?? 0;
      const done = cur >= a.target;
      const row = el('div', 'ss-brief-row');
      row.style.gridTemplateColumns = '1fr auto';
      const info = el('div', '', '');
      info.appendChild(el('div', 'ss-brief-name', `${done ? '✓ ' : ''}${a.name}`));
      info.appendChild(el('div', 'ss-brief-meta', `${a.desc}（${Math.min(cur, a.target)}/${a.target}）${done ? ' · 已领取' : ''}`));
      row.appendChild(info);
      const claimed = state.claimed.includes(a.id);
      const cta = el('div', 'ss-brief-cta', done ? (claimed ? '已领' : '领取') : '进行中');
      if (done && !claimed) {
        cta.addEventListener('click', () => {
          state.claimed.push(a.id);
          refresh();
        });
      } else {
        cta.style.color = 'var(--ink-faint)';
        cta.style.borderColor = 'var(--line)';
      }
      row.appendChild(cta);
      list.appendChild(row);
    }
  };
  return { screen, refresh };
}

export function createForgeScreen(
  inventory: Inventory,
  cb: { onUpgrade: () => void; onBack: () => void }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '强化'));
  screen.appendChild(el('div', 'ss-subtitle', '装备同步 · 进阶 · 符文 · 附魔 · 巅峰'));

  const infoBar = el('div', '', '');
  infoBar.style.cssText = 'display:flex;gap:22px;width:min(94vw,820px);margin-bottom:16px;background:var(--panel);border:1px solid var(--line);padding:10px 18px;font-size:13px;';
  infoBar.innerHTML =
    `<span style="color:var(--ink-dim)">合金碎片</span><b id="fg-a">0</b>` +
    `<span style="color:var(--ink-dim)">核心晶体</span><b id="fg-b">0</b>` +
    `<span style="color:var(--ink-dim)">金币</span><b id="fg-c">0</b>`;
  screen.appendChild(infoBar);

  const cols = el('div', '', '');
  cols.style.cssText = 'display:flex;gap:16px;align-items:flex-start;width:min(94vw,820px);';
  const list = el('div', 'ss-card', '');
  list.style.cssText = 'flex:0 0 280px;min-width:0;padding:18px 20px;max-height:64vh;overflow-y:auto;';
  const panel = el('div', 'ss-card', '');
  panel.style.cssText = 'flex:1;min-width:0;padding:18px 20px;';
  cols.appendChild(list);
  cols.appendChild(panel);
  screen.appendChild(cols);

  const backBtn = button('', '返回', () => cb.onBack());
  backBtn.style.cssText = 'position:sticky;bottom:14px;margin-top:18px;';
  screen.appendChild(backBtn);

  let selectedId = inventory.loadout[0] ?? ARSENAL[0].id;

  const refresh = (): void => {
    (screen.querySelector('#fg-a') as HTMLElement).textContent = String(inventory.material('合金碎片'));
    (screen.querySelector('#fg-b') as HTMLElement).textContent = String(inventory.material('核心晶体'));
    (screen.querySelector('#fg-c') as HTMLElement).textContent = String(inventory.gold);

    // 武器列表
    list.innerHTML = '<h3 style="margin-bottom:12px">选择武器</h3>';
    for (const d of ARSENAL) {
      const row = el('div', '', '');
      const active = d.id === selectedId;
      row.style.cssText =
        'display:flex;align-items:center;padding:8px 12px;margin-bottom:6px;cursor:pointer;' +
        'border:1px solid ' + (active ? 'var(--ink)' : 'var(--line)') + ';background:' + (active ? 'var(--panel-3)' : 'var(--panel)') + ';';
      const g = inventory.getWeapon(d.id);
      row.innerHTML = `<div style="flex:1"><div style="color:var(--ink);font-size:13.5px;font-family:var(--serif)">${d.name}</div>
        <div style="color:var(--ink-faint);font-size:11px;margin-top:3px;font-family:var(--mono)">Lv.${g.level} 阶${g.ascension} 符文${g.rune}</div></div>`;
      row.addEventListener('click', () => {
        selectedId = d.id;
        refresh();
      });
      list.appendChild(row);
    }

    // 养成面板（模块化：同步/进阶/符文/附魔/巅峰）
    const d = ARSENAL.find((x) => x.id === selectedId) ?? ARSENAL[0];
    const g = inventory.getWeapon(d.id);
    const eff = ascensionEffectsFor(d.mech.kind, g.ascension);
    const dmgPct = Math.round((damageMultiplier(d, inventory) - 1) * 100);
    const critPct = Math.round(critFromGrowth(g) * 100);
    const spdPct = Math.round(g.enchant * ENCHANT_SPD_STEP * 100);
    const hpBonus = g.pinnacle * PINNACLE_HP_STEP;
    const mk = (label: string, disabled: boolean, fn: () => void): HTMLButtonElement => {
      const b = button('', label, fn);
      b.disabled = disabled;
      return b;
    };
    const run = (fn: () => void): void => {
      fn();
      cb.onUpgrade();
      refresh();
    };
    const upCost = (g.level + 1) * 2;
    const asCost = 5 + g.ascension * 5;
    const runeCost = 3 + g.rune * 2;
    const enCost = 4 + g.enchant * 2;
    const piCostM = 6 + g.pinnacle * 3;
    const piCostG = 40 + g.pinnacle * 20;

    const module = (title: string, value: string, btnHtml: HTMLElement): HTMLElement => {
      const m = el('div', 'fg-module', '');
      const t = el('div', 'fg-module-title', '');
      t.innerHTML = `<b>${title}</b><span>${value}</span>`;
      m.appendChild(t);
      m.appendChild(btnHtml);
      return m;
    };
    const btnRow = (btns: HTMLButtonElement[]): HTMLElement => {
      const row = el('div', 'fg-btns', '');
      for (const b of btns) row.appendChild(b);
      return row;
    };

    panel.innerHTML = `
      <h3 style="margin-bottom:14px">${d.name} <span style="color:var(--ink-dim);font-size:12px;font-family:var(--mono)">${mechLabel(d)}</span></h3>
      <div class="row"><span>总伤害加成</span><b>+${dmgPct}%</b></div>
      <div class="row"><span>机制加成</span><b>+${Math.round((mechMultiplier(d, inventory) - 1) * 100)}%</b></div>
      <div class="row"><span>词缀暴击</span><b>+${critPct}%</b></div>
    `;
    const body = el('div', '', '');
    body.appendChild(module(
      '同步强化',
      `Lv.${g.level} · 每级 +5% 伤害`,
      btnRow([
        mk(`+1（合金×${upCost}）`, inventory.material('合金碎片') < upCost, () => run(() => tryUpgrade(d, inventory))),
        mk('+5', inventory.material('合金碎片') < upCost * 5, () => run(() => tryUpgradeN(d, inventory, 5))),
        mk('+10', inventory.material('合金碎片') < upCost * 10, () => run(() => tryUpgradeN(d, inventory, 10))),
        mk('拉满', false, () => run(() => tryUpgradeMax(d, inventory))),
      ])
    ));
    body.appendChild(module(
      '进阶',
      `阶${g.ascension} / ${MAX_ASCENSION} · 机制强化 + 配件`,
      btnRow([
        mk(`进阶（核心×${asCost}）`, inventory.material('核心晶体') < asCost || g.ascension >= MAX_ASCENSION, () => run(() => tryAscend(d, inventory))),
      ])
    ));
    body.appendChild(module(
      '符文',
      `Lv.${g.rune} / ${MAX_RUNE} · 每级 +2% · 每 2 级解锁词缀`,
      btnRow([
        mk(`+1（核心×${runeCost}）`, inventory.material('核心晶体') < runeCost || g.rune >= MAX_RUNE, () => run(() => tryRuneUpgrade(d, inventory))),
        mk('+5', g.rune >= MAX_RUNE, () => run(() => { for (let i = 0; i < 5; i++) if (!tryRuneUpgrade(d, inventory)) break; })),
      ])
    ));
    body.appendChild(module(
      '附魔',
      `Lv.${g.enchant} / ${MAX_ENCHANT} · 暴击 +${critPct}% · 攻速 +${spdPct}%`,
      btnRow([
        mk(`+1（核心×${enCost}）`, inventory.material('核心晶体') < enCost || g.enchant >= MAX_ENCHANT, () => run(() => tryEnchant(d, inventory))),
        mk('+5', g.enchant >= MAX_ENCHANT, () => run(() => tryEnchantN(d, inventory, 5))),
        mk('拉满', g.enchant >= MAX_ENCHANT, () => run(() => tryEnchantN(d, inventory, 1e9))),
      ])
    ));
    body.appendChild(module(
      '巅峰突破',
      `Lv.${g.pinnacle} / ${MAX_PINNACLE} · 伤害 +${Math.round(g.pinnacle * PINNACLE_DMG_STEP * 100)}% · 生命 +${hpBonus}`,
      btnRow([
        mk(`突破（合金×${piCostM} 金币×${piCostG}）`, inventory.material('合金碎片') < piCostM || inventory.gold < piCostG || g.pinnacle >= MAX_PINNACLE, () => run(() => tryPinnacle(d, inventory))),
        mk('+5', g.pinnacle >= MAX_PINNACLE, () => run(() => tryPinnacleN(d, inventory, 5))),
        mk('拉满', g.pinnacle >= MAX_PINNACLE, () => run(() => tryPinnacleN(d, inventory, 1e9))),
      ])
    ));
    panel.appendChild(body);
    // 配件改装 + 符文词缀详情
    const extra = el('div', '', '');
    extra.style.cssText = 'margin-top:6px;font-size:12px;color:var(--ink-faint);line-height:1.9;';
    extra.innerHTML = `<div style="font-family:var(--mono);letter-spacing:0.2em;color:var(--ink-dim);margin-bottom:4px">配件改装（阶${g.ascension}）</div>
      ${eff.unlocked.length ? eff.unlocked.map((e, i) => `<div style="color:var(--ok)">阶${i + 1} · ${e}</div>`).join('') : '<div>尚未解锁（进阶后生效）</div>'}
      ${eff.next ? `<div style="color:var(--cinnabar-soft)">下一阶 · ${eff.next}</div>` : ''}
      <div style="font-family:var(--mono);letter-spacing:0.2em;color:var(--ink-dim);margin:10px 0 4px">符文词缀（${g.affixes.length} / ${affixSlots(MAX_RUNE)}）</div>
      ${g.affixes.length === 0 ? '<div>符文升到 2/4/6/8/10 级解锁词缀</div>' : g.affixes.map((a) => {
        const t = AFFIX_POOL.find((p) => p.kind === a.kind);
        return `<div style="color:var(--amber-soft)">${t ? t.name : a.kind} · ${t ? t.desc : ''}${Math.round(a.value * 100)}%</div>`;
      }).join('')}`;
    panel.appendChild(extra);
  };

  return { screen, refresh };
}

export function createShopScreen(
  inventory: Inventory,
  cb: { onBuy: (itemId: string, qty: number) => void; onBack: () => void }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '商店'));
  screen.appendChild(el('div', 'ss-subtitle', '补给领取（免费）'));
  const card = el('div', 'ss-card', '');
  card.style.minWidth = '560px';
  const goldLine = el('div', 'row', '');
  card.appendChild(goldLine);
  const list = el('div', '', '');
  card.appendChild(list);
  screen.appendChild(card);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const GOODS: { id: string; name: string; desc: string }[] = [
    { id: 'alloy', name: '合金碎片', desc: '武器同步材料' },
    { id: 'core', name: '核心晶体', desc: '武器进阶/符文材料' },
    { id: 'medkit', name: '治疗针', desc: '战斗中按 7 使用，回复 40 生命' },
    { id: 'atk', name: '攻击药水', desc: '战斗中按 8 使用，攻击力 +25%（20s）' },
    { id: 'shield', name: '护盾药剂', desc: '战斗中按 9 使用，减伤 +35%（10s）' },
    { id: 'speed', name: '加速药水', desc: '战斗中按 0 使用，移速 +30%（12s）' },
  ];
  const qty: Record<string, number> = { alloy: 1, core: 1, medkit: 1, atk: 1, shield: 1, speed: 1 };

  const refresh = (): void => {
    goldLine.innerHTML = `<span>金币</span><b>${inventory.gold}</b>`;
    list.innerHTML = '';
    for (const g of GOODS) {
      const row = el('div', 'ss-brief-row');
      row.style.gridTemplateColumns = '1fr auto auto';
      const info = el('div', '', '');
      info.appendChild(el('div', 'ss-brief-name', `${g.name}（免费）`));
      info.appendChild(el('div', 'ss-brief-meta', g.desc));
      row.appendChild(info);
      // 数量选择（− / 输入框 / +，单次无上限）
      const stepper = el('div', '', '');
      stepper.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const dec = el('div', '', '−');
      const num = el('input', '', '');
      (num as HTMLInputElement).type = 'number';
      (num as HTMLInputElement).value = String(qty[g.id]);
      (num as HTMLInputElement).min = '1';
      num.style.cssText = 'width:64px;text-align:center;background:var(--bg-deep);border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:13px;padding:5px 4px;';
      const inc = el('div', '', '+');
      for (const [node, delta] of [[dec, -1], [inc, 1]] as const) {
        node.style.cssText = 'cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);font-size:15px;user-select:none;';
        node.addEventListener('click', () => {
          qty[g.id] = Math.max(1, qty[g.id] + delta);
          (num as HTMLInputElement).value = String(qty[g.id]);
        });
      }
      num.addEventListener('change', () => {
        const v = parseInt((num as HTMLInputElement).value, 10);
        qty[g.id] = Number.isFinite(v) && v > 0 ? v : 1;
      });
      stepper.append(dec, num, inc);
      row.appendChild(stepper);
      const buy = el('div', '', '领取');
      buy.style.cssText = 'cursor:pointer;font-size:12px;padding:5px 16px;border:1px solid var(--cinnabar);color:var(--cinnabar-soft);white-space:nowrap;letter-spacing:0.16em;';
      buy.addEventListener('click', () => cb.onBuy(g.id, qty[g.id]));
      row.appendChild(buy);
      list.appendChild(row);
    }
  };
  return { screen, refresh };
}

export function createTalentScreen(
  inventory: Inventory,
  talentState: { talents: Record<string, number> },
  cb: { onUpgrade: (id: string) => void; onBack: () => void }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '天赋'));
  screen.appendChild(el('div', 'ss-subtitle', '击杀与通关获取天赋点'));
  const card = el('div', 'ss-card', '');
  card.style.minWidth = '520px';
  const pts = el('div', 'row', '');
  card.appendChild(pts);
  const list = el('div', '', '');
  card.appendChild(list);
  screen.appendChild(card);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const refresh = (): void => {
    pts.innerHTML = `<span>可用天赋点</span><b>${inventory.talentPoints}</b>`;
    list.innerHTML = '';
    for (const node of TALENT_NODES) {
      const lvl = talentLevel(talentState, node.id);
      const row = el('div', 'ss-brief-row');
      row.style.gridTemplateColumns = '1fr auto';
      const info = el('div', '', '');
      info.appendChild(el('div', 'ss-brief-name', `${node.name} Lv.${lvl}/${node.maxLevel}`));
      info.appendChild(el('div', 'ss-brief-meta', node.desc(lvl)));
      row.appendChild(info);
      const cta = el('div', 'ss-brief-cta', lvl >= node.maxLevel ? '已满' : '升级');
      if (lvl < node.maxLevel) {
        if (inventory.talentPoints <= 0) {
          cta.style.color = 'var(--ink-faint)';
          cta.style.borderColor = 'var(--line)';
          cta.title = '天赋点不足（击杀 15 个敌人或通关获取）';
        } else {
          cta.addEventListener('click', () => {
            cb.onUpgrade(node.id);
            refresh();
          });
        }
      } else {
        cta.style.color = 'var(--ink-dim)';
        cta.style.borderColor = 'var(--line)';
      }
      row.appendChild(cta);
      list.appendChild(row);
    }
  };
  return { screen, refresh };
}

/** 仓库界面：信息条 + 出战背包（左）+ 武器池（右） */
export function createArmoryScreen(
  inventory: Inventory,
  cb: {
    onAddToLoadout: (id: string) => void;
    onRemoveFromLoadout: (id: string) => void;
    onBack: () => void;
  }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '仓库'));
  screen.appendChild(el('div', 'ss-subtitle', '材料 · 出战配置'));

  // 顶部信息条（一行）
  const infoBar = el('div', '', '');
  infoBar.style.cssText =
    'display:flex;gap:18px;width:min(94vw,900px);margin-bottom:16px;' +
    'background:var(--panel);border:1px solid var(--line);padding:10px 18px;font-size:13px;';
  const infoCells = (label: string, value: () => string): HTMLElement => {
    const cell = el('div', '', '');
    cell.style.cssText = 'display:flex;gap:8px;align-items:center;';
    cell.innerHTML = `<span style="color:var(--ink-dim)">${label}</span><b id="arm-info-${label}">${value()}</b>`;
    return cell;
  };
  infoBar.append(
    infoCells('合金碎片', () => String(inventory.material('合金碎片'))),
    infoCells('核心晶体', () => String(inventory.material('核心晶体'))),
    infoCells('金币', () => String(inventory.gold)),
    infoCells('天赋点', () => String(inventory.talentPoints))
  );
  screen.appendChild(infoBar);

  // 两列主体
  const cols = el('div', '', '');
  cols.style.cssText = 'display:flex;gap:16px;align-items:flex-start;width:min(94vw,900px);';

  const loadout = el('div', 'ss-card', '');
  loadout.style.cssText = 'flex:0 0 320px;min-width:0;padding:18px 20px;';
  const pool = el('div', 'ss-card', '');
  pool.style.cssText = 'flex:1;min-width:0;padding:18px 20px;';

  const refresh = (): void => {
    for (const elNode of infoBar.querySelectorAll('b')) {
      const label = elNode.id.replace('arm-info-', '');
      if (label === '合金碎片') elNode.textContent = String(inventory.material('合金碎片'));
      if (label === '核心晶体') elNode.textContent = String(inventory.material('核心晶体'));
      if (label === '金币') elNode.textContent = String(inventory.gold);
      if (label === '天赋点') elNode.textContent = String(inventory.talentPoints);
    }

    const ids = inventory.loadout;
    loadout.innerHTML = '<h3 style="margin-bottom:12px">出战背包（5）</h3>';
    for (let i = 0; i < 5; i++) {
      const id = ids[i];
      const row = el('div', '', '');
      row.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;' +
        'border:1px solid var(--line);background:var(--panel);';
      row.innerHTML = `<span style="color:var(--line);width:22px;text-align:center;font-family:var(--mono)">${i + 1}</span>`;
      if (id) {
        const d = ARSENAL.find((x) => x.id === id);
        const name = el('div', '', d ? d.name : id);
        name.style.cssText = 'flex:1;color:var(--ink);font-size:13.5px;letter-spacing:0.08em;';
        row.appendChild(name);
        const rm = el('div', '', '移除');
        rm.style.cssText = 'cursor:pointer;color:var(--ink-dim);border:1px solid var(--line);padding:3px 10px;font-size:11.5px;';
        rm.addEventListener('click', () => {
          cb.onRemoveFromLoadout(id);
          refresh();
        });
        row.appendChild(rm);
      } else {
        row.appendChild(el('div', '', '空'));
      }
      loadout.appendChild(row);
    }

    pool.innerHTML = '<h3 style="margin-bottom:12px">武器池</h3>';
    for (const d of ARSENAL) {
      const inLoadout = ids.includes(d.id);
      const row = el('div', '', '');
      row.style.cssText =
        'display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:6px;' +
        'border:1px solid var(--line);background:var(--panel);';
      const info = el('div', '', '');
      info.style.cssText = 'flex:1;min-width:0;';
      const g = inventory.getWeapon(d.id);
      const nameEl = el('div', '', `${d.name}${inLoadout ? '（在背包）' : ''}`);
      nameEl.style.cssText = 'color:var(--ink);font-size:13.5px;letter-spacing:0.06em;font-family:var(--serif);';
      info.appendChild(nameEl);
      const meta = el('div', '', `Lv.${g.level} 阶${g.ascension} 符文${g.rune} · ${mechLabel(d)}`);
      meta.style.cssText = 'color:var(--ink-faint);font-size:11px;margin-top:2px;font-family:var(--mono);';
      info.appendChild(meta);
      row.appendChild(info);
      const cta = el('div', '', inLoadout ? '在背包' : '加入出战');
      cta.style.cssText =
        'cursor:pointer;font-size:12px;padding:5px 14px;border:1px solid ' +
        (inLoadout ? 'var(--line)' : 'var(--cinnabar)') + ';color:' +
        (inLoadout ? 'var(--ink-dim)' : 'var(--cinnabar-soft)') + ';white-space:nowrap;';
      if (!inLoadout) {
        cta.addEventListener('click', () => {
          cb.onAddToLoadout(d.id);
          refresh();
        });
      }
      row.appendChild(cta);
      pool.appendChild(row);
    }
  };

  cols.appendChild(loadout);
  cols.appendChild(pool);
  screen.appendChild(cols);
  const backBtn = button('', '返回', () => cb.onBack());
  backBtn.style.cssText = 'position:sticky;bottom:14px;margin-top:18px;';
  screen.appendChild(backBtn);

  return { screen, refresh };
}

/** 属性界面：四围 + 战力 + 六维 + 消耗品库存（战斗中 7/8/9/0 生效） */
export function createStatsScreen(
  inventory: Inventory,
  cb: {
    getStats: () => { attackMult: number; critRate: number; critMult: number; armor: number; speedMult: number; energyRegen: number; maxHpBonus: number; fireRateMult: number };
    onBack: () => void;
  }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '属性'));
  screen.appendChild(el('div', 'ss-subtitle', '四围 · 战力 · 消耗品'));
  const card = el('div', 'ss-card', '');
  card.style.minWidth = '620px';
  const fourBody = el('div', '', '');
  card.appendChild(fourBody);
  const statsBody = el('div', '', '');
  card.appendChild(statsBody);
  const consBody = el('div', '', '');
  card.appendChild(consBody);
  screen.appendChild(card);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const refresh = (): void => {
    const s = cb.getStats();
    const four = fourStats(s);
    const score = powerScore(s, 100 + s.maxHpBonus);
    const fourRows: [string, string, string][] = [
      ['体质', `${four.body}`, '最大生命（巅峰成长）'],
      ['力量', `${four.power}`, '伤害加成%（巅峰）'],
      ['知识', `${four.mind}`, '暴击率%（附魔/巅峰）'],
      ['敏捷', `${four.agility}`, '攻速加成%（附魔）'],
    ];
    fourBody.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <h3 style="display:inline">四围</h3>
        <span style="color:var(--cinnabar-soft);font-size:13px">战力 <b style="font-size:16px">${score}</b></span>
      </div>` +
      fourRows.map(([k, v, d]) => `<div class="row"><span>${k} <span style="color:var(--ink-dim);font-size:12px">${d}</span></span><b>${v}</b></div>`).join('');
    const rows: [string, string][] = [
      ['攻击倍率', `×${s.attackMult.toFixed(2)}`],
      ['暴击率', `${Math.round(s.critRate * 100)}%`],
      ['暴击伤害', `×${s.critMult.toFixed(1)}`],
      ['护甲减伤', `${Math.round(s.armor * 100)}%`],
      ['移速倍率', `×${s.speedMult.toFixed(2)}`],
      ['攻速倍率', `×${s.fireRateMult.toFixed(2)}`],
      ['能量回复', `${s.energyRegen.toFixed(1)}/s`],
      ['最大生命', `${100 + s.maxHpBonus}`],
    ];
    statsBody.innerHTML = '<h3 style="margin-top:18px">六维属性</h3>' +
      rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    const cons: [string, string, string][] = [
      ['治疗针', '×' + inventory.consumable('medkit'), '按 7 回复 40 生命'],
      ['攻击药水', '×' + inventory.consumable('atk'), '按 8 攻击 +25%（20s）'],
      ['护盾药剂', '×' + inventory.consumable('shield'), '按 9 减伤 +35%（10s）'],
      ['加速药水', '×' + inventory.consumable('speed'), '按 0 移速 +30%（12s）'],
    ];
    consBody.innerHTML = '<h3 style="margin-top:18px">消耗品</h3>' +
      cons.map(([n, c, d]) => `<div class="row"><span>${n} <span style="color:var(--ink-dim);font-size:12px">${d}</span></span><b>${c}</b></div>`).join('');
  };
  return { screen, refresh };
}

/** 局内商店（Tab 键，战斗中金币购买临时强化） */
export function createCombatShop(cb: { onBuy: (id: string) => void; onClose: () => void }): { screen: HTMLElement; show: (gold: number) => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.style.cssText = 'z-index:45;background:rgba(8,10,8,0.9);';
  const title = el('div', 'ss-title', '局内商店');
  title.style.cssText = 'margin-top:14vh;';
  screen.appendChild(title);
  const sub = el('div', 'ss-subtitle', 'Tab 关闭 · 金币购买临时补给');
  screen.appendChild(sub);
  const cards = el('div', '', '');
  cards.style.cssText = 'display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:20px;max-width:900px;';
  screen.appendChild(cards);
  const GOODS: { id: string; name: string; desc: string; price: number }[] = [
    { id: 'heal', name: '医疗包', desc: '回复 60 生命', price: 30 },
    { id: 'dmg', name: '狂暴药剂', desc: '伤害 +20%（30s）', price: 40 },
    { id: 'energy', name: '能量电池', desc: '能量回满', price: 20 },
    { id: 'shield', name: '护盾发生器', desc: '护盾 60 点（12s）', price: 35 },
  ];
  let goldNow = 0;
  const show = (gold: number): void => {
    goldNow = gold;
    cards.innerHTML = '';
    for (const g of GOODS) {
      const card = el('div', 'ss-card', '');
      card.style.cssText = 'flex:0 0 180px;padding:18px;cursor:pointer;text-align:center;';
      card.innerHTML = `
        <div style="color:var(--amber-soft);font-size:20px;margin-bottom:8px">${g.price} 金</div>
        <div style="color:var(--ink);font-size:15px;letter-spacing:0.08em;margin-bottom:6px">${g.name}</div>
        <div style="color:var(--ink-dim);font-size:12px;line-height:1.6">${g.desc}</div>`;
      if (gold < g.price) card.style.opacity = '0.4';
      card.addEventListener('click', () => { if (goldNow >= g.price) cb.onBuy(g.id); });
      cards.appendChild(card);
    }
    screen.classList.remove('hidden');
  };
  return { screen, show };
}

/** 每日任务界面：3 个任务 + 进度 + 领取奖励 */
export function createDailyScreen(
  _inventory: Inventory,
  state: { date: string; progress: Record<string, number>; claimed: string[] },
  cb: { onClaim: (id: string) => void; onBack: () => void }
): { screen: HTMLElement; refresh: () => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '每日任务'));
  screen.appendChild(el('div', 'ss-subtitle', '每日重置 · 击杀/通关/开箱领取补给'));
  const card = el('div', 'ss-card', '');
  card.style.minWidth = '560px';
  const list = el('div', '', '');
  card.appendChild(list);
  screen.appendChild(card);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const refresh = (): void => {
    const tasks = genDailyTasks(state.date);
    list.innerHTML = '';
    for (const t of tasks) {
      const cur = Math.min(state.progress[t.id] ?? 0, t.target);
      const done = cur >= t.target;
      const claimed = state.claimed.includes(t.id);
      const row = el('div', 'ss-brief-row');
      row.style.gridTemplateColumns = '1fr auto';
      const info = el('div', '', '');
      info.appendChild(el('div', 'ss-brief-name', t.name + (done ? ' ✓' : '')));
      info.appendChild(el('div', 'ss-brief-meta', `进度 ${cur}/${t.target} · 奖励 ${t.rewardMaterial}×${t.rewardAmount} + ${t.rewardGold}金币`));
      row.appendChild(info);
      const cta = el('div', 'ss-brief-cta', claimed ? '已领取' : done ? '领取' : '进行中');
      if (done && !claimed) {
        cta.addEventListener('click', () => {
          cb.onClaim(t.id);
          refresh();
        });
      } else {
        cta.style.color = 'var(--ink-faint)';
        cta.style.borderColor = 'var(--line)';
      }
      row.appendChild(cta);
      list.appendChild(row);
    }
  };
  return { screen, refresh };
}

/** 升级选牌界面：3 选 1 局内强化（Roguelite） */
export function createLevelUpScreen(cb: { onPick: (id: string) => void }): { screen: HTMLElement; show: (level: number, choices: { id: string; name: string; desc: string }[]) => void } {
  const screen = el('div', 'ss-screen hidden');
  screen.style.cssText = 'z-index:40;background:rgba(8,8,12,0.92);';
  const title = el('div', 'ss-title', '');
  title.style.cssText = 'margin-top:18vh;';
  screen.appendChild(title);
  const sub = el('div', 'ss-subtitle', '选择一项强化（可重复叠加）');
  screen.appendChild(sub);
  const cards = el('div', '', '');
  cards.style.cssText = 'display:flex;gap:20px;justify-content:center;margin-top:26px;';
  screen.appendChild(cards);

  const show = (level: number, choices: { id: string; name: string; desc: string }[]): void => {
    title.textContent = `升级！第 ${level} 级`;
    cards.innerHTML = '';
    for (const c of choices) {
      const card = el('div', 'ss-card', '');
      card.style.cssText = 'flex:0 0 220px;padding:22px;cursor:pointer;text-align:center;';
      card.innerHTML = `
        <div style="color:var(--cinnabar-soft);font-size:22px;letter-spacing:0.2em;margin-bottom:10px">✦</div>
        <div style="color:var(--ink);font-size:16px;letter-spacing:0.1em;margin-bottom:8px">${c.name}</div>
        <div style="color:var(--ink-dim);font-size:13px;line-height:1.7">${c.desc}</div>`;
      card.addEventListener('click', () => {
        cb.onPick(c.id);
        screen.classList.add('hidden');
      });
      cards.appendChild(card);
    }
    screen.classList.remove('hidden');
  };
  return { screen, show };
}

export function createResultScreen(cb: ScreenCallbacks): {
  screen: HTMLElement;
  show: (result: FlowResult, weapon: WeaponDef) => void;
  hide: () => void;
} {
  const screen = el('div', 'ss-screen hidden');
  const title = el('div', 'ss-title', '');
  const body = el('div', 'ss-card', '');
  const detail = el('div', '', '');
  body.appendChild(detail);
  const actions = el('div', '', '');
  screen.appendChild(title);
  screen.appendChild(body);
  actions.style.cssText = 'position:sticky;bottom:14px;margin-top:18px;display:flex;gap:10px;';
  screen.appendChild(actions);

  return {
    screen,
    show(result, _weapon) {
      screen.classList.remove('hidden');
      actions.innerHTML = '';
      if (result.phase === 'clear') {
        title.textContent = '任务完成';
        title.style.color = 'var(--ok)';
        detail.innerHTML = `
          <div class="row"><span>关卡</span><b>${result.mission.name}</b></div>
          <div class="row"><span>波次</span><b>${result.waveIndex + 1} / ${result.totalWaves}</b></div>
          <div class="row"><span>击杀</span><b>${result.kills}</b></div>
          <div class="row"><span>用时</span><b>${result.timeSeconds}s</b></div>
          <div class="row"><span>掉落</span><b>${result.rewardMaterial} ×${result.rewardAmount}</b></div>
        `;
        actions.appendChild(button('primary', '返回任务简报', () => cb.onBackToMenu()));
        actions.appendChild(button('', '再次出击', () => cb.onStartMission(result.mission.id)));
      } else {
        title.textContent = '任务失败';
        title.style.color = 'var(--cinnabar-soft)';
        detail.innerHTML = `
          <div class="row"><span>关卡</span><b>${result.mission.name}</b></div>
          <div class="row"><span>到达波次</span><b>${result.waveIndex + 1}</b></div>
          <div class="row"><span>击杀</span><b>${result.kills}</b></div>
          <div class="row"><span>用时</span><b>${result.timeSeconds}s</b></div>
        `;
        actions.appendChild(button('', '返回任务简报', () => cb.onBackToMenu()));
        actions.appendChild(button('primary', '重整旗鼓', () => cb.onStartMission(result.mission.id)));
      }
    },
    hide() {
      screen.classList.add('hidden');
    },
  };
}

/** 结算界面的武器养成面板（复用强化逻辑） */
export function createArmoryPanel(inventory: Inventory, cb: ScreenCallbacks): { root: HTMLElement; refresh: (w: WeaponDef) => void } {
  const root = el('div', '', '');
  const refresh = (w: WeaponDef): void => {
    const g = inventory.getWeapon(w.id);
    const upCost = (g.level + 1) * 2;
    const asCost = 5 + g.ascension * 5;
    const runeCost = 3 + g.rune * 2;
    root.innerHTML = `
      <h3 style="margin:16px 0 12px">${w.name} 养成</h3>
      <div class="row"><span>同步 Lv.${g.level} / 进阶 ${g.ascension} / 符文 ${g.rune}</span><b>伤害 +${Math.round((damageMultiplier(w, inventory) - 1) * 100)}%</b></div>
    `;
    const btns = el('div', 'fg-btns', '');
    const mk = (label: string, disabled: boolean, fn: () => void): HTMLButtonElement => {
      const b = button('', label, fn);
      b.disabled = disabled;
      return b;
    };
    btns.appendChild(mk(`同步（合金×${upCost}）`, inventory.material('合金碎片') < upCost, () => { tryUpgrade(w, inventory); cb.onUpgrade(); refresh(w); }));
    btns.appendChild(mk(`进阶（核心×${asCost}）`, inventory.material('核心晶体') < asCost || g.ascension >= MAX_ASCENSION, () => { tryAscend(w, inventory); cb.onUpgrade(); refresh(w); }));
    btns.appendChild(mk(`符文（核心×${runeCost}）`, inventory.material('核心晶体') < runeCost || g.rune >= MAX_RUNE, () => { tryRuneUpgrade(w, inventory); cb.onUpgrade(); refresh(w); }));
    root.appendChild(btns);
  };
  return { root, refresh };
}

export function weaponOf(id: string): WeaponDef {
  return ARSENAL.find((x) => x.id === id) ?? ARSENAL[0];
}
