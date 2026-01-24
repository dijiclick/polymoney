-- Migration: Add account_created_at column for trader profile age
-- This stores when the trader's Polymarket account was created

-- ============================================================================
-- WALLETS TABLE
-- ============================================================================

-- Add account_created_at column
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS account_created_at TIMESTAMPTZ;

-- Add username column for profile display name
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS username TEXT;

-- Add index for sorting by account age
CREATE INDEX IF NOT EXISTS idx_wallets_account_created_at ON wallets(account_created_at DESC);

-- Add comments
COMMENT ON COLUMN wallets.account_created_at IS 'When the trader created their Polymarket account';
COMMENT ON COLUMN wallets.username IS 'Trader display name (pseudonym) from Polymarket profile';
