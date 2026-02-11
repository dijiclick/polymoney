import type { IAdapter, AdapterStatus } from './adapter.interface.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('adapter-registry');

export class AdapterRegistry {
  private adapters: Map<string, IAdapter> = new Map();

  register(adapter: IAdapter): void {
    if (this.adapters.has(adapter.sourceId)) {
      throw new Error(`Adapter "${adapter.sourceId}" already registered`);
    }
    this.adapters.set(adapter.sourceId, adapter);
    log.info(`Registered adapter: ${adapter.sourceId}`);
  }

  unregister(sourceId: string): void {
    this.adapters.delete(sourceId);
  }

  async startAll(): Promise<void> {
    const startPromises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      log.info(`Starting adapter: ${id}`);
      startPromises.push(
        adapter.start().catch((err) => {
          log.error(`Failed to start adapter "${id}"`, err);
        })
      );
    }
    await Promise.all(startPromises);
  }

  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      log.info(`Stopping adapter: ${id}`);
      stopPromises.push(
        adapter.stop().catch((err) => {
          log.error(`Failed to stop adapter "${id}"`, err);
        })
      );
    }
    await Promise.all(stopPromises);
  }

  getStatuses(): Map<string, AdapterStatus> {
    const statuses = new Map<string, AdapterStatus>();
    for (const [id, adapter] of this.adapters) {
      statuses.set(id, adapter.getStatus());
    }
    return statuses;
  }

  async startAllExcept(excludeSourceId: string): Promise<void> {
    const startPromises: Promise<void>[] = [];
    for (const [id, adapter] of this.adapters) {
      if (id === excludeSourceId) continue;
      log.info(`Starting adapter: ${id}`);
      startPromises.push(
        adapter.start().catch((err) => {
          log.error(`Failed to start adapter "${id}"`, err);
        })
      );
    }
    await Promise.all(startPromises);
  }

  getAll(): IAdapter[] {
    return Array.from(this.adapters.values());
  }

  get(sourceId: string): IAdapter | undefined {
    return this.adapters.get(sourceId);
  }

  get size(): number {
    return this.adapters.size;
  }
}
