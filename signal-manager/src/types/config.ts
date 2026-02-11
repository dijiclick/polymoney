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
  };
  dashboard: DashboardConfig;
  matcher: MatcherConfig;
  cleanupIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
