import type { AdapterEventUpdate } from '../types/adapter-update.js';

export type AdapterStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'stopped';

export type UpdateCallback = (update: AdapterEventUpdate) => void;

export interface IAdapter {
  readonly sourceId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onUpdate(callback: UpdateCallback): void;
  getStatus(): AdapterStatus;
}
