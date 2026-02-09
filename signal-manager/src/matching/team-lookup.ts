import { readFileSync, existsSync } from 'node:fs';
import { createLogger } from '../util/logger.js';

const log = createLogger('team-lookup');

// Format: { "canonical_name": { "source:raw_name": true, ... } }
interface TeamMappingsFile {
  [canonicalName: string]: {
    [sourceAndRawName: string]: true;
  };
}

export class TeamLookup {
  // "source:rawname_lowercase" → "canonical_name"
  private lookup: Map<string, string> = new Map();

  loadFromFile(path: string): void {
    if (!existsSync(path)) {
      log.warn(`Team mappings file not found: ${path}`);
      return;
    }

    try {
      const raw = readFileSync(path, 'utf-8');
      const data: TeamMappingsFile = JSON.parse(raw);
      let count = 0;

      for (const canonical in data) {
        const aliases = data[canonical];
        for (const key in aliases) {
          this.lookup.set(key.toLowerCase(), canonical);
          count++;
        }
      }

      log.info(`Loaded ${count} team mappings for ${Object.keys(data).length} teams`);
    } catch (err) {
      log.error('Failed to load team mappings', err);
    }
  }

  resolve(source: string, rawName: string): string | null {
    return this.lookup.get(`${source}:${rawName.toLowerCase()}`) || null;
  }

  // Learn a new mapping at runtime (from fuzzy match results)
  cache(source: string, rawName: string, canonical: string): void {
    const key = `${source}:${rawName.toLowerCase()}`;
    if (!this.lookup.has(key)) {
      this.lookup.set(key, canonical);
      log.debug(`Cached team mapping: ${key} → ${canonical}`);
    }
  }

  get size(): number {
    return this.lookup.size;
  }
}
