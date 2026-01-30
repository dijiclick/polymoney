
-- Migration: 011_fix_metrics_calculation.sql
-- Description: Add all-time metrics columns to match Polymarket's display
--
-- Problem: Our system only calculated metrics from positions resolved within 7/30 days,
-- but Polymarket shows all-time totals (Total Positions, Total Wins, Total Losses, Overall PnL)
--
-- Solution:
-- 1. Period metrics (7d/30d) are calculated INDEPENDENTLY:
--    - volume_Xd = sum of trades EXECUTED in last X days
--    - pnl_Xd = sum of realizedPnl from positions RESOLVED in last X days
--    - win_rate_Xd = wins / total for positions RESOLVED in last X days
--
-- 2. Overall metrics are ALL-TIME totals

-- ============================================
-- ADD ALL-TIME METRICS COLUMNS
-- ============================================

-- Overall/All-time metrics (matches Polymarket profile display)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_positions INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS active_positions INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_wins INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_losses INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS realized_pnl DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS unrealized_pnl DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS overall_pnl DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS overall_roi DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS overall_win_rate DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_volume DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_trades INTEGER DEFAULT 0;

-- ============================================
-- ADD INDEXES FOR NEW COLUMNS
-- ============================================

CREATE INDEX IF NOT EXISTS idx_wallets_overall_pnl ON wallets(overall_pnl DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_overall_win_rate ON wallets(overall_win_rate DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_total_volume ON wallets(total_volume DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_realized_pnl ON wallets(realized_pnl DESC);

-- ============================================
-- ADD COMMENTS
-- ============================================

-- Period metrics explanation
COMMENT ON COLUMN wallets.pnl_7d IS 'Realized PnL from positions RESOLVED in last 7 days';
COMMENT ON COLUMN wallets.pnl_30d IS 'Realized PnL from positions RESOLVED in last 30 days';
COMMENT ON COLUMN wallets.win_rate_7d IS 'Win rate for positions RESOLVED in last 7 days';
COMMENT ON COLUMN wallets.win_rate_30d IS 'Win rate for positions RESOLVED in last 30 days';
COMMENT ON COLUMN wallets.volume_7d IS 'Total trading volume from trades EXECUTED in last 7 days';
COMMENT ON COLUMN wallets.volume_30d IS 'Total trading volume from trades EXECUTED in last 30 days';
COMMENT ON COLUMN wallets.trade_count_7d IS 'Number of trades EXECUTED in last 7 days';
COMMENT ON COLUMN wallets.trade_count_30d IS 'Number of trades EXECUTED in last 30 days';

-- Overall/all-time metrics explanation
COMMENT ON COLUMN wallets.total_positions IS 'Total number of closed positions (all-time)';
COMMENT ON COLUMN wallets.active_positions IS 'Number of currently open positions';
COMMENT ON COLUMN wallets.total_wins IS 'Number of closed positions with positive PnL (all-time)';
COMMENT ON COLUMN wallets.total_losses IS 'Number of closed positions with negative/zero PnL (all-time)';
COMMENT ON COLUMN wallets.realized_pnl IS 'Sum of realizedPnl from all closed positions (all-time)';
COMMENT ON COLUMN wallets.unrealized_pnl IS 'Sum of cashPnl from all open positions (current)';
COMMENT ON COLUMN wallets.overall_pnl IS 'Total PnL = realized_pnl + unrealized_pnl';
COMMENT ON COLUMN wallets.overall_roi IS 'Overall ROI percentage (all-time)';
COMMENT ON COLUMN wallets.overall_win_rate IS 'Win rate percentage (all-time) = total_wins / total_positions * 100';
COMMENT ON COLUMN wallets.total_volume IS 'Total trading volume in USD (all-time)';
COMMENT ON COLUMN wallets.total_trades IS 'Total number of trades (all-time)';
