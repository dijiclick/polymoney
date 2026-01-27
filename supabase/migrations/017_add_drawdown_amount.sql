-- Add drawdown dollar amount column for all-time max drawdown
-- This stores the peak-to-trough dollar amount (not percentage)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS drawdown_amount_all DECIMAL(18,2) DEFAULT 0;

COMMENT ON COLUMN wallets.drawdown_amount_all IS 'All-time maximum drawdown in dollar amount (peak - trough)';
