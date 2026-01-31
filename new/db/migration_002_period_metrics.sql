-- Migration: Add period metrics + drawdown to wallets_new
-- Enables time-period filtering (7d/30d/all) and drawdown display on dashboard

-- 7-day period metrics
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS pnl_7d NUMERIC(14,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS roi_7d NUMERIC(10,4) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS win_rate_7d NUMERIC(6,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS volume_7d NUMERIC(14,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS trade_count_7d INT DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS drawdown_7d NUMERIC(6,2) DEFAULT 0;

-- 30-day period metrics
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS pnl_30d NUMERIC(14,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS roi_30d NUMERIC(10,4) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS win_rate_30d NUMERIC(6,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS volume_30d NUMERIC(14,2) DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS trade_count_30d INT DEFAULT 0;
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS drawdown_30d NUMERIC(6,2) DEFAULT 0;

-- All-time drawdown (total_pnl, total_roi, win_rate etc already exist as aggregate columns)
ALTER TABLE wallets_new ADD COLUMN IF NOT EXISTS drawdown_all NUMERIC(6,2) DEFAULT 0;

-- Indexes for common sort operations
CREATE INDEX IF NOT EXISTS idx_wn_pnl_7d ON wallets_new(pnl_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_pnl_30d ON wallets_new(pnl_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_win_rate_7d ON wallets_new(win_rate_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_win_rate_30d ON wallets_new(win_rate_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_roi_7d ON wallets_new(roi_7d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_roi_30d ON wallets_new(roi_30d DESC);
CREATE INDEX IF NOT EXISTS idx_wn_drawdown_all ON wallets_new(drawdown_all DESC);
CREATE INDEX IF NOT EXISTS idx_wn_profit_factor ON wallets_new(profit_factor DESC);
