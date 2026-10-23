/**
 * render/lootModels — 局内拾取物与角色技能的占位模型（程序化几何）。
 *
 * 只负责几何/材质/局部位置；落点、动画与回收由 game 侧处理。
 */
import * as THREE from 'three';

/** BUFF 球：悬浮二十面体（父 Group 由落点定位） */
export function buildOrbMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial({ color }));
  core.position.y = 0.9;
  g.add(core);
  return g;
}

/** 补给宝箱：箱体 + 盖 + 顶部亮点（大箱金色） */
export function buildChestMesh(big: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: big ? 0xd9a44a : 0x8a7a5a, roughness: 0.5, metalness: 0.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5), mat);
  box.position.y = 0.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.5), mat);
  lid.position.y = 0.57;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  glow.position.y = 0.75;
  g.add(box, lid, glow);
  return g;
}

/** 召唤机甲分身（程序化小机器人） */
export function buildSummonMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), mat);
  body.position.y = 0.55;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat);
  head.position.y = 0.95;
  g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: 0x66e0ff }));
  eye.position.set(0, 0.95, 0.12);
  g.add(eye);
  g.userData.summon = true;
  return g;
}

/** 角色技能地面环（炼狱/治疗共用），已放平 */
export function buildRoleRing(color: number, inner: number, outer: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  return ring;
}
