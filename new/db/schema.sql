-- =============================================
-- New Trade Analytics Schema
-- =============================================

-- Tracked wallet addresses with pre-computed metrics
CREATE TABLE IF NOT EXISTS wallets_new (
  address                 TEXT PRIMARY KEY,
  username                TEXT,
  added_at                TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at          TIMESTAMPTZ,
  last_activity_timestamp BIGINT DEFAULT 0,
  -- Pre-computed metrics (recomputed from trades on each sync)
  total_pnl               NUMERIC(14,2) DEFAULT 0,
  total_roi               NUMERIC(10,4) DEFAULT 0,
  win_rate                NUMERIC(6,2) DEFAULT 0,
  open_trade_count        INT DEFAULT 0,
  closed_trade_count      INT DEFAULT 0,
  total_volume_bought     NUMERIC(14,2) DEFAULT 0,
  total_volume_sold       NUMERIC(14,2) DEFAULT 0,
  avg_hold_duration_hours NUMERIC(10,2),
  profit_factor           NUMERIC(8,2) DEFAULT 0,
  metrics_updated_at      BIGINT DEFAULT 0,
  -- 7-day period metrics
  pnl_7d                  NUMERIC(14,2) DEFAULT 0,
  roi_7d                  NUMERIC(10,4) DEFAULT 0,
  win_rate_7d             NUMERIC(6,2) DEFAULT 0,
  volume_7d               NUMERIC(14,2) DEFAULT 0,
  trade_count_7d          INT DEFAULT 0,
  drawdown_7d             NUMERIC(6,2) DEFAULT 0,
  -- 30-day period metrics
  pnl_30d                 NUMERIC(14,2) DEFAULT 0,
  roi_30d                 NUMERIC(10,4) DEFAULT 0,
  win_rate_30d            NUMERIC(6,2) DEFAULT 0,
  volume_30d              NUMERIC(14,2) DEFAULT 0,
  trade_count_30d         INT DEFAULT 0,
  drawdown_30d            NUMERIC(6,2) DEFAULT 0,
  -- All-time drawdown
  drawdown_all            NUMERIC(6,2) DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- One row per entry-to-exit cycle per market per wallet
CREATE TABLE IF NOT EXISTS trades (
  id                  BIGSERIAL PRIMARY KEY,
  wallet_address      TEXT NOT NULL REFERENCES wallets_new(address) ON DELETE CASCADE,
  condition_id        TEXT NOT NULL,
  market_title        TEXT,
  market_slug         TEXT,
  primary_outcome     TEXT,
  yes_shares          NUMERIC(18,6) DEFAULT 0,
  no_shares           NUMERIC(18,6) DEFAULT 0,
  closed              BOOLEAN DEFAULT FALSE,
  open_timestamp      TIMESTAMPTZ NOT NULL,
  close_timestamp     TIMESTAMPTZ,
  number_of_buys      INT DEFAULT 0,
  number_of_sells     INT DEFAULT 0,
  total_volume_bought NUMERIC(14,2) DEFAULT 0,
  total_volume_sold   NUMERIC(14,2) DEFAULT 0,
  roi                 NUMERIC(10,4) DEFAULT 0,
  pnl                 NUMERIC(14,2) DEFAULT 0,
  avg_entry_price     NUMERIC(10,6) DEFAULT 0,
  avg_exit_price      NUMERIC(10,6) DEFAULT 0,
  profit_pct          NUMERIC(10,4) DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trades_wallet_condition_open ON trades(wallet_address, condition_id, closed) WHERE closed = false;
CREATE INDEX IF NOT EXISTS idx_trades_wallet_closed ON trades(wallet_address, closed);
CREATE INDEX IF NOT EXISTS idx_trades_wallet_close_ts ON trades(wallet_address, close_timestamp ASC) WHERE closed = true;

-- Raw activity log for incremental sync and audit
CREATE TABLE IF NOT EXISTS activities (
  id                  BIGSERIAL PRIMARY KEY,
  wallet_address      TEXT NOT NULL REFERENCES wallets_new(address) ON DELETE CASCADE,
  condition_id        TEXT NOT NULL,
  transaction_hash    TEXT,
  timestamp           BIGINT NOT NULL,
  type                TEXT NOT NULL,
  side                TEXT NOT NULL,
  outcome             TEXT,
  size                NUMERIC(18,6),
  price               NUMERIC(10,6),
  usdc_size           NUMERIC(14,2),
  title               TEXT,
  slug                TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, transaction_hash, condition_id, side, outcome)
);

CREATE INDEX IF NOT EXISTS idx_activities_wallet ON activities(wallet_address);
CREATE INDEX IF NOT EXISTS idx_activities_wallet_ts ON activities(wallet_address, timestamp DESC);
