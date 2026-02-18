import 'dotenv/config';

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function optEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

export const config = {
  // Supabase
  SUPABASE_URL: env('SUPABASE_URL'),
  SUPABASE_KEY: env('SUPABASE_SERVICE_KEY'),

  // Alchemy (WebSocket)
  ALCHEMY_API_KEY: env('ALCHEMY_API_KEY'),

  // Etherscan v2 (backup)
  ETHERSCAN_API_KEY: env('ETHERSCAN_API_KEY'),

  // Perplexity Sonar (optional until Tier 2 active)
  PERPLEXITY_API_KEY: optEnv('PERPLEXITY_API_KEY'),

  // Brave Search (future)
  BRAVE_API_KEY: optEnv('BRAVE_API_KEY'),

  // API bases
  GAMMA_BASE: 'https://gamma-api.polymarket.com',
  CLOB_BASE: 'https://clob.polymarket.com',

  // Contract addresses
  OOV2_ADDRESS: '0xee3afe347d5c74317041e2618c49534daf887c24',
  UMA_ADAPTER: '0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d',

  // Event topic hashes
  TOPIC_PROPOSE: '0x6e51dd00371aabffa82cd401592f76ed51e98a9ea4b58751c70463a2c78b5ca1',
  TOPIC_DISPUTE: '0x5165909c3d1c01c5d1e121ac6f6d01dda1ba24bc9e1f975b5a375339c15be7f3',
  TOPIC_SETTLE: '0x3f384afb4bd9f0aef0298c80399950011420eb33b0e1a750b20966270247b9a0',
  TOPIC_UMA_ADAPTER: '0x0000000000000000000000002f5e3684cb1f318ec51b00edba38d79ac2c0aa9d',

  // Tag IDs
  CRYPTO_TAG_ID: 21,

  // Thresholds
  PRICE_WATCHLIST: 0.85,
  PRICE_TRIGGER: 0.90,
  MIN_CONFIDENCE: 80,

  // Actionability filters
  MIN_DAILY_VOLUME: 5000,
  MAX_BEST_ASK: 0.97,
  MAX_SPREAD: 0.05,

  // Intervals (ms)
  SYNC_INTERVAL: 30_000,
  DETECTION_INTERVAL: 30_000,
  ETHERSCAN_INTERVAL: 60_000,
  GAMMA_CHECK_INTERVAL: 5_000,
  HOT_PRICE_INTERVAL: 10_000,
  ACTIVE_PRICE_INTERVAL: 30_000,
  STATE_PERSIST_INTERVAL: 60_000,
  STATUS_REPORT_INTERVAL: 30_000,

  // Pagination
  GAMMA_PAGE_SIZE: 500,
} as const;
