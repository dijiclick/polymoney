-- Add best_trade_pct and pf_trend columns for improved copy score formula
-- best_trade_pct: % of total positive PnL from single best trade (one-hit wonder detection)
-- pf_trend: ratio of PF 30d / PF all-time (edge decay detection)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS best_trade_pct DECIMAL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pf_trend DECIMAL;
