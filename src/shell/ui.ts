/**
 * shell/ui — UI 基础工具与主题。
 *
 * 设计语言（用户定版）：亮色作战简报纸面
 *   - 纸白底、墨色文字、细线分隔、直角
 *   - 朱砂红=生命/危险，黛蓝=能量/信息（仅两个功能 accent）
 *   - 拒绝：紫色/蓝紫渐变、圆角卡片堆砌、玻璃拟态、发光 blob、暗色主题
 *   - 战斗 HUD：白底半透明面板 + 墨字，叠在亮色 3D 场景上清晰可读
 */

export const THEME = `
  :root {
    --bg: #f2f1ec;
    --bg-deep: #e9e7e0;
    --panel: #ffffff;
    --panel-2: #fbfaf6;
    --panel-3: #f3f1ea;
    --ink: #22252c;
    --ink-dim: #6b7280;
    --ink-faint: #9aa0ab;
    --line: #d9d7cf;
    --line-soft: #e7e5de;
    --cinnabar: #c0392b;
    --cinnabar-soft: #d96a55;
    --indigo: #3d6b8f;
    --indigo-soft: #3d6b8f;
    --amber: #b8860b;
    --amber-soft: #b8860b;
    --ok: #4a8a5c;
    --serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif;
    --sans: "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    --mono: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { background: var(--bg); margin: 0; }
  body { font-family: var(--sans); }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: #c9c6bc; border: 2px solid transparent; background-clip: content-box; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* ===== 屏幕容器：亮色作战简报纸面 ===== */
  .ss-screen {
    position: fixed; inset: 0; z-index: 20;
    display: flex; flex-direction: column; align-items: center;
    justify-content: flex-start;
    overflow-y: auto; padding: 34px 20px 46px;
    background:
      radial-gradient(ellipse at 50% -10%, rgba(61,107,143,0.07), transparent 55%),
      linear-gradient(180deg, #f7f6f1, var(--bg) 40%);
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

  /* ===== 按钮：直角 + hover 填充 ===== */
  .ss-btn {
    display: inline-block; min-width: 150px; padding: 10px 24px;
    background: var(--panel); border: 1px solid #c4c1b8;
    color: var(--ink); font-size: 13px; letter-spacing: 0.22em;
    font-family: var(--sans); cursor: pointer;
    position: relative; overflow: hidden;
    transition: color .14s ease, border-color .14s, background .14s;
  }
  .ss-btn::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
    background: var(--cinnabar); transform: scaleX(0); transform-origin: left;
    transition: transform .2s ease;
  }
  .ss-btn:hover { border-color: var(--ink); background: var(--panel-3); }
  .ss-btn:hover::after { transform: scaleX(1); }
  .ss-btn:active { transform: translateY(1px); }
  .ss-btn.primary { border-color: var(--ink); color: var(--ink); font-weight: 600; }
  .ss-btn.primary::after { background: var(--ink); }
  .ss-btn.danger { border-color: var(--cinnabar); color: var(--cinnabar); }
  .ss-btn.danger::after { background: var(--cinnabar); }
  .ss-btn.danger:hover { color: #fff; background: var(--cinnabar); }
  .ss-btn:disabled { opacity: 0.35; cursor: not-allowed; }
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
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: 0 1px 3px rgba(34,37,44,0.08);
    padding: 22px 26px; min-width: 360px;
  }
  .ss-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--indigo), transparent 70%);
    opacity: 0.6;
  }
  .ss-card::after {
    content: ''; position: absolute; top: 0; left: 0;
    border-top: 12px solid var(--indigo); border-right: 12px solid transparent;
    opacity: 0.3;
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
    background: var(--panel);
    border: 1px solid var(--line);
    box-shadow: 0 1px 2px rgba(34,37,44,0.06);
    padding: 18px 16px 16px;
    transition: border-color .14s, transform .06s, box-shadow .14s;
    overflow: hidden;
  }
  .ss-grid-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--indigo), transparent 65%);
    opacity: 0.4; transition: opacity .14s;
  }
  .ss-grid-card:hover { border-color: var(--indigo); box-shadow: 0 2px 8px rgba(34,37,44,0.12); }
  .ss-grid-card:hover::before { opacity: 1; }
  .ss-grid-card:active { transform: translateY(1px); }
  .ss-grid-ico { font-size: 22px; color: var(--indigo); margin-bottom: 8px; letter-spacing: 0; }
  .ss-grid-name { font-size: 14px; letter-spacing: 0.16em; color: var(--ink); font-family: var(--serif); font-weight: 700; }
  .ss-grid-desc { font-size: 11px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.05em; }
  .ss-grid-num {
    position: absolute; top: 10px; right: 12px;
    font-family: var(--mono); font-size: 11px; color: var(--ink-faint);
  }
  .ss-grid-main {
    grid-column: 1 / -1; padding: 20px 22px;
    display: flex; align-items: center; justify-content: space-between; gap: 18px;
    border-color: var(--ink); background: var(--panel-3);
  }
  .ss-grid-main::before { background: linear-gradient(90deg, var(--cinnabar), transparent 60%); opacity: 0.85; }
  .ss-grid-main:hover { border-color: var(--cinnabar); }
  .ss-grid-main .ss-grid-name { font-size: 19px; }
  .ss-grid-main .ss-grid-desc { font-size: 12px; color: var(--ink-dim); }
  .ss-grid-main .ss-btn { margin: 0; }

  /* ===== 任务简报行 ===== */
  .ss-brief { width: min(680px, 92vw); }
  .ss-brief-row {
    display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 16px;
    padding: 15px 18px; border: 1px solid var(--line); margin-bottom: 10px;
    background: var(--panel);
    box-shadow: 0 1px 2px rgba(34,37,44,0.05);
    cursor: pointer; transition: border-color .14s, transform .06s, box-shadow .14s;
  }
  .ss-brief-row:hover { border-color: var(--indigo); box-shadow: 0 2px 8px rgba(34,37,44,0.12); }
  .ss-brief-row:active { transform: translateY(1px); }
  .ss-brief-num {
    font-family: var(--mono); font-size: 22px; color: var(--ink-faint);
    font-weight: 700; text-align: center;
  }
  .ss-brief-name { font-size: 16px; letter-spacing: 0.12em; color: var(--ink); font-family: var(--serif); }
  .ss-brief-meta { font-size: 11.5px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.04em; font-family: var(--mono); }
  .ss-brief-cta {
    font-size: 12px; letter-spacing: 0.18em; color: var(--cinnabar);
    border: 1px solid var(--cinnabar); padding: 6px 16px; background: transparent;
    transition: background .14s, color .14s;
  }
  .ss-brief-row:hover .ss-brief-cta { background: var(--cinnabar); color: #fff; }

  /* ===== 强化界面模块 ===== */
  .fg-module {
    border: 1px solid var(--line); padding: 12px 16px; margin-bottom: 10px;
    background: var(--panel-2);
  }
  .fg-module-title {
    font-size: 12px; letter-spacing: 0.2em; color: var(--ink-dim);
    font-family: var(--mono); margin-bottom: 8px;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .fg-module-title b { color: var(--ink); font-family: var(--serif); font-weight: 700; font-size: 13.5px; letter-spacing: 0.14em; }
  .fg-btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .fg-btns .ss-btn { min-width: 0; padding: 7px 14px; font-size: 12px; letter-spacing: 0.12em; }

  /* ===== 进度条（强化/天赋等级可视化） ===== */
  .prog { height: 6px; background: var(--line-soft); position: relative; margin: 7px 0 9px; }
  .prog > div { height: 100%; background: linear-gradient(90deg, var(--indigo), var(--indigo-soft)); transition: width .18s ease; }
  .prog.full > div { background: linear-gradient(90deg, var(--ok), #7fae8d); }
  .lv-chip {
    display: inline-block; font-family: var(--mono); font-size: 10.5px; font-weight: 700;
    padding: 1px 8px; border: 1px solid var(--line); background: var(--panel-3); color: var(--ink-dim);
  }
  .lv-chip.hot { color: #fff; background: var(--cinnabar); border-color: var(--cinnabar); }

  /* 难度选择 */
  .ss-diff-row { display: flex; gap: 8px; justify-content: center; align-items: center; margin-bottom: 18px; font-size: 12px; color: var(--ink-dim); }
  .ss-diff-item {
    cursor: pointer; padding: 5px 18px; border: 1px solid var(--line); background: var(--panel);
    letter-spacing: 0.16em; font-size: 12.5px; color: var(--ink-dim);
    transition: all .12s;
  }
  .ss-diff-item:hover { border-color: var(--ink); color: var(--ink); }
  .ss-diff-item.active { color: #fff; border-color: var(--cinnabar); background: var(--cinnabar); }

  /* ===== HUD：白底墨字战斗面板（叠在亮色 3D 场景上清晰可读） ===== */
  #ss-hud {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
    pointer-events: none; padding: 0 26px 20px;
    color: var(--ink);
  }
  .hud-weapon {
    font-size: 14px; letter-spacing: 0.16em; color: var(--ink); margin-bottom: 5px;
    font-family: var(--mono); font-weight: 600;
    background: rgba(255,255,255,0.85); display: inline-block;
    padding: 4px 10px; border: 1px solid rgba(34,37,44,0.14);
    box-shadow: 0 1px 3px rgba(34,37,44,0.15);
  }
  .hud-wave {
    font-size: 11px; letter-spacing: 0.12em; color: var(--ink-dim); margin-bottom: 10px; font-family: var(--mono); font-weight: 600;
    background: rgba(255,255,255,0.85); display: inline-block;
    padding: 3px 8px; border: 1px solid rgba(34,37,44,0.1);
  }
  .bar {
    height: 10px; border: 1px solid rgba(34,37,44,0.35); background: rgba(255,255,255,0.78);
    position: relative;
  }
  .bar > div { height: 100%; transform-origin: left center; transition: transform .09s linear; }
  .bar.hp > div { background: linear-gradient(90deg, #8a2d22, var(--cinnabar)); }
  .bar.energy > div { background: linear-gradient(90deg, #274a6e, var(--indigo)); }
  .bar.bossbar { width: 380px; height: 12px; }
  .bar.bossbar > div { background: linear-gradient(90deg, #6b5a1e, var(--amber)); }
  .hud-label { color: var(--ink-dim); font-size: 10px; letter-spacing: 0.22em; margin-bottom: 3px; font-family: var(--mono); font-weight: 600; }
  .hud-num { color: var(--ink); font-size: 12.5px; margin-top: 3px; letter-spacing: 0.06em; font-family: var(--mono); font-variant-numeric: tabular-nums; font-weight: 600; }
  #ss-boss-wrap { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 15; text-align: center; }
  #ss-boss-wrap.hidden { display: none; }
  #ss-boss-name {
    color: var(--ink); font-size: 14px; letter-spacing: 0.3em; margin-bottom: 5px; font-family: var(--serif); font-weight: 700;
    background: rgba(255,255,255,0.88); display: inline-block; padding: 4px 14px;
    border: 1px solid rgba(34,37,44,0.14); box-shadow: 0 1px 3px rgba(34,37,44,0.12);
  }

  /* 准星：墨色 + 白描边（亮暗场景都可读） */
  #ss-crosshair { position: fixed; left: 50%; top: 50%; z-index: 16; pointer-events: none; }
  #ss-crosshair .ch-piece, #ss-crosshair .ch-dot {
    position: absolute;
    background: var(--ink); box-shadow: 0 0 0 1px rgba(255,255,255,0.85);
  }
  #ss-crosshair .ch-ring {
    position: absolute; left: -10px; top: -10px; width: 20px; height: 20px;
    border: 1px solid var(--ink); border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.85); display: none;
  }
  #ss-crosshair.hit .ch-piece, #ss-crosshair.hit .ch-dot {
    background: var(--cinnabar); box-shadow: 0 0 0 1px rgba(255,255,255,0.9);
  }

  /* 技能面板 */
  #ss-skills {
    position: fixed; right: 22px; bottom: 18px; z-index: 15; pointer-events: none;
    text-align: right; background: rgba(255,255,255,0.88);
    border: 1px solid rgba(34,37,44,0.1); border-left: 2px solid var(--indigo); padding: 10px 16px;
    box-shadow: 0 1px 3px rgba(34,37,44,0.12);
  }
  .sk-title { font-size: 10px; letter-spacing: 0.3em; color: var(--ink-faint); margin-bottom: 6px; font-family: var(--mono); }
  .sk-line { font-size: 12px; color: var(--ink); letter-spacing: 0.08em; line-height: 1.9; font-variant-numeric: tabular-nums; }
  .sk-line b { font-weight: 600; color: var(--indigo); }
  .sk-line .kbd { border: 1px solid #c4c1b8; background: #fff; padding: 0 6px; margin-right: 6px; font-size: 11px; color: var(--ink-dim); font-family: var(--mono); }

  /* 受击红晕 */
  #ss-damage-vignette {
    position: fixed; inset: 0; z-index: 14; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 55%, rgba(192,69,53,0.42));
    opacity: 0; transition: opacity .08s ease;
  }
  #ss-damage-vignette.on { opacity: 1; }

  /* 战斗画面压角：轻收边（不遮画面信息） */
  #ss-grade {
    position: fixed; inset: 0; z-index: 12; pointer-events: none;
    background:
      radial-gradient(ellipse 82% 76% at 50% 44%, rgba(0,0,0,0) 55%, rgba(20,24,30,0.26) 100%),
      linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0) 16%);
  }
  #ss-webgl { position: fixed; inset: 0; z-index: 0; }
  #ss-webgl canvas { filter: saturate(1.08) contrast(1.04); }
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
