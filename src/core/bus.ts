/**
 * core/bus — 类型化事件总线。
 *
 * 系统之间不互相 import，只通过事件解耦：一个系统 emit，
 * 订阅方收到载荷。事件映射类型 M 约束事件名与载荷一一对应。
 */
export type EventMap = Record<string, unknown>;

export type Listener<P> = (payload: P) => void;

export class EventBus<M extends EventMap> {
  private listeners = new Map<keyof M, Set<Listener<never>>>();

  on<K extends keyof M>(name: K, fn: Listener<M[K]>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(name, fn);
  }

  once<K extends keyof M>(name: K, fn: Listener<M[K]>): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof M>(name: K, fn: Listener<M[K]>): void {
    this.listeners.get(name)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      (fn as Listener<M[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
