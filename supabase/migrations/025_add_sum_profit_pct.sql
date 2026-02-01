-- Sum of per-trade profit percentages (realizedPnl / initialValue * 100) per time period.

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sum_profit_pct_7d DECIMAL DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sum_profit_pct_30d DECIMAL DEFAULT NULL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sum_profit_pct_all DECIMAL DEFAULT NULL;
