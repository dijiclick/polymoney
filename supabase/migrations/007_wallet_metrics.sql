-- Migration: Add pre-calculated metrics columns to wallets table
-- This enables fast sorting/filtering by win rate, PnL, ROI etc.

-- Drop dependent views first
DROP VIEW IF EXISTS v_qualified_wallets CASCADE;
DROP VIEW IF EXISTS v_leaderboard_summary CASCADE;

-- Drop leaderboard table (no longer needed - wallets discovered from live trades)
DROP TABLE IF EXISTS wallet_leaderboard_rankings CASCADE;

-- Update source constraint to use 'live' instead of 'leaderboard'
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_source_check;

-- Migrate existing data before adding new constraint
UPDATE wallets SET source = 'live' WHERE source = 'leaderboard';
UPDATE wallets SET source = 'live' WHERE source = 'both';

-- Add new source constraint
ALTER TABLE wallets ADD CONSTRAINT wallets_source_check
    CHECK (source IN ('live'));

-- Add metrics columns for 7-day period
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pnl_7d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS roi_7d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS win_rate_7d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_7d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trade_count_7d INTEGER DEFAULT 0;

-- Add metrics columns for 30-day period
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pnl_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS roi_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS win_rate_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trade_count_30d INTEGER DEFAULT 0;

-- Add timestamp for when metrics were last updated
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ;

-- Add indexes for common sort operations
CREATE INDEX IF NOT EXISTS idx_wallets_win_rate_7d ON wallets(win_rate_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_win_rate_30d ON wallets(win_rate_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_pnl_7d ON wallets(pnl_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_pnl_30d ON wallets(pnl_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_roi_7d ON wallets(roi_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_roi_30d ON wallets(roi_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_volume_30d ON wallets(volume_30d DESC);

-- Composite index for common filter + sort combinations
CREATE INDEX IF NOT EXISTS idx_wallets_balance_winrate ON wallets(balance DESC, win_rate_30d DESC);

-- Add comments
COMMENT ON COLUMN wallets.pnl_7d IS 'Profit/Loss in USD over last 7 days';
COMMENT ON COLUMN wallets.roi_7d IS 'Return on Investment percentage over last 7 days';
COMMENT ON COLUMN wallets.win_rate_7d IS 'Win rate percentage over last 7 days (closed positions)';
COMMENT ON COLUMN wallets.volume_7d IS 'Total trading volume in USD over last 7 days';
COMMENT ON COLUMN wallets.trade_count_7d IS 'Number of trades over last 7 days';
COMMENT ON COLUMN wallets.pnl_30d IS 'Profit/Loss in USD over last 30 days';
COMMENT ON COLUMN wallets.roi_30d IS 'Return on Investment percentage over last 30 days';
COMMENT ON COLUMN wallets.win_rate_30d IS 'Win rate percentage over last 30 days (closed positions)';
COMMENT ON COLUMN wallets.volume_30d IS 'Total trading volume in USD over last 30 days';
COMMENT ON COLUMN wallets.trade_count_30d IS 'Number of trades over last 30 days';
COMMENT ON COLUMN wallets.metrics_updated_at IS 'Timestamp when metrics were last recalculated';
