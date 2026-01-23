-- ============================================================================
-- POLYMARKET PROFILE FINDER - LIVE TRADES SCHEMA
-- Real-time Trade Monitoring (EventScope-like feature)
-- ============================================================================


-- ============================================================================
-- SECTION 1: LIVE TRADES TABLE
-- ============================================================================

-- Live trades table for real-time trade monitoring
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

-- Index for unique trade deduplication
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_trades_trade_id ON live_trades(trade_id);


-- ============================================================================
-- SECTION 2: TRADE ALERTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_alerts (
    id BIGSERIAL PRIMARY KEY,

    -- Reference
    trade_id TEXT NOT NULL,
    trader_address TEXT NOT NULL,

    -- Alert Type
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected'
    )),

    -- Alert Details
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    title TEXT NOT NULL,
    description TEXT,
    metadata JSONB,

    -- Status
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- SECTION 3: ALERT RULES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,

    -- Rule Definition
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected'
    )),

    -- Conditions (JSONB for flexibility)
    conditions JSONB NOT NULL,

    -- Actions
    alert_severity TEXT DEFAULT 'info' CHECK (alert_severity IN ('info', 'warning', 'critical')),
    notification_channels JSONB DEFAULT '["dashboard"]',

    -- Status
    enabled BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- SECTION 4: TRADE STATS (HOURLY AGGREGATION)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trade_stats_hourly (
    id SERIAL PRIMARY KEY,

    hour_start TIMESTAMPTZ NOT NULL,

    -- Volume Metrics
    total_trades INT DEFAULT 0,
    total_volume_usd DECIMAL(18,2) DEFAULT 0,
    unique_traders INT DEFAULT 0,
    unique_markets INT DEFAULT 0,

    -- Distribution
    buy_count INT DEFAULT 0,
    sell_count INT DEFAULT 0,
    avg_trade_size DECIMAL(18,2) DEFAULT 0,
    max_trade_size DECIMAL(18,2) DEFAULT 0,

    -- Whale Activity
    whale_trades INT DEFAULT 0,
    whale_volume_usd DECIMAL(18,2) DEFAULT 0,

    -- Top Categories
    category_breakdown JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(hour_start)
);


-- ============================================================================
-- SECTION 5: INDEXES FOR PERFORMANCE
-- ============================================================================

-- Fast lookups by trader
CREATE INDEX IF NOT EXISTS idx_live_trades_trader ON live_trades(trader_address, created_at DESC);

-- Real-time feed queries (recent trades)
CREATE INDEX IF NOT EXISTS idx_live_trades_recent ON live_trades(received_at DESC);

-- Whale detection
CREATE INDEX IF NOT EXISTS idx_live_trades_whales ON live_trades(usd_value DESC, received_at DESC)
    WHERE is_whale = TRUE;

-- Watchlist trades
CREATE INDEX IF NOT EXISTS idx_live_trades_watchlist ON live_trades(received_at DESC)
    WHERE is_watchlist = TRUE;

-- Market activity
CREATE INDEX IF NOT EXISTS idx_live_trades_market ON live_trades(condition_id, received_at DESC);

-- Category filtering
CREATE INDEX IF NOT EXISTS idx_live_trades_category ON live_trades(category, received_at DESC);

-- Alerts indexes
CREATE INDEX IF NOT EXISTS idx_alerts_unacked ON trade_alerts(created_at DESC)
    WHERE acknowledged = FALSE;
CREATE INDEX IF NOT EXISTS idx_alerts_trader ON trade_alerts(trader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON trade_alerts(alert_type, created_at DESC);


-- ============================================================================
-- SECTION 6: WATCHLIST EXTENSIONS
-- ============================================================================

-- Add new columns to watchlist table for enhanced alerts
DO $$
BEGIN
    -- Add notification_channels column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watchlist' AND column_name = 'notification_channels'
    ) THEN
        ALTER TABLE watchlist ADD COLUMN notification_channels JSONB DEFAULT '["dashboard"]';
    END IF;

    -- Add min_trade_size column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watchlist' AND column_name = 'min_trade_size'
    ) THEN
        ALTER TABLE watchlist ADD COLUMN min_trade_size DECIMAL(18,2) DEFAULT 0;
    END IF;
