/**
 * shell/settings — 游戏内设置面板（O 键开关）。
 *
 * 自包含覆盖层，不暂停游戏：音量/灵敏度/画质/雷达可即时生效。
 * 状态持久化到 localStorage（ss-settings-v1）。
 */
import { sfx } from '../core/sfx';

export interface SettingsState {
  /** 主音量 0..1 */
  volume: number;
  muted: boolean;
  /** 鼠标灵敏度倍率（基准 0.12） */
  sens: number;
  /** 画质档位（auto = 跟随帧时自动升降） */
  quality: 'auto' | 'low' | 'medium' | 'high';
  /** 雷达开关 */
  radar: boolean;
  /** 背景音乐开关 */
  music: boolean;
}

const KEY = 'ss-settings-v1';

export function loadSettings(): SettingsState {
  const base: SettingsState = { volume: 0.5, muted: false, sens: 1, quality: 'auto', radar: true, music: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<SettingsState>) };
  } catch {
    // localStorage 不可用时用默认值
  }
  return base;
}

export function saveSettings(s: SettingsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 忽略持久化失败
  }
}

export interface SettingsPanel {
  el: HTMLElement;
  toggle: () => void;
  hide: () => void;
  visible: () => boolean;
  /** 外部状态变化（如读档）后刷新控件 */
  refresh: () => void;
}

export function createSettingsPanel(
  state: SettingsState,
  apply: (s: SettingsState) => void
): SettingsPanel {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:16px;top:70px;width:236px;z-index:60;display:none;pointer-events:auto;' +
    "background:rgba(255,255,255,0.94);border:1px solid #d9d7cf;border-left:2px solid #3d6b8f;padding:12px 14px;font-family:var(--mono,monospace);color:#22252c;box-shadow:0 2px 10px rgba(34,37,44,0.15);";
  document.body.appendChild(el);

  const title = document.createElement('div');
  title.textContent = '设 置';
  title.style.cssText = 'font-size:12px;letter-spacing:0.3em;color:#7d8698;margin-bottom:10px;';
  el.appendChild(title);

  const row = (label: string): { wrap: HTMLDivElement; body: HTMLDivElement } => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;';
    const lab = document.createElement('div');
    lab.textContent = label;
    lab.style.cssText = 'font-size:10px;letter-spacing:0.2em;color:#7d8698;margin-bottom:4px;';
    wrap.appendChild(lab);
    const body = document.createElement('div');
    wrap.appendChild(body);
    el.appendChild(wrap);
    return { wrap, body };
  };

  // 音量
  const vol = row('音量');
  const volSlider = document.createElement('input');
  volSlider.type = 'range';
  volSlider.min = '0';
  volSlider.max = '100';
  volSlider.style.cssText = 'width:100%;accent-color:#5b8ec4;';
  vol.body.appendChild(volSlider);
  const volVal = document.createElement('span');
  volVal.style.cssText = 'font-size:10px;color:#7d8698;';
  vol.body.appendChild(volVal);

  // 静音
  const mute = row('静音');
  const muteBox = document.createElement('input');
  muteBox.type = 'checkbox';
  muteBox.style.cssText = 'accent-color:#5b8ec4;';
  mute.body.appendChild(muteBox);

  // 灵敏度
  const sens = row('鼠标灵敏度');
  const sensSlider = document.createElement('input');
  sensSlider.type = 'range';
  sensSlider.min = '30';
  sensSlider.max = '200';
  sensSlider.style.cssText = 'width:100%;accent-color:#5b8ec4;';
  sens.body.appendChild(sensSlider);
  const sensVal = document.createElement('span');
  sensVal.style.cssText = 'font-size:10px;color:#7d8698;';
  sens.body.appendChild(sensVal);

  // 画质
  const q = row('画质');
  const qBtns: Record<string, HTMLButtonElement> = {};
  for (const [id, label] of [['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高']] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.q = id;
    b.style.cssText =
      'background:none;border:1px solid #262e3a;color:#7d8698;padding:4px 10px;margin-right:6px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.1em;';
    b.addEventListener('click', () => {
      state.quality = id;
      apply(state);
      saveSettings(state);
      refresh();
    });
    q.body.appendChild(b);
    qBtns[id] = b;
  }

  // 音乐
  const mu = row('背景音乐');
  const musicBox = document.createElement('input');
  musicBox.type = 'checkbox';
  musicBox.style.cssText = 'accent-color:#5b8ec4;';
  mu.body.appendChild(musicBox);
  musicBox.addEventListener('change', () => {
    state.music = musicBox.checked;
    apply(state);
    saveSettings(state);
    refresh();
  });

  // 雷达
  const rd = row('雷达');
  const radarBox = document.createElement('input');
  radarBox.type = 'checkbox';
  radarBox.style.cssText = 'accent-color:#5b8ec4;';
  rd.body.appendChild(radarBox);

  // 关闭
  const close = document.createElement('button');
  close.textContent = '关闭 (O)';
  close.style.cssText =
    'width:100%;background:none;border:1px solid #262e3a;color:#7d8698;padding:6px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.2em;';
  close.addEventListener('click', () => {
    el.style.display = 'none';
  });
  el.appendChild(close);

  function refresh(): void {
    volSlider.value = String(Math.round(state.volume * 100));
    volVal.textContent = `${Math.round(state.volume * 100)}%`;
    muteBox.checked = state.muted;
    sensSlider.value = String(Math.round(state.sens * 100));
    sensVal.textContent = `${state.sens.toFixed(2)}×`;
    for (const id of Object.keys(qBtns)) {
      qBtns[id].style.color = state.quality === id ? '#8fb4d8' : '#7d8698';
      qBtns[id].style.borderColor = state.quality === id ? '#5b8ec4' : '#262e3a';
    }
    radarBox.checked = state.radar;
    musicBox.checked = state.music;
  }

  volSlider.addEventListener('input', () => {
    state.volume = Number(volSlider.value) / 100;
    apply(state);
    saveSettings(state);
    refresh();
  });
  muteBox.addEventListener('change', () => {
    state.muted = muteBox.checked;
    apply(state);
    saveSettings(state);
    refresh();
  });
  sensSlider.addEventListener('input', () => {
    state.sens = Number(sensSlider.value) / 100;
    apply(state);
    saveSettings(state);
    refresh();
  });
  radarBox.addEventListener('change', () => {
    state.radar = radarBox.checked;
    apply(state);
    saveSettings(state);
    refresh();
  });

  refresh();

  return {
    el,
    toggle: () => {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      sfx.resume(); // 面板交互也是用户手势
    },
    hide: () => {
      el.style.display = 'none';
    },
    visible: () => el.style.display !== 'none',
    refresh,
  };
}
