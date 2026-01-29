-- Migration: 022_add_median_profit_pct.sql
-- Median profit percentage per closed trade (IQR outlier removal applied)

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS median_profit_pct DECIMAL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_wallets_median_profit_pct ON wallets(median_profit_pct DESC NULLS LAST);
