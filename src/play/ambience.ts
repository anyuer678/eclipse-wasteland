/**
 * play/ambience — 各地图的背景音乐情绪（根音 + 音阶）。
 *
 * 单独成表并导出，便于用单测保证「每张地图都配了情绪」，避免新增地图时
 * 沿用上一张图的 BGM。
 */
export type Mood = [root: number, scale: number[]];

export const MOODS: Record<string, Mood> = {
  facility: [55, [0, 3, 5, 7, 10]],
  quarry: [49, [0, 3, 5, 7, 10]],
  lab: [65.41, [0, 3, 5, 7, 10]],
  volcano: [43.65, [0, 1, 5, 7, 8]],
  ice: [82.41, [0, 2, 4, 7, 9]],
  canyon: [73.42, [0, 2, 3, 7, 10]],
};
