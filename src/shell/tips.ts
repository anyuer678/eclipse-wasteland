/**
 * shell/tips — 首局操作提示浮层（一次性，9 秒后自动隐藏；设置里可重看）。
 *
 * 纯 DOM 覆盖层，pointer-events:none，不拦截输入；任何按键/点击会立即收起。
 */
const KEY = 'ss-tips-v1';

export interface TipsView {
  el: HTMLElement;
  /** force = 忽略“已看过”标记（设置里手动重看） */
  show: (force?: boolean) => void;
  hide: () => void;
}

export function createTips(): TipsView {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:18;pointer-events:none;' +
    'background:rgba(255,255,255,0.93);border:1px solid #d9d7cf;border-left:2px solid #c0392b;' +
    'padding:14px 18px;max-width:560px;font-family:var(--mono,monospace);color:#22252c;' +
    'box-shadow:0 2px 10px rgba(34,37,44,0.15);display:none;line-height:1.9;';
  const title = document.createElement('div');
  title.textContent = '作战提示';
  title.style.cssText = 'font-size:11px;letter-spacing:0.3em;color:#7d8698;margin-bottom:8px;';
  el.appendChild(title);
  const lines = [
    'WASD 移动 · 空格跳跃 · F 冲刺 · 鼠标瞄准 / 左键射击 / 右键近战',
    'E 武器技能 · R 换弹 · 1–5 换枪 · X 角色大招 · Esc 暂停 · Tab 局内商店',
    '击杀升级：每级三选一强化；主菜单「自动选择」可让流派自动领取，不再打断战斗',
    'F 冲刺有短暂无敌帧：免伤触发「完美闪避」缩短冷却；命中敌人头部造成 150% 伤害',
  ];
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    row.style.cssText = 'font-size:12.5px;letter-spacing:0.04em;';
    el.appendChild(row);
  }
  document.body.appendChild(el);

  let timer = 0;
  const hide = (): void => {
    el.style.display = 'none';
    window.clearTimeout(timer);
    timer = 0;
  };
  const show = (force = false): void => {
    if (!force) {
      try {
        if (localStorage.getItem(KEY) === '1') return;
      } catch {
        // 隐私模式：每次开局都提示
      }
    }
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* 忽略持久化失败 */
    }
    el.style.display = 'block';
    window.clearTimeout(timer);
    timer = window.setTimeout(hide, 9000);
  };
  // 任意按键收起（只挂一次，隐藏后无副作用）
  window.addEventListener('keydown', () => {
    if (el.style.display !== 'none') hide();
  });
  return { el, show, hide };
}
