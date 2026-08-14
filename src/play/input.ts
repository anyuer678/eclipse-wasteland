/**
 * play/input — 键盘鼠标输入状态采集。
 *
 * 鼠标指针锁定用于第一人称视角；按键状态以 Set 保存，
 * 供控制器每帧查询。不绑定具体动作，只记录原始状态。
 */
export interface InputSnapshot {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  fire: boolean; // 鼠标左键
  altFire: boolean; // 鼠标右键
  skill: boolean; // E 键
  key: (name: string) => boolean;
}

export class Input {
  private keys = new Set<string>();
  private mouseDown = new Set<number>();
  private mx = 0;
  private my = 0;

  /** 绑定到目标元素，开始采集（并锁定指针） */
  attach(target: HTMLElement): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.mouseDown.add(e.button);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseDown.delete(e.button);
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.mx += e.movementX;
    this.my += e.movementY;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** 每逻辑帧调用一次：取增量并清零 */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mx, dy: this.my };
    this.mx = 0;
    this.my = 0;
    return d;
  }

  pressed(code: string): boolean {
    return this.keys.has(code);
  }

  mouseButton(button: number): boolean {
    return this.mouseDown.has(button);
  }

  snapshot(): InputSnapshot {
    return {
      forward: this.pressed('KeyW') || this.pressed('ArrowUp'),
      back: this.pressed('KeyS') || this.pressed('ArrowDown'),
      left: this.pressed('KeyA') || this.pressed('ArrowLeft'),
      right: this.pressed('KeyD') || this.pressed('ArrowRight'),
      jump: this.pressed('Space'),
      fire: this.mouseButton(0),
      altFire: this.mouseButton(2),
      skill: this.pressed('KeyE'),
      key: (n) => this.pressed(n),
    };
  }
}
