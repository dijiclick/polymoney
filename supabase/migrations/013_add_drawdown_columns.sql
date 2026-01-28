-- Add drawdown columns for 7d and 30d periods
-- Drawdown = maximum peak-to-trough decline in cumulative PnL (percentage)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS drawdown_7d DECIMAL DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS drawdown_30d DECIMAL DEFAULT 0;

COMMENT ON COLUMN wallets.drawdown_7d IS 'Maximum drawdown percentage over last 7 days';
COMMENT ON COLUMN wallets.drawdown_30d IS 'Maximum drawdown percentage over last 30 days';
