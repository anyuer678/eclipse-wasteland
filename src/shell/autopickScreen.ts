/**
 * shell/autopickScreen — 局外「自动选择」界面。
 *
 * 开关 + 命名流派 + 流派内强化优先级排序；配置写入 ss-autopick-v1，
 * 战斗中升级时由 game 读取（不暂停、不弹牌）。
 */
import { el, button } from './ui';
import { BOOST_POOL, ALL_BOOST_IDS, getAutoPick, saveAutoPick } from '../growth';
import type { AutoPickConfig, BoostId } from '../growth';

export interface AutoPickScreen {
  screen: HTMLElement;
  refresh: () => void;
}

export function createAutoPickScreen(cb: { onBack: () => void }): AutoPickScreen {
  const screen = el('div', 'ss-screen hidden');
  screen.appendChild(el('div', 'ss-title', '自动选择'));
  screen.appendChild(el('div', 'ss-subtitle', '升级强化按流派优先级自动领取 · 局外设置'));

  const card = el('div', 'ss-card', '');
  card.style.minWidth = '660px';
  card.style.maxWidth = '760px';
  screen.appendChild(card);

  const enableRow = el('label', '');
  enableRow.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;padding:2px 0 10px;';
  const enableBox = el('input', '') as HTMLInputElement;
  enableBox.type = 'checkbox';
  enableBox.style.cssText = 'accent-color:var(--cinnabar);width:16px;height:16px;';
  enableRow.appendChild(enableBox);
  const enableText = el('span', '', '启用自动选择');
  enableText.style.cssText = 'font-size:14px;letter-spacing:0.12em;color:var(--ink);font-weight:600;';
  enableRow.appendChild(enableText);
  const enableHint = el('span', '', '开启后升级不再弹牌暂停，直接按流派顺序领取');
  enableHint.style.cssText = 'font-size:12px;color:var(--ink-faint);margin-left:auto;';
  enableRow.appendChild(enableHint);
  card.appendChild(enableRow);

  const status = el('div', '');
  status.style.cssText = 'font-size:12.5px;letter-spacing:0.08em;margin:0 0 12px;font-family:var(--mono);';
  card.appendChild(status);

  const presetBar = el('div', '');
  presetBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px;';
  card.appendChild(presetBar);

  const presetHint = el('div', '');
  presetHint.textContent = '点击流派即启用自动选择；三个默认流派可改名、删除或新增';
  presetHint.style.cssText = 'font-size:11.5px;color:var(--ink-faint);margin:0 0 12px;letter-spacing:0.06em;';
  card.appendChild(presetHint);

  const nameRow = el('div', '');
  nameRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:12px;';
  const nameLabel = el('span', '', '流派名称');
  nameLabel.style.cssText = 'font-size:12px;letter-spacing:0.16em;color:var(--ink-dim);';
  nameRow.appendChild(nameLabel);
  const nameInput = el('input', '') as HTMLInputElement;
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.style.cssText = 'flex:1;min-width:0;padding:7px 10px;border:1px solid var(--line);background:var(--panel-2);color:var(--ink);font-family:var(--sans);font-size:13px;letter-spacing:0.08em;';
  nameRow.appendChild(nameInput);
  const delBtn = button('danger', '删除流派', () => {
    const cfg = getAutoPick();
    if (cfg.presets.length <= 1) return;
    cfg.presets.splice(cfg.active, 1);
    cfg.active = Math.min(cfg.active, cfg.presets.length - 1);
    saveAutoPick(cfg);
    refresh();
  });
  delBtn.style.cssText += 'min-width:0;padding:7px 14px;font-size:12px;letter-spacing:0.1em;';
  nameRow.appendChild(delBtn);
  card.appendChild(nameRow);

  const list = el('div', '');
  card.appendChild(list);

  const tip = el('div', 'ss-tip', '每级随机 3 张牌，按流派顺序选其中排最靠前的一张；都不在流派里时取第一张。');
  screen.appendChild(tip);
  screen.appendChild(button('', '返回', () => cb.onBack()));

  const boostName = (id: BoostId): string => BOOST_POOL.find((b) => b.id === id)?.name ?? id;
  const boostDesc = (id: BoostId): string => BOOST_POOL.find((b) => b.id === id)?.desc ?? '';

  const move = (order: BoostId[], i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
    saveAutoPick(getAutoPick());
    refresh();
  };

  function refresh(): void {
    const cfg: AutoPickConfig = getAutoPick();
    const active = Math.min(Math.max(0, cfg.active), cfg.presets.length - 1);
    cfg.active = active;
    const preset = cfg.presets[active];

    enableBox.checked = cfg.enabled;
    status.textContent = cfg.enabled ? `● 已开启 · 当前流派「${preset.name}」` : '○ 未开启 · 升级时手动三选一';
    status.style.color = cfg.enabled ? 'var(--ok)' : 'var(--cinnabar)';

    presetBar.innerHTML = '';
    cfg.presets.forEach((p, i) => {
      const chip = el('button', 'ss-btn', p.name) as HTMLButtonElement;
      chip.style.cssText = 'min-width:0;padding:6px 16px;font-size:12.5px;letter-spacing:0.12em;' +
        (i === active ? 'border-color:var(--ink);background:var(--panel-3);font-weight:600;color:var(--ink);' : '');
      chip.addEventListener('click', () => {
        const c = getAutoPick();
        c.active = i;
        c.enabled = true; // 选流派即视为启用，避免只点流派以为已生效
        saveAutoPick(c);
        refresh();
      });
      presetBar.appendChild(chip);
    });
    const addBtn = el('button', 'ss-btn', '+ 新增流派') as HTMLButtonElement;
    addBtn.style.cssText = 'min-width:0;padding:6px 16px;font-size:12.5px;letter-spacing:0.12em;border-style:dashed;color:var(--ink-dim);';
    addBtn.addEventListener('click', () => {
      const c = getAutoPick();
      c.presets.push({ name: `流派 ${c.presets.length + 1}`, order: [...ALL_BOOST_IDS] });
      c.active = c.presets.length - 1;
      c.enabled = true;
      saveAutoPick(c);
      refresh();
    });
    presetBar.appendChild(addBtn);

    nameInput.value = preset.name;
    delBtn.disabled = cfg.presets.length <= 1;

    list.innerHTML = '';
    preset.order.forEach((id, i) => {
      const row = el('div', '');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line-soft);';
      const rank = el('span', '', String(i + 1));
      rank.style.cssText = 'width:26px;text-align:right;font-family:var(--mono);font-size:12px;color:var(--ink-faint);font-variant-numeric:tabular-nums;';
      row.appendChild(rank);
      const name = el('span', '', boostName(id));
      name.style.cssText = 'min-width:96px;font-size:13px;color:var(--ink);letter-spacing:0.06em;';
      row.appendChild(name);
      const desc = el('span', '', boostDesc(id));
      desc.style.cssText = 'flex:1;font-size:12px;color:var(--ink-dim);';
      row.appendChild(desc);
      for (const dir of [-1, 1] as const) {
        const b = el('button', 'ss-btn', dir === -1 ? '↑' : '↓') as HTMLButtonElement;
        b.style.cssText = 'min-width:0;padding:2px 10px;font-size:12px;line-height:1.4;';
        b.disabled = dir === -1 ? i === 0 : i === preset.order.length - 1;
        b.addEventListener('click', () => move(preset.order, i, dir));
        row.appendChild(b);
      }
      list.appendChild(row);
    });
  }

  enableBox.addEventListener('change', () => {
    getAutoPick().enabled = enableBox.checked;
    saveAutoPick(getAutoPick());
    refresh();
  });
  nameInput.addEventListener('change', () => {
    const cfg = getAutoPick();
    const name = nameInput.value.trim().slice(0, 12);
    if (!name) {
      nameInput.value = cfg.presets[cfg.active].name;
      return;
    }
    cfg.presets[cfg.active].name = name;
    saveAutoPick(cfg);
    refresh();
  });

  refresh();
  return { screen, refresh };
}
