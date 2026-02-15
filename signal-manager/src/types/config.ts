export interface PolymarketAdapterConfig {
  enabled: boolean;
  clobWsUrl: string;
  scoresWsUrl: string;
  gammaApiUrl: string;
  pingIntervalMs: number;
  discoveryIntervalMs: number;
}

export interface OnexbetAdapterConfig {
  enabled: boolean;
  liveFeedBaseUrl: string;
  pollIntervalMs: number;
  sportIds: number[];
}

export interface FlashScoreAdapterConfig {
  enabled: boolean;
  pollIntervalMs: number;
  leagues: { sport: string; fsPath: string; name: string }[];
}

export interface KambiAdapterConfig {
  enabled: boolean;
  baseUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface TheSportsAdapterConfig {
  enabled: boolean;
  mqttUrl: string;
  sportIds: number[];
  discoveryIntervalMs: number;
}

export interface SofaScoreAdapterConfig {
  enabled: boolean;
  wsUrl: string;
  sports: string[];
  includeOdds: boolean;
  discoveryIntervalMs: number;
}

export interface PinnacleAdapterConfig {
  enabled: boolean;
  baseUrl: string;
  pollIntervalMs: number;
  timeoutMs: number;
  sportIds: number[];
}

export interface Bet365AdapterConfig {
  enabled: boolean;
  cdpPort?: number;
}

export interface DashboardConfig {
  enabled: boolean;
  port: number;
}

export interface MatcherConfig {
  fuzzyThreshold: number;
  crossSourceThreshold: number;  // Higher threshold for global cross-source matching (avoids false positives)
  kickoffToleranceMs: number;
  teamMappingsPath: string;
}

export interface Config {
  adapters: {
    polymarket: PolymarketAdapterConfig;
    onexbet: OnexbetAdapterConfig;
    flashscore: FlashScoreAdapterConfig;
    kambi: KambiAdapterConfig;
    thesports: TheSportsAdapterConfig;
    sofascore: SofaScoreAdapterConfig;
    pinnacle: PinnacleAdapterConfig;
    bet365: Bet365AdapterConfig;
  };
  dashboard: DashboardConfig;
  matcher: MatcherConfig;
  cleanupIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
