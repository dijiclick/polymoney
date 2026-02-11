import type { AdapterEventUpdate } from '../types/adapter-update.js';
import type { TargetEvent } from '../types/target-event.js';

export type AdapterStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';

export type UpdateCallback = (update: AdapterEventUpdate) => void;

export interface IAdapter {
  readonly sourceId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onUpdate(callback: UpdateCallback): void;
  getStatus(): AdapterStatus;
}

export interface IFilterableAdapter extends IAdapter {
  setTargetFilter(targets: TargetEvent[]): void;
}

export function isFilterableAdapter(adapter: IAdapter): adapter is IFilterableAdapter {
  return 'setTargetFilter' in adapter;
}
