import type { UnifiedEvent, EventStats } from '../types/unified-event.js';
import type { AdapterEventUpdate } from '../types/adapter-update.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('state-store');

const SWEEP_GRACE_MS = 5 * 60 * 1000; // Keep ended events for 5 min

export class StateStore {
  private events: Map<string, UnifiedEvent> = new Map();

  update(eventId: string, update: AdapterEventUpdate): { event: UnifiedEvent; changedKeys: string[] } {
    let event = this.events.get(eventId);
    const changedKeys: string[] = [];

    if (!event) {
      event = this.createEvent(eventId, update);
      this.events.set(eventId, event);
      for (let i = 0; i < update.markets.length; i++) {
        changedKeys.push(update.markets[i].key);
      }
    } else {
      // Merge markets in-place
      for (let i = 0; i < update.markets.length; i++) {
        const m = update.markets[i];
        let bucket = event.markets[m.key];
        if (!bucket) {
          bucket = {};
          event.markets[m.key] = bucket;
        }
        const existing = bucket[update.sourceId];
        if (!existing || existing.value !== m.value) {
          changedKeys.push(m.key);
        }
        // In-place: reuse or create SourceOdds
        if (existing) {
          existing.value = m.value;
          existing.timestamp = update.timestamp;
        } else {
          bucket[update.sourceId] = { value: m.value, timestamp: update.timestamp };
        }
        // Store Polymarket token IDs
        if (m.tokenId) {
          event._tokenIds[m.key] = m.tokenId;
        }
      }

      // Merge stats in-place
      if (update.stats) {
        const s = update.stats;
        if (s.score) {
          const prev = event.stats.score;
          const scoreChanged = !prev || prev.home !== s.score.home || prev.away !== s.score.away;
          const sourceChanged = event._lastScoreSource && event._lastScoreSource !== update.sourceId;

          // Emit __score if the actual score changed OR if the same score arrives
          // from a different source (critical: PM WebSocket can set score before 1xBet poll,
          // and GoalTrader only acts on non-PM sources)
          if (scoreChanged || sourceChanged) {
            changedKeys.push('__score');
            // Save previous score for goal classification (only when score actually changed)
            if (scoreChanged && prev) {
              event._prevScore = { home: prev.home, away: prev.away };
            }
          }
          event.stats.score = s.score;
          event._lastScoreSource = update.sourceId;
        }
        if (s.period !== undefined) event.stats.period = s.period;
        if (s.elapsed !== undefined) event.stats.elapsed = s.elapsed;
        // Copy any other sport-specific stats
        for (const key in s) {
          if (key !== 'score' && key !== 'period' && key !== 'elapsed') {
            event.stats[key] = s[key as keyof EventStats];
          }
        }
      }

      if (update.status) {
        event.status = update.status;
      }

      // Merge aliases
      event.home.aliases[update.sourceId] = update.homeTeam;
      event.away.aliases[update.sourceId] = update.awayTeam;

      // Store Polymarket slug if available
      if (update.sourceEventSlug && !event.polymarketSlug) {
        event.polymarketSlug = update.sourceEventSlug;
      }
    }

    event._lastUpdate = Date.now();
    return { event, changedKeys };
  }

  private createEvent(eventId: string, update: AdapterEventUpdate): UnifiedEvent {
    const markets: UnifiedEvent['markets'] = {};
    const tokenIds: Record<string, string> = {};
    for (let i = 0; i < update.markets.length; i++) {
      const m = update.markets[i];
      markets[m.key] = {
        [update.sourceId]: { value: m.value, timestamp: update.timestamp },
      };
      if (m.tokenId) {
        tokenIds[m.key] = m.tokenId;
      }
    }

    return {
      id: eventId,
      sport: update.sport,
      league: update.league,
      startTime: update.startTime,
      status: update.status || 'scheduled',
      home: {
        name: '', // Will be set by matcher
        aliases: { [update.sourceId]: update.homeTeam },
      },
      away: {
        name: '',
        aliases: { [update.sourceId]: update.awayTeam },
      },
      stats: update.stats ? { ...update.stats } : {},
      markets,
      _tokenIds: tokenIds,
      polymarketSlug: update.sourceEventSlug,
      _lastUpdate: Date.now(),
    };
  }

  sweep(): number {
    const now = Date.now();
    let swept = 0;
    for (const [id, event] of this.events) {
      if (event.status === 'ended' && now - event._lastUpdate > SWEEP_GRACE_MS) {
        this.events.delete(id);
        swept++;
      }
    }
    if (swept > 0) {
      log.debug(`Swept ${swept} ended events (remaining: ${this.events.size})`);
    }
    return swept;
  }

  get(id: string): UnifiedEvent | undefined {
    return this.events.get(id);
  }

  getAll(): UnifiedEvent[] {
    return Array.from(this.events.values());
  }

  get size(): number {
    return this.events.size;
  }
}
