-- Migration 001: Add enriched data columns for comprehensive metric computation
-- All columns have defaults — fully backward compatible

-- === trades table: avg entry/exit prices + profit percentage ===
ALTER TABLE trades ADD COLUMN IF NOT EXISTS avg_entry_price NUMERIC(10,6) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS avg_exit_price  NUMERIC(10,6) DEFAULT 0;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS profit_pct      NUMERIC(10,4) DEFAULT 0;

-- Index for chronological equity curve (drawdown computation)
CREATE INDEX IF NOT EXISTS idx_trades_wallet_close_ts
  ON trades(wallet_address, close_timestamp ASC) WHERE closed = true;

-- === wallets_new table: profit factor + metrics timestamp ===
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS profit_factor      NUMERIC(8,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS metrics_updated_at  BIGINT DEFAULT 0;
