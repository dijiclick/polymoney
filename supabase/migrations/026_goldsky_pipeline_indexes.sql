-- Indexes for Goldsky pipeline tables to enable fast per-wallet queries
-- Without these, querying goldsky_order_filled (3.5M+ rows) would do full table scans

-- Order Filled: need to look up trades by maker OR taker address, filtered by timestamp
CREATE INDEX IF NOT EXISTS idx_goldsky_order_filled_maker ON goldsky_order_filled (maker);
CREATE INDEX IF NOT EXISTS idx_goldsky_order_filled_taker ON goldsky_order_filled (taker);
CREATE INDEX IF NOT EXISTS idx_goldsky_order_filled_timestamp ON goldsky_order_filled (timestamp);
-- Composite indexes for the most common query pattern: address + timestamp range
CREATE INDEX IF NOT EXISTS idx_goldsky_order_filled_maker_ts ON goldsky_order_filled (maker, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_order_filled_taker_ts ON goldsky_order_filled (taker, timestamp DESC);

-- User Positions: need to look up all positions for a given user
CREATE INDEX IF NOT EXISTS idx_goldsky_user_positions_user ON goldsky_user_positions ("user");

-- User Balances: need to look up all balances for a given user
CREATE INDEX IF NOT EXISTS idx_goldsky_user_balances_user ON goldsky_user_balances ("user");
