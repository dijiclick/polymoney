-- ============================================================================
-- BASE SCHEMA - Foundation Tables
-- Run this FIRST before any other migrations
-- ============================================================================

-- ============================================================================
-- WATCHLIST TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS watchlist (
    id BIGSERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    list_type TEXT NOT NULL CHECK (list_type IN ('copytrade', 'bot', 'custom')),
    priority INT DEFAULT 0,
    notes TEXT,
    alert_on_new_trade BOOLEAN DEFAULT FALSE,
    alert_threshold_usd DECIMAL(18,2) DEFAULT 1000,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(address, list_type)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_type ON watchlist(list_type);
CREATE INDEX IF NOT EXISTS idx_watchlist_address ON watchlist(address);

-- ============================================================================
-- ENABLE REALTIME
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE watchlist;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read on watchlist" ON watchlist FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access on watchlist" ON watchlist FOR ALL USING (auth.role() = 'service_role');
