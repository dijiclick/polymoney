-- Migration 031: Add capital flow columns for true ROI/drawdown from Etherscan
-- Tracks USDC deposits/withdrawals to compute true metrics based on actual capital invested

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_deposited numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_withdrawn numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS deposit_count integer DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS withdrawal_count integer DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS true_roi numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS true_roi_dollar numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS true_drawdown numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS true_drawdown_amount numeric DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS capital_flows_json text DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS capital_flows_cached_at timestamptz DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_deposit_at timestamptz DEFAULT NULL;
