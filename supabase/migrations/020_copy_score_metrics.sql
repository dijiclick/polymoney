-- Add copy score metrics columns for copy-trade wallet ranking
-- New metrics: profit_factor, difficulty-weighted win rate, weekly profit rate, copy score, avg trades/day, is_bot

-- Profit Factor (gross wins / abs(gross losses))
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS profit_factor_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS profit_factor_all DECIMAL DEFAULT 0;

-- Difficulty-Weighted Win Rate (wins weighted by 1 - entry_probability)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS diff_win_rate_30d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS diff_win_rate_all DECIMAL DEFAULT 0;

-- Weekly Profit Rate (% of weeks with positive PnL)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS weekly_profit_rate DECIMAL DEFAULT 0;

-- Composite Copy Score (0-100)
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS copy_score DECIMAL DEFAULT 0;

-- Info labels
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS avg_trades_per_day DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT FALSE;

-- Index for sorting by copy score (primary ranking column)
CREATE INDEX IF NOT EXISTS idx_wallets_copy_score ON wallets(copy_score DESC);

-- Comments for documentation
COMMENT ON COLUMN wallets.profit_factor_30d IS '30-day profit factor: gross wins / abs(gross losses)';
COMMENT ON COLUMN wallets.profit_factor_all IS 'All-time profit factor: gross wins / abs(gross losses)';
COMMENT ON COLUMN wallets.diff_win_rate_30d IS '30-day difficulty-weighted win rate (harder bets count more)';
COMMENT ON COLUMN wallets.diff_win_rate_all IS 'All-time difficulty-weighted win rate (harder bets count more)';
COMMENT ON COLUMN wallets.weekly_profit_rate IS 'Percentage of active weeks that were profitable';
COMMENT ON COLUMN wallets.copy_score IS 'Composite copy-trade score (0-100) combining profit factor, calmar ratio, difficulty win rate, weekly consistency, and edge trend';
COMMENT ON COLUMN wallets.avg_trades_per_day IS 'Average number of trades per active day';
COMMENT ON COLUMN wallets.is_bot IS 'Whether this wallet is likely a bot (bot_score >= 60)';
