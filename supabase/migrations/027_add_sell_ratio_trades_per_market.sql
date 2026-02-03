-- Sell ratio (% of orders that are sells) and trades_per_market (avg orders per market).
-- Used to detect scalpers/active traders that are problematic for copy trading.

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS sell_ratio DECIMAL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trades_per_market DECIMAL DEFAULT NULL;
