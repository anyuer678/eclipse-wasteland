/**
 * shell/ui — UI 基础工具与主题。
 *
 * 设计语言（用户覆盖默认风格）：暗色战术简报
 *   - 深墨底（带蓝的黑）、纸白文字、金属细线、直角
 *   - 朱砂红=生命/危险，黛蓝=能量/信息（仅两个功能 accent）
 *   - 拒绝：紫色/蓝紫渐变、圆角卡片、发光 blob、玻璃拟态
 *   - 特色：编号简报行、印章式按钮，暗色文档质感
 */

export const THEME = `
  :root {
    --bg: #0d1016;
    --bg-deep: #0a0c11;
    --panel: #151a22;
    --panel-2: #1a202a;
    --panel-3: #202838;
    --ink: #e8e4da;
    --ink-dim: #7d8698;
    --ink-faint: #565e6e;
    --line: #262e3a;
    --line-soft: #1c222c;
    --cinnabar: #c94f3d;
    --cinnabar-soft: #e08a76;
    --indigo: #5b8ec4;
    --indigo-soft: #8fb4d8;
    --amber: #d9a44a;
    --amber-soft: #e8c377;
    --ok: #7fae8d;
    --serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
    --sans: "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    --mono: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { background: var(--bg); margin: 0; }
  body { font-family: var(--sans); }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: #2a3240; border: 2px solid transparent; background-clip: content-box; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* ===== 屏幕容器：终端面板 ===== */
  .ss-screen {
    position: fixed; inset: 0; z-index: 20;
    display: flex; flex-direction: column; align-items: center;
    justify-content: flex-start;
    overflow-y: auto; padding: 34px 20px 46px;
    background:
      radial-gradient(ellipse at 50% -10%, rgba(91,142,196,0.09), transparent 55%),
      linear-gradient(180deg, rgba(13,16,22,0.6), rgba(13,16,22,1) 40%),
      var(--bg);
    color: var(--ink);
  }
  .ss-screen.hidden { display: none; }

  /* 标题栏：kicker + 标题 + 分隔线 */
  .ss-kicker {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.42em;
    color: var(--ink-faint); margin-bottom: 10px;
  }
  .ss-kicker::before { content: '// '; color: var(--cinnabar); }
  .ss-title {
    font-family: var(--serif); font-size: 30px; font-weight: 800;
    letter-spacing: 0.24em; color: var(--ink); margin: 0 0 8px;
  }
  .ss-subtitle {
    font-size: 12px; letter-spacing: 0.2em; color: var(--ink-dim);
    margin: 0 0 30px; padding-bottom: 18px;
    border-bottom: 1px solid var(--line); width: min(720px, 92vw);
    text-align: center;
  }

  /* ===== 按钮：直角 + hover 下划线滑入 ===== */
  .ss-btn {
    display: inline-block; min-width: 150px; padding: 10px 24px;
    background: transparent; border: 1px solid var(--line);
    color: var(--ink); font-size: 13px; letter-spacing: 0.22em;
    font-family: var(--sans); cursor: pointer;
    position: relative; overflow: hidden;
    transition: color .14s ease, border-color .14s;
  }
  .ss-btn::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    background: var(--cinnabar); transform: scaleX(0); transform-origin: left;
    transition: transform .2s ease;
  }
  .ss-btn:hover { border-color: var(--ink); color: var(--ink); }
  .ss-btn:hover::after { transform: scaleX(1); }
  .ss-btn:active { transform: translateY(1px); }
  .ss-btn.primary { border-color: var(--ink); border-width: 1px; color: var(--ink); }
  .ss-btn.primary::after { background: var(--ink); }
  .ss-btn.danger { border-color: var(--cinnabar); color: var(--cinnabar-soft); }
  .ss-btn.danger::after { background: var(--cinnabar); }
  .ss-btn.danger:hover { color: var(--cinnabar-soft); }
  .ss-btn:disabled { opacity: 0.32; cursor: not-allowed; }
  .ss-btn:disabled::after { background: transparent; }
  .ss-btn:disabled:hover { transform: none; }
  /* 界面底部返回按钮：固定在视口内（内容超高时不再被推出屏幕） */
  .ss-screen > .ss-btn {
    position: sticky; bottom: 14px; margin-top: 20px;
    flex-shrink: 0;
  }

  /* ===== 面板：顶部高光条 + 左上角标 ===== */
  .ss-card {
    position: relative;
    background: linear-gradient(180deg, var(--panel-2), var(--panel) 42%);
    border: 1px solid var(--line);
    padding: 22px 26px; min-width: 360px;
  }
  .ss-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--indigo), transparent 70%);
    opacity: 0.7;
  }
  .ss-card::after {
    content: ''; position: absolute; top: 0; left: 0;
    border-top: 12px solid var(--indigo); border-right: 12px solid transparent;
    opacity: 0.35;
  }
  .ss-card h3 {
    margin: 0 0 14px; font-size: 15px; letter-spacing: 0.18em;
    color: var(--ink); font-family: var(--serif); font-weight: 700;
    border-bottom: 1px solid var(--line); padding-bottom: 10px;
  }

  /* 表格行（标签-值） */
  .ss-card .row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 8px 0; color: var(--ink-dim); font-size: 13px;
    letter-spacing: 0.04em; border-bottom: 1px dashed var(--line-soft);
    font-variant-numeric: tabular-nums;
  }
  .ss-card .row:last-child { border-bottom: none; }
  .ss-card .row b { color: var(--ink); font-weight: 600; font-family: var(--mono); font-size: 12.5px; }
  .ss-tip {
    color: var(--ink-faint); font-size: 11.5px; margin-top: 20px;
    letter-spacing: 0.12em; font-family: var(--mono);
  }

  /* ===== 主菜单网格 ===== */
  .ss-grid {
    display: grid; grid-template-columns: repeat(4, minmax(150px, 190px));
    gap: 12px; width: min(860px, 94vw);
  }
  .ss-grid-card {
    position: relative; cursor: pointer; user-select: none;
    background: linear-gradient(180deg, var(--panel-2), var(--panel) 50%);
    border: 1px solid var(--line);
    padding: 18px 16px 16px;
    transition: border-color .14s, transform .06s, background .14s;
    overflow: hidden;
  }
  .ss-grid-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--indigo), transparent 65%);
    opacity: 0.45; transition: opacity .14s;
  }
  .ss-grid-card:hover { border-color: var(--ink); background: var(--panel-3); }
  .ss-grid-card:hover::before { opacity: 1; }
  .ss-grid-card:active { transform: translateY(1px); }
  .ss-grid-ico { font-size: 22px; color: var(--indigo-soft); margin-bottom: 8px; letter-spacing: 0; }
  .ss-grid-name { font-size: 14px; letter-spacing: 0.16em; color: var(--ink); font-family: var(--serif); font-weight: 700; }
  .ss-grid-desc { font-size: 11px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.05em; }
  .ss-grid-num {
    position: absolute; top: 10px; right: 12px;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ss-grid-main {
    grid-column: 1 / -1; padding: 20px 22px;
    display: flex; align-items: center; justify-content: space-between; gap: 18px;
    border-color: var(--ink); background: linear-gradient(180deg, #1c2230, #141821 60%);
  }
  .ss-grid-main::before { background: linear-gradient(90deg, var(--cinnabar), transparent 60%); opacity: 0.9; }
  .ss-grid-main:hover { border-color: var(--ink); background: #202838; }
  .ss-grid-main .ss-grid-name { font-size: 19px; }
  .ss-grid-main .ss-grid-desc { font-size: 12px; color: var(--ink-dim); }
  .ss-grid-main .ss-btn { margin: 0; }

  /* ===== 任务简报行 ===== */
  .ss-brief { width: min(680px, 92vw); }
  .ss-brief-row {
    display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 16px;
    padding: 15px 18px; border: 1px solid var(--line); margin-bottom: 10px;
    background: linear-gradient(180deg, var(--panel-2), var(--panel) 55%);
    cursor: pointer; transition: border-color .14s, transform .06s, background .14s;
  }
  .ss-brief-row:hover { border-color: var(--ink); background: var(--panel-3); }
  .ss-brief-row:active { transform: translateY(1px); }
  .ss-brief-num {
    font-family: var(--mono); font-size: 22px; color: var(--ink-faint);
    font-weight: 700; text-align: center;
  }
  .ss-brief-name { font-size: 16px; letter-spacing: 0.12em; color: var(--ink); font-family: var(--serif); }
  .ss-brief-meta { font-size: 11.5px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.04em; font-family: var(--mono); }
  .ss-brief-cta {
    font-size: 12px; letter-spacing: 0.18em; color: var(--cinnabar-soft);
    border: 1px solid var(--cinnabar); padding: 6px 16px;
    transition: background .14s, color .14s;
  }
  .ss-brief-row:hover .ss-brief-cta { background: var(--cinnabar); color: var(--bg); }

  /* ===== 强化界面模块 ===== */
  .fg-module {
    border: 1px solid var(--line-soft); padding: 12px 16px; margin-bottom: 10px;
    background: rgba(26,32,42,0.55);
  }
  .fg-module-title {
    font-size: 12px; letter-spacing: 0.2em; color: var(--ink-dim);
    font-family: var(--mono); margin-bottom: 8px;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .fg-module-title b { color: var(--ink); font-family: var(--serif); font-weight: 700; font-size: 13.5px; letter-spacing: 0.14em; }
  .fg-btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .fg-btns .ss-btn { min-width: 0; padding: 7px 14px; font-size: 12px; letter-spacing: 0.12em; }

  /* 难度选择 */
  .ss-diff-row { display: flex; gap: 8px; justify-content: center; align-items: center; margin-bottom: 18px; font-size: 12px; color: var(--ink-dim); }
  .ss-diff-item {
    cursor: pointer; padding: 5px 18px; border: 1px solid var(--line);
    letter-spacing: 0.16em; font-size: 12.5px; color: var(--ink-dim);
    transition: all .12s;
  }
  .ss-diff-item:hover { border-color: var(--ink); color: var(--ink); }
  .ss-diff-item.active { color: var(--cinnabar-soft); border-color: var(--cinnabar); }

  /* ===== HUD ===== */
  #ss-hud {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
    pointer-events: none; padding: 0 26px 20px;
    color: var(--ink);
  }
  .hud-weapon {
    font-size: 14px; letter-spacing: 0.16em; color: var(--ink); margin-bottom: 5px;
    font-family: var(--mono); text-shadow: 0 1px 3px rgba(0,0,0,0.85);
  }
  .hud-wave { font-size: 11px; letter-spacing: 0.12em; color: var(--ink-dim); margin-bottom: 10px; font-family: var(--mono); text-shadow: 0 1px 3px rgba(0,0,0,0.85); }
  .bar {
    height: 10px; border: 1px solid var(--line); background: rgba(0,0,0,0.55);
    position: relative;
  }
  .bar > div { height: 100%; transition: width .09s linear; }
  .bar.hp > div { background: linear-gradient(90deg, #8a2d22, var(--cinnabar)); }
  .bar.energy > div { background: linear-gradient(90deg, #274a6e, var(--indigo)); }
  .bar.bossbar { width: 380px; height: 12px; }
  .bar.bossbar > div { background: linear-gradient(90deg, #6b5a1e, var(--amber)); }
  .hud-label { color: var(--ink-dim); font-size: 10px; letter-spacing: 0.22em; margin-bottom: 3px; font-family: var(--mono); }
  .hud-num { color: var(--ink); font-size: 12.5px; margin-top: 3px; letter-spacing: 0.06em; font-family: var(--mono); font-variant-numeric: tabular-nums; }
  #ss-boss-wrap { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 15; text-align: center; }
  #ss-boss-wrap.hidden { display: none; }
  #ss-boss-name { color: var(--ink); font-size: 14px; letter-spacing: 0.3em; margin-bottom: 5px; font-family: var(--serif); text-shadow: 0 1px 3px rgba(0,0,0,0.85); }

  /* 准星 */
  #ss-crosshair { position: fixed; left: 50%; top: 50%; z-index: 16; pointer-events: none; }
  #ss-crosshair .ch-piece, #ss-crosshair .ch-dot { background: var(--ink); box-shadow: 0 0 2px rgba(0,0,0,0.9); }
  #ss-crosshair.hit .ch-piece, #ss-crosshair.hit .ch-dot { background: var(--cinnabar-soft); }

  /* 技能面板 */
  #ss-skills {
    position: fixed; right: 22px; bottom: 18px; z-index: 15; pointer-events: none;
    text-align: right; background: rgba(10,12,17,0.78);
    border-left: 2px solid var(--indigo); padding: 10px 16px;
  }
  .sk-title { font-size: 10px; letter-spacing: 0.3em; color: var(--ink-faint); margin-bottom: 6px; font-family: var(--mono); }
  .sk-line { font-size: 12px; color: var(--ink); letter-spacing: 0.08em; line-height: 1.9; font-variant-numeric: tabular-nums; }
  .sk-line b { font-weight: 600; color: var(--indigo-soft); }
  .sk-line .kbd { border: 1px solid var(--line); padding: 0 6px; margin-right: 6px; font-size: 11px; color: var(--ink-dim); font-family: var(--mono); }

  /* 受击红晕 */
  #ss-damage-vignette {
    position: fixed; inset: 0; z-index: 14; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 52%, rgba(192,69,53,0.5));
    opacity: 0; transition: opacity .08s ease;
  }
  #ss-damage-vignette.on { opacity: 1; }
`;

export function injectTheme(): void {
  const style = document.createElement('style');
  style.textContent = THEME;
  document.head.appendChild(style);
}

export function el(tag: string, cls: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'ss-btn ' + cls, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}
