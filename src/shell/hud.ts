/**
 * shell/hud — 战斗 HUD：细线准星 / 血条 / 能量条 / 武器信息 / 技能数值面板 / BOSS 血条 / 受击红晕。
 */
import { el } from './ui';

export interface SkillLine {
  key: string;
  label: string;
  value: string;
}

export interface HudView {
  root: HTMLElement;
  crosshair: HTMLElement;
  update(data: {
    hp: number;
    maxHp: number;
    energy: number;
    maxEnergy: number;
    weaponName: string;
    weaponLevel: number;
    weaponAsc: number;
    damageMult: number;
    phase: string;
    wave: number;
    monsterLevel: number;
    playerLevel: number;
    totalWaves: number;
    tower?: boolean;
    missionName: string;
    /** 已开启自动选择时显示流派名 */
    autoPick?: string | null;
    skillLines: SkillLine[];
    slots: { name: string; rarity: string }[];
    slotIndex: number;
    ammo: number;
    mag: number;
    reloading: boolean;
  }): void;
  boss(name: string, hpPct: number): void;
  hideBoss(): void;
  hit(): void;
  hitConfirm(): void;
  /** 屏幕震动（） */
  shake(intensity?: number): void;
  /** 击杀提示（） */
  killFeed(text: string, color?: string): void;
  /** 伤害数字飘字 */
  damageNumber(x: number, y: number, dmg: number, crit?: boolean): void;
  setSpread(p: number): void;
  /** 准星样式：十字 / 圆点 / 圆环 */
  setCrosshairStyle(style: 'cross' | 'dot' | 'ring'): void;
}

const CROSSHAIR_GAP = 5;

