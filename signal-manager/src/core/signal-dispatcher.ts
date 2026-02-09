import type { UnifiedEvent } from '../types/unified-event.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('signal-dispatcher');

export type SignalFunction = (
  event: UnifiedEvent,
  changedKeys: string[],
  source: string
) => void;

export class SignalDispatcher {
  private signals: SignalFunction[] = [];

  register(fn: SignalFunction): void {
    this.signals.push(fn);
    log.info(`Signal registered (total: ${this.signals.length})`);
  }

  unregister(fn: SignalFunction): void {
    const idx = this.signals.indexOf(fn);
    if (idx !== -1) {
      this.signals.splice(idx, 1);
    }
  }

  emit(event: UnifiedEvent, changedKeys: string[], source: string): void {
    for (let i = 0; i < this.signals.length; i++) {
      try {
        this.signals[i](event, changedKeys, source);
      } catch (err) {
        log.error('Signal function threw', err);
      }
    }
  }

  get count(): number {
    return this.signals.length;
  }
}
