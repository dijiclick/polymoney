-- Migration: 027_drop_goldsky_mirror_tables.sql
-- Drop Goldsky Mirror pipeline tables (no longer needed - querying GraphQL directly)

-- Drop indexes first
DROP INDEX IF EXISTS idx_goldsky_order_filled_maker;
DROP INDEX IF EXISTS idx_goldsky_order_filled_taker;
DROP INDEX IF EXISTS idx_goldsky_order_filled_timestamp;
DROP INDEX IF EXISTS idx_goldsky_order_filled_maker_ts;
DROP INDEX IF EXISTS idx_goldsky_order_filled_taker_ts;
DROP INDEX IF EXISTS idx_goldsky_user_positions_user;
DROP INDEX IF EXISTS idx_goldsky_user_balances_user;

-- Drop tables
DROP TABLE IF EXISTS goldsky_order_filled CASCADE;
DROP TABLE IF EXISTS goldsky_user_positions CASCADE;
DROP TABLE IF EXISTS goldsky_user_balances CASCADE;

-- Note: Keeping goldsky_wallets table - it stores calculated metrics
-- The Mirror tables (order_filled, user_positions, user_balances) contained
-- raw blockchain data that we now query directly from Goldsky GraphQL API
