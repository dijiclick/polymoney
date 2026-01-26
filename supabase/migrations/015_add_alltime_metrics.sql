-- Add all-time metrics columns with consistent naming
-- This creates pnl_all, roi_all, win_rate_all, volume_all, trade_count_all, drawdown_all

-- All-time metrics
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pnl_all DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS roi_all DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS win_rate_all DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS volume_all DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS trade_count_all INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS drawdown_all DECIMAL DEFAULT 0;

-- Comments for documentation
COMMENT ON COLUMN wallets.pnl_all IS 'All-time realized profit/loss in USD';
COMMENT ON COLUMN wallets.roi_all IS 'All-time return on investment percentage';
COMMENT ON COLUMN wallets.win_rate_all IS 'All-time win rate percentage';
COMMENT ON COLUMN wallets.volume_all IS 'All-time trading volume in USD';
COMMENT ON COLUMN wallets.trade_count_all IS 'All-time number of resolved trades';
COMMENT ON COLUMN wallets.drawdown_all IS 'All-time maximum drawdown percentage';

-- Create index for sorting by all-time metrics
CREATE INDEX IF NOT EXISTS idx_wallets_pnl_all ON wallets(pnl_all DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_roi_all ON wallets(roi_all DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_win_rate_all ON wallets(win_rate_all DESC);
