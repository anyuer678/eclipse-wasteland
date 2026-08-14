/**
 * play/controller — 第一人称控制器。
 *
 * 只有相机（视角），不渲染玩家身体——所见即武器（viewmodel）。
 * 负责：鼠标视角旋转、WASD 移动、跳跃、竞技场边界约束。
 * 位置由控制器持有并暴露给武器/敌人/相机。
 */
import * as THREE from 'three';
import { clamp } from '../core';
import type { InputSnapshot } from './input';

export interface ControllerOptions {
  speed: number;
  jumpSpeed: number;
  gravity: number;
  eyeHeight: number;
  boundRadius: number; // 活动半径（圆形竞技场）
  /** 地形高度查询（x,z → 地面 y），实现 z 轴起伏与可跳平台 */
  terrainHeight: (x: number, z: number) => number;
  /** 障碍碰撞（移动后推回，防穿模） */
  collide?: (p: { x: number; y: number; z: number }) => void;
}

export class PlayerController {
  position = new THREE.Vector3(0, 0, 0);
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  /** 移速倍率（BUFF/属性加成） */
  speedMult = 1;
  /** 地形高度查询（供敌人等外部使用） */
  readonly terrainHeight: (x: number, z: number) => number;
  /** 障碍碰撞（供敌人等外部使用） */
  readonly collide: (p: { x: number; y: number; z: number }) => void;

  private readonly opts: ControllerOptions;

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.terrainHeight = opts.terrainHeight;
    this.collide = opts.collide ?? (() => {});
  }

  /** 每逻辑帧推进 */
  update(input: InputSnapshot, dt: number): void {
    const o = this.opts;

    // 视角（由外部喂入鼠标增量，避免依赖 Input 直接引用）
    // 注意：yaw/pitch 由 look() 更新，这里只做位移

    // 水平移动（基于当前朝向）
    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = forward * -sin + strafe * cos;
    const wishZ = forward * -cos + strafe * -sin;
    const len = Math.hypot(wishX, wishZ);
    if (len > 0) {
      const s = o.speed * this.speedMult;
      this.velocity.x = (wishX / len) * s;
      this.velocity.z = (wishZ / len) * s;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // 跳跃与重力
    if (input.jump && this.onGround) {
      this.velocity.y = o.jumpSpeed;
      this.onGround = false;
    }
    this.velocity.y -= o.gravity * dt;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // 障碍碰撞（防穿模推回）
    if (this.opts.collide) {
      this.opts.collide(this.position);
    }

    // 落地（地形高度：平地 0 / 平台高度；仅下降时判定，避免上升穿透）
    const ground = this.opts.terrainHeight(this.position.x, this.position.z);
    if (this.position.y <= ground && this.velocity.y <= 0) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this.position.y <= ground) {
      // 上升中位于平台内部：顶起（爬升感）
      this.position.y = ground;
    } else {
      this.onGround = false;
    }

    // 圆形边界约束
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > o.boundRadius) {
      const scale = o.boundRadius / r;
      this.position.x *= scale;
      this.position.z *= scale;
    }
  }

  /** 应用鼠标增量（度），clamp 俯仰角 */
  look(dxPx: number, dyPx: number, sensitivity = 0.12): void {
    this.yaw = (this.yaw - dxPx * sensitivity * 0.01) % (Math.PI * 2);
    this.pitch = clamp(this.pitch - dyPx * sensitivity * 0.01, -1.5, 1.5);
  }

  /** 相机位置（眼睛高度） */
  eye(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.opts.eyeHeight, this.position.z);
  }
}
