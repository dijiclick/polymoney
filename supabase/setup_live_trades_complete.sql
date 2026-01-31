-- ============================================================================
-- COMPLETE SETUP FOR LIVE TRADES FUNCTIONALITY
-- Run this entire file at once in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- PART 1: BASE SCHEMA - WATCHLIST TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchlist (
    id BIGSERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    list_type TEXT NOT NULL CHECK (list_type IN ('copytrade', 'bot', 'custom', 'copy')),
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
-- PART 2: WALLETS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallets (
    address TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('live')),
    balance DECIMAL(18,2) DEFAULT 0,
    balance_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_source ON wallets(source);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_balance_qualified ON wallets(balance DESC) WHERE balance >= 200;

-- ============================================================================
-- PART 3: LIVE TRADES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS live_trades (
    id BIGSERIAL PRIMARY KEY,

    -- Trade Identity
    trade_id TEXT NOT NULL,
    tx_hash TEXT,

    -- Trader Info
    trader_address TEXT NOT NULL,
    trader_username TEXT,
    is_known_trader BOOLEAN DEFAULT FALSE,
    trader_classification TEXT,
    trader_copytrade_score INT,
    trader_bot_score INT,
    trader_portfolio_value DECIMAL(18,2),
    trader_insider_score INT,
    trader_insider_level TEXT,
    trader_red_flags JSONB,
    is_insider_suspect BOOLEAN DEFAULT FALSE,

    -- Market Info
    condition_id TEXT NOT NULL,
    asset_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    category TEXT,

    -- Trade Details
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    outcome TEXT,
    outcome_index INT,
    size DECIMAL(18,6) NOT NULL,
    price DECIMAL(10,6) NOT NULL,
    usd_value DECIMAL(18,2) NOT NULL,

    -- Timing
    executed_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processing_latency_ms INT,

    -- Flags
    is_whale BOOLEAN DEFAULT FALSE,
    is_watchlist BOOLEAN DEFAULT FALSE,
    alert_triggered BOOLEAN DEFAULT FALSE,

    -- Metadata
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_trades_trade_id ON live_trades(trade_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_live_trades_trader ON live_trades(trader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_trades_recent ON live_trades(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_trades_whales ON live_trades(usd_value DESC, received_at DESC) WHERE is_whale = TRUE;
CREATE INDEX IF NOT EXISTS idx_live_trades_watchlist ON live_trades(received_at DESC) WHERE is_watchlist = TRUE;
CREATE INDEX IF NOT EXISTS idx_live_trades_market ON live_trades(condition_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_trades_category ON live_trades(category, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_trades_insider ON live_trades(received_at DESC) WHERE is_insider_suspect = TRUE;

-- ============================================================================
-- PART 4: TRADE ALERTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_alerts (
    id BIGSERIAL PRIMARY KEY,
    trade_id TEXT NOT NULL,
    trader_address TEXT NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected',
        'insider_suspect'
    )),
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    title TEXT NOT NULL,
    description TEXT,
    metadata JSONB,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_unacked ON trade_alerts(created_at DESC) WHERE acknowledged = FALSE;
CREATE INDEX IF NOT EXISTS idx_alerts_trader ON trade_alerts(trader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON trade_alerts(alert_type, created_at DESC);

-- ============================================================================
-- PART 5: ALERT RULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected',
        'insider_suspect'
    )),
    conditions JSONB NOT NULL,
    alert_severity TEXT DEFAULT 'info' CHECK (alert_severity IN ('info', 'warning', 'critical')),
    notification_channels JSONB DEFAULT '["dashboard"]',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default alert rules if none exist
INSERT INTO alert_rules (name, rule_type, conditions, alert_severity)
SELECT name, rule_type, conditions::jsonb, alert_severity FROM (VALUES
    ('Whale Trade >$10k', 'whale_trade', '{"min_usd_value": 10000}', 'warning'),
    ('Mega Whale >$50k', 'whale_trade', '{"min_usd_value": 50000}', 'critical'),
    ('Mega Whale >$100k', 'whale_trade', '{"min_usd_value": 100000}', 'critical'),
    ('Insider Suspect', 'insider_suspect', '{"min_score": 60}', 'warning'),
    ('Watchlist Activity', 'watchlist_activity', '{"min_usd_value": 0}', 'info')
) AS v(name, rule_type, conditions, alert_severity)
WHERE NOT EXISTS (SELECT 1 FROM alert_rules LIMIT 1);

-- ============================================================================
-- PART 6: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow public read on watchlist" ON watchlist;
DROP POLICY IF EXISTS "Allow service role full access on watchlist" ON watchlist;
DROP POLICY IF EXISTS "Allow public read on wallets" ON wallets;
DROP POLICY IF EXISTS "Allow service role full access on wallets" ON wallets;
DROP POLICY IF EXISTS "Allow public read on live_trades" ON live_trades;
DROP POLICY IF EXISTS "Allow service role full access on live_trades" ON live_trades;
DROP POLICY IF EXISTS "Allow public read on trade_alerts" ON trade_alerts;
DROP POLICY IF EXISTS "Allow service role full access on trade_alerts" ON trade_alerts;
DROP POLICY IF EXISTS "Allow public read on alert_rules" ON alert_rules;
DROP POLICY IF EXISTS "Allow service role full access on alert_rules" ON alert_rules;

-- Public read access
CREATE POLICY "Allow public read on watchlist" ON watchlist FOR SELECT USING (true);
CREATE POLICY "Allow public read on wallets" ON wallets FOR SELECT USING (true);
CREATE POLICY "Allow public read on live_trades" ON live_trades FOR SELECT USING (true);
CREATE POLICY "Allow public read on trade_alerts" ON trade_alerts FOR SELECT USING (true);
CREATE POLICY "Allow public read on alert_rules" ON alert_rules FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Allow service role full access on watchlist" ON watchlist FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on wallets" ON wallets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on live_trades" ON live_trades FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on trade_alerts" ON trade_alerts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on alert_rules" ON alert_rules FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 7: ENABLE REALTIME (ignore errors if already added)
-- ============================================================================

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE watchlist;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE wallets;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE live_trades;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE trade_alerts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- DONE!
-- ============================================================================

-- Verify setup
SELECT
    'live_trades' as table_name,
    COUNT(*) as row_count
FROM live_trades
UNION ALL
SELECT
    'trade_alerts' as table_name,
    COUNT(*) as row_count
FROM trade_alerts
UNION ALL
SELECT
    'watchlist' as table_name,
    COUNT(*) as row_count
FROM watchlist
UNION ALL
SELECT
    'wallets' as table_name,
    COUNT(*) as row_count
FROM wallets;
