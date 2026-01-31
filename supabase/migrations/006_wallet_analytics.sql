-- Migration: 006_wallet_analytics.sql
-- Description: Wallet analytics system with source tracking and trade history

-- ============================================
-- WALLETS TABLE (deduplicated by address)
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
    address TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('live')),
    balance DECIMAL(18,2) DEFAULT 0,
    balance_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for wallets
CREATE INDEX IF NOT EXISTS idx_wallets_source ON wallets(source);
CREATE INDEX IF NOT EXISTS idx_wallets_balance ON wallets(balance DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_balance_qualified ON wallets(balance DESC) WHERE balance >= 200;

-- ============================================
-- WALLET LEADERBOARD RANKINGS (metadata)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_leaderboard_rankings (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
    category TEXT NOT NULL,  -- OVERALL, POLITICS, SPORTS, CRYPTO, CULTURE, MENTIONS, WEATHER, ECONOMICS, TECH, FINANCE
    rank INT NOT NULL,
    pnl DECIMAL(18,2),
    volume DECIMAL(18,2),
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    fetched_date DATE DEFAULT CURRENT_DATE
);

-- Unique constraint on address + category + date (one entry per wallet per category per day)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_rankings_unique
    ON wallet_leaderboard_rankings(address, category, fetched_date);

-- Indexes for rankings
CREATE INDEX IF NOT EXISTS idx_wallet_rankings_address ON wallet_leaderboard_rankings(address);
CREATE INDEX IF NOT EXISTS idx_wallet_rankings_category ON wallet_leaderboard_rankings(category, rank);
CREATE INDEX IF NOT EXISTS idx_wallet_rankings_fetched ON wallet_leaderboard_rankings(fetched_at DESC);

-- ============================================
-- WALLET TRADES (raw trade data - source of truth)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_trades (
    id BIGSERIAL PRIMARY KEY,
    address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
    trade_id TEXT,
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    category TEXT,
    side TEXT CHECK (side IN ('BUY', 'SELL')),
    outcome TEXT,
    outcome_index INT,
    size DECIMAL(18,6),
    price DECIMAL(10,6),
    usd_value DECIMAL(18,2),
    executed_at TIMESTAMPTZ NOT NULL,
    tx_hash TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(address, trade_id)
);

-- Indexes for trades
CREATE INDEX IF NOT EXISTS idx_wallet_trades_address ON wallet_trades(address);
CREATE INDEX IF NOT EXISTS idx_wallet_trades_address_time ON wallet_trades(address, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_trades_executed ON wallet_trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_trades_condition ON wallet_trades(condition_id);
CREATE INDEX IF NOT EXISTS idx_wallet_trades_category ON wallet_trades(category);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to upsert wallet with source logic
CREATE OR REPLACE FUNCTION upsert_wallet(
    p_address TEXT,
    p_source TEXT,
    p_balance DECIMAL DEFAULT NULL
)
RETURNS wallets AS $$
DECLARE
    v_result wallets;
    v_existing_source TEXT;
BEGIN
    -- Check existing source
    SELECT source INTO v_existing_source FROM wallets WHERE address = p_address;

    -- Determine new source
    IF v_existing_source IS NOT NULL AND v_existing_source != p_source THEN
        p_source := 'both';
    END IF;

    -- Upsert
    INSERT INTO wallets (address, source, balance, balance_updated_at, updated_at)
    VALUES (
        p_address,
        p_source,
        COALESCE(p_balance, 0),
        CASE WHEN p_balance IS NOT NULL THEN NOW() ELSE NULL END,
        NOW()
    )
    ON CONFLICT (address) DO UPDATE SET
        source = CASE
            WHEN wallets.source != EXCLUDED.source THEN 'both'
            ELSE wallets.source
        END,
        balance = COALESCE(EXCLUDED.balance, wallets.balance),
        balance_updated_at = CASE
            WHEN EXCLUDED.balance IS NOT NULL AND EXCLUDED.balance != wallets.balance THEN NOW()
            ELSE wallets.balance_updated_at
        END,
        updated_at = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to get wallet metrics for a time period
CREATE OR REPLACE FUNCTION get_wallet_metrics(
    p_address TEXT,
    p_days INT DEFAULT 30
)
RETURNS TABLE (
    total_pnl DECIMAL,
    total_volume DECIMAL,
    trade_count BIGINT,
    buy_count BIGINT,
    sell_count BIGINT,
    unique_markets BIGINT,
    avg_trade_size DECIMAL,
    first_trade TIMESTAMPTZ,
    last_trade TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(
            CASE
                WHEN wt.side = 'SELL' THEN wt.usd_value
                WHEN wt.side = 'BUY' THEN -wt.usd_value
                ELSE 0
            END
        ), 0) as total_pnl,
        COALESCE(SUM(wt.usd_value), 0) as total_volume,
        COUNT(*) as trade_count,
        COUNT(*) FILTER (WHERE wt.side = 'BUY') as buy_count,
        COUNT(*) FILTER (WHERE wt.side = 'SELL') as sell_count,
        COUNT(DISTINCT wt.condition_id) as unique_markets,
        COALESCE(AVG(wt.usd_value), 0) as avg_trade_size,
        MIN(wt.executed_at) as first_trade,
        MAX(wt.executed_at) as last_trade
    FROM wallet_trades wt
    WHERE wt.address = p_address
    AND (p_days = 0 OR wt.executed_at >= NOW() - (p_days || ' days')::INTERVAL);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS
-- ============================================

-- View: Qualified wallets (balance >= $200)
CREATE OR REPLACE VIEW v_qualified_wallets AS
SELECT
    w.*,
    (SELECT array_agg(DISTINCT category) FROM wallet_leaderboard_rankings r WHERE r.address = w.address) as categories,
    (SELECT MIN(rank) FROM wallet_leaderboard_rankings r WHERE r.address = w.address) as best_rank
FROM wallets w
WHERE w.balance >= 200;

-- View: Leaderboard summary by category
CREATE OR REPLACE VIEW v_leaderboard_summary AS
SELECT
    category,
    COUNT(DISTINCT address) as wallet_count,
    AVG(rank) as avg_rank,
    SUM(pnl) as total_pnl,
    SUM(volume) as total_volume
FROM wallet_leaderboard_rankings
WHERE fetched_at >= NOW() - INTERVAL '7 days'
GROUP BY category
ORDER BY wallet_count DESC;

-- ============================================
-- ENABLE REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE wallet_trades;

-- ============================================
-- ROW LEVEL SECURITY (optional, for public read)
-- ============================================
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_leaderboard_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_trades ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read on wallets" ON wallets FOR SELECT USING (true);
CREATE POLICY "Allow public read on rankings" ON wallet_leaderboard_rankings FOR SELECT USING (true);
CREATE POLICY "Allow public read on trades" ON wallet_trades FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access on wallets" ON wallets FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on rankings" ON wallet_leaderboard_rankings FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access on trades" ON wallet_trades FOR ALL USING (auth.role() = 'service_role');
