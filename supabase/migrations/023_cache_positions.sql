-- Add cached positions column for instant modal loading
-- Stores JSON of open and closed positions to avoid re-fetching from Polymarket API
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS cached_positions_json TEXT;
