/**
 * eclipse-wasteland 轻量入口（内部代号：荒原防线）
 *
 * 只负责三件事：引入全局样式 → 渲染启动加载屏 → 异步加载游戏主模块（src/game.ts）。
 * three.js 引擎与全部游戏逻辑都在异步 chunk 里，首屏初始包只有 KB 级，
 * 大体积资源在加载屏后面并行下载（分包见 vite.config.ts 的 advancedChunks）。
 */
import './style.css';

const showFatal = (msg: string): void => {
  const loading = document.getElementById('boot-loading');
  if (loading) {
    loading.innerHTML =
      '<div style="max-width:80vw;white-space:pre-wrap;color:#ff8877;font:13px/1.7 monospace;">[加载失败] ' +
      String(msg).slice(0, 300) +
      '</div>';
  }
};

const mount = document.getElementById('app');
if (!mount) throw new Error('missing #app mount');

// 启动加载屏：挂在 body 上（不占用 #app，游戏 canvas 由 World 追加进 #app）
const loading = document.createElement('div');
loading.id = 'boot-loading';
loading.style.cssText =
  'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
  'background:#0a0c10;color:#e8c377;font:bold 13px/1.6 Consolas,monospace;letter-spacing:.3em;';
loading.innerHTML =
  '<div style="font-size:32px;color:#ffd700;text-shadow:0 0 24px rgba(255,215,0,.35);">ECLIPSE</div>' +
  '<div>荒原防线 · 加载中</div>' +
  '<div style="width:180px;height:3px;background:#22262e;border-radius:2px;overflow:hidden;">' +
  '<div style="width:45%;height:100%;background:linear-gradient(90deg,#d9a44a,#c94f3d);animation:boot-bar 1.1s ease-in-out infinite;"></div></div>';
const barAnim = document.createElement('style');
barAnim.textContent = '@keyframes boot-bar{0%{transform:translateX(-110%)}100%{transform:translateX(230%)}}';
document.head.appendChild(barAnim);
document.body.appendChild(loading);

import('./game')
  .then(() => {
    loading.remove();
    barAnim.remove();
  })
  .catch((err: unknown) => showFatal(err instanceof Error ? err.message : String(err)));
