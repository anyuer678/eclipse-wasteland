/**
 * debug/queries — `window.__ss` 的只读查询（从 game.ts 抽出的纯映射）。
 *
 * 只读取外部传入的 getter/对象，不持有游戏状态；便于单测与后续拆分。
 */
export interface QueryEnemy {
  def: { kind: string; radius: number; hp: number };
  root: { position: { x: number; y: number; z: number } };
  hp: number;
  alive: boolean;
  elite: unknown;
  slowTimer: number;
  burnTimer: number;
  isStunned(): boolean;
}

export interface QueryPlayer {
  position: { x: number; y: number; z: number };
  onGround: boolean;
  terrainHeight(x: number, z: number): number;
}

export interface MapLike {
  userData: Record<string, unknown>;
}

export interface QueryChest {
  mesh: { position: { x: number; y: number; z: number } };
  reward: string;
  amount: number;
}

export interface QueryCrate {
  x: number;
  z: number;
  alive: boolean;
}

export interface QueryObstacle {
  x: number;
  z: number;
  hw: number;
  hd: number;
  top: number;
  crate?: boolean;
}

export interface QueryNav {
  ready: boolean;
  cell: number;
  obstacles: readonly QueryObstacle[];
}

export interface QueryDeps {
  enemies: () => readonly QueryEnemy[];
  player: QueryPlayer;
  mapRoot: () => MapLike | null;
  chests: () => readonly QueryChest[];
  crates: () => readonly QueryCrate[];
  nav: () => QueryNav;
}

export function enemyHealths(deps: QueryDeps): { hp: number; max: number; alive: boolean }[] {
  return deps.enemies().map((e) => ({ hp: Math.max(0, Math.ceil(e.hp)), max: e.def.hp, alive: e.alive }));
}

export function enemyMotion(deps: QueryDeps): {
  kind: string;
  x: number;
  y: number;
  z: number;
  ground: number;
  dist: number;
  radius: number;
  alive: boolean;
  stunned: boolean;
  elite: boolean;
  slow: boolean;
  burn: boolean;
}[] {
  const p = deps.player;
  return deps.enemies().map((e) => {
    const pos = e.root.position;
    return {
      kind: e.def.kind,
      radius: e.def.radius,
      x: +pos.x.toFixed(2),
      y: +pos.y.toFixed(2),
      z: +pos.z.toFixed(2),
      ground: +p.terrainHeight(pos.x, pos.z).toFixed(2),
      dist: +Math.hypot(pos.x - p.position.x, pos.z - p.position.z).toFixed(2),
      alive: e.alive,
      stunned: e.isStunned(),
      elite: !!e.elite,
      slow: e.slowTimer > 0,
      burn: e.burnTimer > 0,
    };
  });
}

export function playerPos(deps: QueryDeps): { x: number; y: number; z: number; ground: number; onGround: boolean } {
  const p = deps.player;
  return {
    x: +p.position.x.toFixed(2),
    y: +p.position.y.toFixed(2),
    z: +p.position.z.toFixed(2),
    ground: +p.terrainHeight(p.position.x, p.position.z).toFixed(2),
    onGround: p.onGround,
  };
}

export function poolsInfo(deps: QueryDeps): { x: number; z: number; r: number; ground: number }[] {
  const root = deps.mapRoot();
  const pools = (root?.userData.poisonPools ?? []) as { x: number; z: number; r: number }[];
  return pools.map((p) => ({
    x: +p.x.toFixed(2),
    z: +p.z.toFixed(2),
    r: +p.r.toFixed(2),
    // 统一用地形高度（含平台/斜坡），与宝箱/木箱口径一致
    ground: +deps.player.terrainHeight(p.x, p.z).toFixed(2),
  }));
}

export function chestsInfo(deps: QueryDeps): { x: number; y: number; z: number; ground: number; reward: string; amount: number }[] {
  return deps.chests().map((c) => {
    const pos = c.mesh.position;
    return {
      x: +pos.x.toFixed(2),
      y: +pos.y.toFixed(2),
      z: +pos.z.toFixed(2),
      ground: +deps.player.terrainHeight(pos.x, pos.z).toFixed(2),
      reward: c.reward,
      amount: c.amount,
    };
  });
}

export function cratesInfo(deps: QueryDeps): { x: number; z: number; alive: boolean; ground: number }[] {
  return deps.crates().map((c) => ({
    x: c.x,
    z: c.z,
    alive: c.alive,
    ground: +deps.player.terrainHeight(c.x, c.z).toFixed(2),
  }));
}

export function navInfo(deps: QueryDeps): { ready: boolean; obstacles: number; cell: number } {
  const nav = deps.nav();
  return { ready: nav.ready, obstacles: nav.obstacles.length, cell: nav.cell };
}

export function obstaclesDump(deps: QueryDeps): { x: number; z: number; hw: number; hd: number; top: number; crate: boolean }[] {
  return deps.nav().obstacles.map((o) => ({ x: o.x, z: o.z, hw: o.hw, hd: o.hd, top: +o.top.toFixed(2), crate: !!o.crate }));
}
