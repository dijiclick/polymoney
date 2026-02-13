/**
 * SofaScore NATS WebSocket Adapter
 * DISABLED: Requires NKey authentication since Feb 2026
 * Kept for future use if auth token can be obtained
 */
import type { IFilterableAdapter, AdapterStatus, UpdateCallback } from '../adapter.interface.js';
import type { SofaScoreAdapterConfig } from '../../types/config.js';
import type { TargetEvent } from '../../types/target-event.js';
import { TargetEventFilter } from '../../matching/target-filter.js';
import { createLogger } from '../../util/logger.js';

const log = createLogger('sofascore');

export class SofaScoreAdapter implements IFilterableAdapter {
  readonly sourceId = 'sofascore';
  private callback: UpdateCallback | null = null;
  private status: AdapterStatus = 'idle';
  private targetFilter: TargetEventFilter;

  constructor(_config: SofaScoreAdapterConfig) {
    this.targetFilter = new TargetEventFilter(0.75);
  }

  setTargetFilter(targets: TargetEvent[]): void { this.targetFilter.setTargets(targets); }
  onUpdate(callback: UpdateCallback): void { this.callback = callback; }
  getStatus(): AdapterStatus { return this.status; }

  async start(): Promise<void> {
    log.warn('SofaScore adapter disabled — NATS requires NKey auth');
    this.status = 'stopped';
  }

  async stop(): Promise<void> {
    this.status = 'stopped';
  }
}
