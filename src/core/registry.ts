/**
 * core/registry — 服务注册表。
 *
 * 系统通过字符串标识注册/获取服务，避免互相 import 造成循环依赖。
 * 与 EventBus 配合：总线负责消息流，注册表负责能力发现。
 */
export type ServiceId = string;

export interface Registry {
  register<T>(id: ServiceId, svc: T): void;
  get<T>(id: ServiceId): T;
  has(id: ServiceId): boolean;
}

export class ServiceRegistry implements Registry {
  private services = new Map<ServiceId, unknown>();

  register<T>(id: ServiceId, svc: T): void {
    if (this.services.has(id)) {
      throw new Error(`service already registered: ${id}`);
    }
    this.services.set(id, svc);
  }

  get<T>(id: ServiceId): T {
    const svc = this.services.get(id);
    if (svc === undefined) {
      throw new Error(`service not registered: ${id}`);
    }
    return svc as T;
  }

  has(id: ServiceId): boolean {
    return this.services.has(id);
  }

  /** 允许覆盖注册（用于测试注入替身） */
  registerOrReplace<T>(id: ServiceId, svc: T): void {
    this.services.set(id, svc);
  }
}
