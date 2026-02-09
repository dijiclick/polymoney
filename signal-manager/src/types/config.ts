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

export interface MatcherConfig {
  fuzzyThreshold: number;
  kickoffToleranceMs: number;
  teamMappingsPath: string;
}

export interface Config {
  adapters: {
    polymarket: PolymarketAdapterConfig;
    onexbet: OnexbetAdapterConfig;
  };
  matcher: MatcherConfig;
  cleanupIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
