/**
 * render/envConfig — 各地图的开源环境素材配置（数据表，从 game.ts 拆出）。
 *
 * 只放数据与类型，使用方按 mapId 取模型列表与染色。
 */
export interface EnvModelSpec {
  name: string;
  count: number;
  scale: [number, number];
  y: number;
}

export const ENV_MODELS: Record<string, EnvModelSpec[]> = {
  facility: [
    { name: 'env/env_rockSmall', count: 7, scale: [1.6, 3], y: 0 },
    { name: 'env/env_log', count: 5, scale: [1.8, 3], y: 0.25 },
    { name: 'env/env_bush', count: 9, scale: [0.35, 0.62], y: 0.02 }, // 地表草丛（小、不抢眼）
  ],
  quarry: [
    { name: 'env/env_rockA', count: 7, scale: [2.2, 4.2], y: 0 },
    { name: 'env/env_rockB', count: 6, scale: [2.2, 4.2], y: 0 },
    { name: 'env/env_rockTall', count: 4, scale: [2.2, 3.6], y: 0 },
    { name: 'env/env_log', count: 3, scale: [1.8, 3.2], y: 0.25 },
    { name: 'env/env_bush', count: 9, scale: [0.35, 0.6], y: 0.02 },
  ],
  lab: [
    { name: 'env/env_treePine', count: 6, scale: [2.0, 3.2], y: 0 },
    { name: 'env/env_treeDefault', count: 5, scale: [1.9, 2.9], y: 0 },
    { name: 'env/env_rockSmall', count: 6, scale: [1.6, 3], y: 0 },
    { name: 'env/env_bush', count: 10, scale: [0.35, 0.6], y: 0.02 },
  ],
  canyon: [
    { name: 'env/env_rockA', count: 8, scale: [2.4, 4.4], y: 0 },
    { name: 'env/env_rockSmall', count: 6, scale: [1.6, 3], y: 0 },
    { name: 'env/env_bush', count: 8, scale: [0.35, 0.6], y: 0.02 },
  ],
};

/** 开源环境素材的地图化配色（压掉 Kenney 原色的荧光感） */
export const ENV_TINT: Record<string, number> = {
  facility: 0x5f7a45,
  quarry: 0x7a6a48,
  lab: 0x4d7a5c,
  volcano: 0x5a3a2a,
  ice: 0x6d8296,
  canyon: 0x8a6a48,
};