END $$;


-- ============================================================================
-- SECTION 7: ENABLE REAL-TIME SUBSCRIPTIONS
-- ============================================================================

-- Enable real-time for live trades monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE live_trades;
ALTER PUBLICATION supabase_realtime ADD TABLE trade_alerts;


-- ============================================================================
-- SECTION 8: DEFAULT ALERT RULES
-- ============================================================================

-- Insert default alert rules (only if table is empty)
INSERT INTO alert_rules (name, rule_type, conditions, alert_severity)
SELECT name, rule_type, conditions::jsonb, alert_severity FROM (VALUES
    ('Whale Trade >$10k', 'whale_trade', '{"min_usd_value": 10000}', 'warning'),
    ('Mega Whale >$50k', 'whale_trade', '{"min_usd_value": 50000}', 'critical'),
    ('Mega Whale >$100k', 'whale_trade', '{"min_usd_value": 100000}', 'critical'),
    ('Late Night Trade', 'unusual_time', '{"hours": [0,1,2,3,4,5], "min_usd_value": 5000}', 'warning'),
    ('Watchlist Activity', 'watchlist_activity', '{"min_usd_value": 0}', 'info')
) AS v(name, rule_type, conditions, alert_severity)
WHERE NOT EXISTS (SELECT 1 FROM alert_rules LIMIT 1);


-- ============================================================================
-- SECTION 9: HELPER FUNCTIONS
-- ============================================================================

