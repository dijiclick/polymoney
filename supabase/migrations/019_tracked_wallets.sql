-- Migration: 019_tracked_wallets.sql
-- Description: Tracked wallets feature - bookmark wallets for auto-refresh

CREATE TABLE IF NOT EXISTS tracked_wallets (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    update_interval_hours INTEGER NOT NULL DEFAULT 24,
    last_refreshed_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracked_wallets_address ON tracked_wallets(address);

-- Row Level Security
ALTER TABLE tracked_wallets ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read on tracked_wallets" ON tracked_wallets FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access on tracked_wallets" ON tracked_wallets FOR ALL USING (auth.role() = 'service_role');