export function createHud(): HudView {
  const root = el('div', '', '');
  root.id = 'ss-hud';
  root.innerHTML = `
    <div class="hud-weapon"></div>
    <div class="hud-wave"></div>
    <div style="display:flex;gap:26px">
      <div style="width:300px">
        <div class="hud-label">生命</div>
        <div class="bar hp"><div style="width:100%"></div></div>
        <div class="hud-num hp-num"></div>
      </div>
      <div style="width:260px">
        <div class="hud-label">能量</div>
        <div class="bar energy"><div style="width:0%"></div></div>
        <div class="hud-num energy-num"></div>
      </div>
    </div>
  `;

  // 准星（4 段细线 + 中心点）
  const crosshair = el('div', '', '');
  crosshair.id = 'ss-crosshair';
  const pieces = [
    ['ch-piece', -20, 0, 12, 2],
    ['ch-piece', 8, 0, 12, 2],
    ['ch-piece', -2, -20, 2, 12],
    ['ch-piece', -2, 8, 2, 12],
    ['ch-dot', -2, -2, 4, 4],
  ] as const;
  for (const [cls, x, y, w, h] of pieces) {
    const p = el('div', cls, '');
    p.style.left = `${x + CROSSHAIR_GAP / 2}px`;
    p.style.top = `${y + CROSSHAIR_GAP / 2}px`;
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;
    crosshair.appendChild(p);
  }
  const ringPiece = el('div', 'ch-ring', '');
  crosshair.appendChild(ringPiece);

  // 技能数值面板
  const skills = el('div', '', '');
  skills.id = 'ss-skills';
  skills.innerHTML = `<div class="sk-title">技能</div><div class="sk-body"></div>`;

  // BOSS 血条
  const bossWrap = el('div', 'hidden', '');
  bossWrap.id = 'ss-boss-wrap';
  bossWrap.innerHTML = `<div id="ss-boss-name"></div><div class="bar bossbar" style="margin:0 auto"><div style="width:100%"></div></div>`;

  // 武器背包栏（底部中央）
  const slotsWrap = el('div', '', '');
  slotsWrap.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:14px;';
  slotsWrap.id = 'ss-slots';
  root.appendChild(slotsWrap);

  // 受击红晕
  const vignette = el('div', '', '');
  vignette.id = 'ss-damage-vignette';

  document.body.append(root, crosshair, skills, bossWrap, vignette);

  const hpBar = root.querySelector('.bar.hp > div') as HTMLElement;
  const energyBar = root.querySelector('.bar.energy > div') as HTMLElement;
  const hpNum = root.querySelector('.hp-num') as HTMLElement;
  const energyNum = root.querySelector('.energy-num') as HTMLElement;
  const weaponInfo = root.querySelector('.hud-weapon') as HTMLElement;
  const waveInfo = root.querySelector('.hud-wave') as HTMLElement;
  const skillBody = skills.querySelector('.sk-body') as HTMLElement;
  const bossBar = bossWrap.querySelector('.bar.bossbar > div') as HTMLElement;
  const bossName = bossWrap.querySelector('#ss-boss-name') as HTMLElement;
  // 缓存：内容不变时跳过 DOM 重建（避免每帧 innerHTML / style 写入）
  let cacheSkill = '';
  let cacheSlots = '';
  let cacheWeapon = '';
  let cacheWave = '';
  let cacheHp = -1;
  let cacheHpMax = -1;
  let cacheEnergy = -1;
  let cacheEnergyMax = -1;
  let cacheSpread = -1;

  return {
    root,
    crosshair,
    update(d) {
      // 血条/能量条用 transform 缩放（不触发布局），且数值未变时不写 DOM
      const hpPct = d.maxHp > 0 ? Math.min(1, d.hp / d.maxHp) : 0;
      const enPct = d.maxEnergy > 0 ? Math.min(1, d.energy / d.maxEnergy) : 0;
      hpBar.style.transform = `scaleX(${hpPct.toFixed(3)})`;
      energyBar.style.transform = `scaleX(${enPct.toFixed(3)})`;
      const hpNow = Math.ceil(d.hp);
      if (hpNow !== cacheHp || d.maxHp !== cacheHpMax) {
        cacheHp = hpNow;
        cacheHpMax = d.maxHp;
        hpNum.textContent = `${hpNow} / ${d.maxHp}`;
      }
      const enNow = Math.floor(d.energy);
      if (enNow !== cacheEnergy || d.maxEnergy !== cacheEnergyMax) {
        cacheEnergy = enNow;
        cacheEnergyMax = d.maxEnergy;
        energyNum.textContent = `${enNow} / ${d.maxEnergy}`;
      }
      const weaponTxt = `${d.weaponName} · Lv.${d.weaponLevel} 阶${d.weaponAsc} · 伤害×${d.damageMult.toFixed(2)} · 弹药 ${d.ammo}/${d.mag}${d.reloading ? '（换弹中…）' : ''}`;
      if (weaponTxt !== cacheWeapon) {
        cacheWeapon = weaponTxt;
        weaponInfo.textContent = weaponTxt;
      }
      const phaseText = d.tower
        ? d.phase === 'intro'
          ? '准备中'
          : d.phase === 'boss'
            ? `BOSS · 第 ${d.wave + 1} 层`
            : `塔 · 第 ${d.wave + 1} 层`
        : d.phase === 'intro'
          ? '准备中'
          : d.phase === 'boss'
            ? 'BOSS 战'
            : `波次 ${d.wave + 1} / ${d.totalWaves}`;
      // 等级压制：显示怪物等级与压制状态（绿=压制怪物 红=被压制）
      const lvDiff = d.playerLevel - d.monsterLevel;
      const supTag = lvDiff >= 2 ? '压制 ↑' : lvDiff <= -2 ? '被压制 ↓' : '势均力敌';
      const waveTxt = `${d.missionName} · ${phaseText} · 怪物 Lv.${d.monsterLevel}（${supTag}）${d.autoPick ? ` · 自动:${d.autoPick}` : ''}`;
      if (waveTxt !== cacheWave) {
        cacheWave = waveTxt;
        waveInfo.textContent = waveTxt;
      }
      // 技能面板：内容变化才重建
      const skillKey = d.skillLines.map((s) => `${s.key}|${s.label}|${s.value}`).join('\u0001');
      if (skillKey !== cacheSkill) {
        cacheSkill = skillKey;
        skillBody.innerHTML = d.skillLines
          .map((s) => `<div class="sk-line"><span class="kbd">${s.key}</span><b>${s.label}</b> ${s.value}</div>`)
          .join('');
      }
      // 武器背包栏：内容变化才重建
      const slotsKey = d.slots.map((s, i) => s.name + ':' + s.rarity + ':' + (i === d.slotIndex ? '1' : '0')).join(',');
      if (slotsKey !== cacheSlots) {
        cacheSlots = slotsKey;
        slotsWrap.innerHTML = d.slots
          .map((s, i) => {
            const active = i === d.slotIndex;
            const color = (window as unknown as Record<string, Record<string, string>>).__rarity?.[s.rarity] ?? '#9aa0a6';
            return `<div style="padding:5px 12px;border:1px solid ${active ? color : 'var(--line)'};background:${active ? 'rgba(230,225,213,0.10)' : 'rgba(0,0,0,0.35)'};font-size:13px;letter-spacing:0.08em;color:${active ? color : 'var(--ink-dim)'}">${i + 1} ${s.name.slice(0, 4)}</div>`;
          })
          .join('');
      }
    },
    boss(name, pct) {
      bossWrap.classList.remove('hidden');
      bossName.textContent = name;
      bossBar.style.width = `${pct}%`;
    },
    hideBoss() {
      bossWrap.classList.add('hidden');
    },
    hit() {
      vignette.classList.add('on');
      crosshair.classList.add('hit');
      window.setTimeout(() => {
        vignette.classList.remove('on');
        crosshair.classList.remove('hit');
      }, 160);
    },
    hitConfirm() {
      crosshair.classList.add('hit');
      window.setTimeout(() => crosshair.classList.remove('hit'), 90);
    },
    shake(intensity = 1) {
      root.style.transform = `translate(${(Math.random() - 0.5) * 6 * intensity}px, ${(Math.random() - 0.5) * 6 * intensity}px)`;
      window.setTimeout(() => { root.style.transform = ''; }, 80);
    },
    killFeed(text, color = '#ff6644') {
      const feed = el('div', '', '');
      feed.style.cssText = `position:fixed;top:${60 + Math.random() * 40}px;right:20px;color:${color};font:bold 13px/1 var(--mono);letter-spacing:.08em;text-shadow:0 1px 4px rgba(0,0,0,.6);z-index:9998;transition:opacity .3s;pointer-events:none;`;
      feed.textContent = text;
      document.body.appendChild(feed);
      window.setTimeout(() => { feed.style.opacity = '0'; }, 1800);
      window.setTimeout(() => feed.remove(), 2200);
    },
    damageNumber(x, y, dmg, crit = false) {
      const num = el('div', '', '');
      const size = crit ? 22 : 16;
      const color = crit ? '#ffcc00' : '#ffffff';
      num.style.cssText = `position:fixed;left:${x}px;top:${y}px;color:${color};font:bold ${size}px/1 var(--mono);text-shadow:0 1px 3px rgba(0,0,0,.7);z-index:9997;pointer-events:none;transition:all .4s ease-out;opacity:1;`;
      num.textContent = crit ? `${Math.round(dmg)}!` : String(Math.round(dmg));
      document.body.appendChild(num);
      requestAnimationFrame(() => { num.style.transform = 'translateY(-30px)'; num.style.opacity = '0'; });
      window.setTimeout(() => num.remove(), 500);
    },
    setSpread(p) {
      if (p === cacheSpread) return;
      cacheSpread = p;
      const gap = CROSSHAIR_GAP + p * 26;
      const pieces = crosshair.children;
      for (let i = 0; i < 4; i++) {
        const piece = pieces[i] as HTMLElement;
        if (!piece) continue;
        if (i < 2) piece.style.left = `${i === 0 ? -20 - gap : 8 + gap}px`;
        else piece.style.top = `${i === 2 ? -20 - gap : 8 + gap}px`;
      }
    },
    setCrosshairStyle(style) {
      for (let i = 0; i < 4; i++) {
        const piece = crosshair.children[i] as HTMLElement | undefined;
        if (piece) piece.style.display = style === 'cross' ? '' : 'none';
      }
      const dot = crosshair.querySelector('.ch-dot') as HTMLElement | null;
      if (dot) dot.style.display = '';
      ringPiece.style.display = style === 'ring' ? 'block' : 'none';
    },
  };
}