-- Function to get recent trades with filters
CREATE OR REPLACE FUNCTION get_recent_trades(
    p_limit INT DEFAULT 100,
    p_min_usd DECIMAL DEFAULT 0,
    p_whales_only BOOLEAN DEFAULT FALSE,
    p_watchlist_only BOOLEAN DEFAULT FALSE,
    p_category TEXT DEFAULT NULL
) RETURNS TABLE (
    id BIGINT,
    trade_id TEXT,
    trader_address TEXT,
    trader_username TEXT,
    is_known_trader BOOLEAN,
    trader_classification TEXT,
    market_slug TEXT,
    side TEXT,
    outcome TEXT,
    size DECIMAL,
    price DECIMAL,
    usd_value DECIMAL,
    is_whale BOOLEAN,
    is_watchlist BOOLEAN,
    executed_at TIMESTAMPTZ,
    processing_latency_ms INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.trade_id,
        t.trader_address,
        t.trader_username,
        t.is_known_trader,
        t.trader_classification,
        t.market_slug,
        t.side,
        t.outcome,
        t.size,
        t.price,
        t.usd_value,
        t.is_whale,
        t.is_watchlist,
        t.executed_at,
        t.processing_latency_ms
    FROM live_trades t
    WHERE
        t.usd_value >= p_min_usd
        AND (NOT p_whales_only OR t.is_whale = TRUE)
        AND (NOT p_watchlist_only OR t.is_watchlist = TRUE)
        AND (p_category IS NULL OR t.category = p_category)
    ORDER BY t.received_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;


-- Function to get unacknowledged alerts
CREATE OR REPLACE FUNCTION get_pending_alerts(p_limit INT DEFAULT 50)
RETURNS TABLE (
    id BIGINT,
    trade_id TEXT,
    trader_address TEXT,
    alert_type TEXT,
    severity TEXT,
    title TEXT,
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id,
        a.trade_id,
        a.trader_address,
        a.alert_type,
        a.severity,
        a.title,
        a.description,
        a.metadata,
        a.created_at
    FROM trade_alerts a
    WHERE a.acknowledged = FALSE
    ORDER BY
        CASE a.severity
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
        END,
        a.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;


-- Function to aggregate hourly stats
CREATE OR REPLACE FUNCTION aggregate_hourly_stats(p_hour TIMESTAMPTZ)
RETURNS VOID AS $$
BEGIN
    INSERT INTO trade_stats_hourly (
        hour_start,
        total_trades,
        total_volume_usd,
        unique_traders,
        unique_markets,
        buy_count,
        sell_count,
        avg_trade_size,
        max_trade_size,
        whale_trades,
        whale_volume_usd
    )
    SELECT
        date_trunc('hour', p_hour) as hour_start,
        COUNT(*) as total_trades,
        COALESCE(SUM(usd_value), 0) as total_volume_usd,
        COUNT(DISTINCT trader_address) as unique_traders,
        COUNT(DISTINCT condition_id) as unique_markets,
        COUNT(*) FILTER (WHERE side = 'BUY') as buy_count,
        COUNT(*) FILTER (WHERE side = 'SELL') as sell_count,
        COALESCE(AVG(usd_value), 0) as avg_trade_size,
        COALESCE(MAX(usd_value), 0) as max_trade_size,
        COUNT(*) FILTER (WHERE is_whale = TRUE) as whale_trades,
        COALESCE(SUM(usd_value) FILTER (WHERE is_whale = TRUE), 0) as whale_volume_usd
    FROM live_trades
    WHERE
        received_at >= date_trunc('hour', p_hour)
        AND received_at < date_trunc('hour', p_hour) + INTERVAL '1 hour'
    ON CONFLICT (hour_start) DO UPDATE SET
        total_trades = EXCLUDED.total_trades,
        total_volume_usd = EXCLUDED.total_volume_usd,
        unique_traders = EXCLUDED.unique_traders,
        unique_markets = EXCLUDED.unique_markets,
        buy_count = EXCLUDED.buy_count,
        sell_count = EXCLUDED.sell_count,
        avg_trade_size = EXCLUDED.avg_trade_size,
        max_trade_size = EXCLUDED.max_trade_size,
        whale_trades = EXCLUDED.whale_trades,
        whale_volume_usd = EXCLUDED.whale_volume_usd;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- SECTION 10: VIEWS FOR DASHBOARD
-- ============================================================================

-- Recent whale trades view
CREATE OR REPLACE VIEW v_recent_whales AS
SELECT
    id,
    trade_id,
    trader_address,
    trader_username,
    is_known_trader,
    trader_classification,
    trader_copytrade_score,
    market_slug,
    side,
    outcome,
    usd_value,
    executed_at,
    processing_latency_ms
FROM live_trades
WHERE is_whale = TRUE
ORDER BY received_at DESC
LIMIT 100;


-- Watchlist activity view
CREATE OR REPLACE VIEW v_watchlist_activity AS
SELECT
    t.id,
    t.trade_id,
    t.trader_address,
    t.trader_username,
    t.market_slug,
    t.side,
    t.outcome,
    t.usd_value,
    t.executed_at,
    w.list_type,
    w.notes as watchlist_notes
FROM live_trades t
JOIN watchlist w ON t.trader_address = w.address
WHERE t.is_watchlist = TRUE
ORDER BY t.received_at DESC
LIMIT 100;


-- Trade volume summary (last 24 hours)
CREATE OR REPLACE VIEW v_trade_volume_24h AS
SELECT
    COUNT(*) as total_trades,
    SUM(usd_value) as total_volume,
    COUNT(DISTINCT trader_address) as unique_traders,
    COUNT(DISTINCT condition_id) as unique_markets,
    AVG(usd_value) as avg_trade_size,
    MAX(usd_value) as largest_trade,
    COUNT(*) FILTER (WHERE is_whale) as whale_trades,
    SUM(usd_value) FILTER (WHERE is_whale) as whale_volume,
    AVG(processing_latency_ms) as avg_latency_ms
FROM live_trades
WHERE received_at >= NOW() - INTERVAL '24 hours';
