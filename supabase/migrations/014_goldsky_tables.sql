-- Migration: 014_goldsky_tables.sql
-- Description: Create tables for Goldsky Mirror pipeline data
--
-- These tables receive data from Goldsky's Polymarket datasets via Mirror pipelines.
-- The schemas match Goldsky's curated data format.

-- ============================================
-- GOLDSKY USER POSITIONS
-- ============================================
-- Source: polymarket.user_positions
-- Contains aggregated position data per user/token

CREATE TABLE IF NOT EXISTS goldsky_user_positions (
    id TEXT PRIMARY KEY,                    -- Goldsky record ID
    "user" TEXT NOT NULL,                   -- Wallet address (proxy wallet)
    token_id TEXT NOT NULL,                 -- Outcome token ID
    amount DECIMAL(38,0),                   -- Token amount (shares held)
    avg_price DECIMAL(38,18),               -- Average entry price
    realized_pnl DECIMAL(38,6),             -- Realized PnL in USDC
    total_bought DECIMAL(38,6),             -- Total USDC invested
    block_number BIGINT,                    -- Block number of last update
    block_timestamp BIGINT,                 -- Timestamp of last update
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_positions
CREATE INDEX IF NOT EXISTS idx_goldsky_positions_user ON goldsky_user_positions(lower("user"));
CREATE INDEX IF NOT EXISTS idx_goldsky_positions_token ON goldsky_user_positions(token_id);
CREATE INDEX IF NOT EXISTS idx_goldsky_positions_user_token ON goldsky_user_positions(lower("user"), token_id);
CREATE INDEX IF NOT EXISTS idx_goldsky_positions_pnl ON goldsky_user_positions(realized_pnl DESC);

-- ============================================
-- GOLDSKY USER BALANCES
-- ============================================
-- Source: polymarket.user_balances
-- Contains current token balances per user

CREATE TABLE IF NOT EXISTS goldsky_user_balances (
    id TEXT PRIMARY KEY,                    -- Goldsky record ID
    "user" TEXT NOT NULL,                   -- Wallet address (proxy wallet)
    asset TEXT NOT NULL,                    -- Asset/token ID
    balance DECIMAL(38,0),                  -- Current balance
    block_number BIGINT,                    -- Block number of last update
    block_timestamp BIGINT,                 -- Timestamp of last update
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_balances
CREATE INDEX IF NOT EXISTS idx_goldsky_balances_user ON goldsky_user_balances(lower("user"));
CREATE INDEX IF NOT EXISTS idx_goldsky_balances_asset ON goldsky_user_balances(asset);
CREATE INDEX IF NOT EXISTS idx_goldsky_balances_user_asset ON goldsky_user_balances(lower("user"), asset);

-- ============================================
-- GOLDSKY ORDER FILLED
-- ============================================
-- Source: polymarket.order_filled
-- Contains individual fill events (trade timeline)

CREATE TABLE IF NOT EXISTS goldsky_order_filled (
    id TEXT PRIMARY KEY,                    -- Goldsky record ID
    "timestamp" BIGINT NOT NULL,            -- Unix timestamp of fill
    transaction_hash TEXT,                  -- Transaction hash
    log_index INTEGER,                      -- Log index in transaction
    maker TEXT NOT NULL,                    -- Maker address
    taker TEXT NOT NULL,                    -- Taker address
    maker_asset_id TEXT,                    -- Maker's asset token ID
    taker_asset_id TEXT,                    -- Taker's asset token ID
    maker_amount_filled DECIMAL(38,0),      -- Amount filled from maker
    taker_amount_filled DECIMAL(38,0),      -- Amount filled from taker (USDC)
    fee DECIMAL(38,0),                      -- Fee amount
    block_number BIGINT,                    -- Block number
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for order_filled (optimized for timeline queries)
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_maker ON goldsky_order_filled(lower(maker));
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_taker ON goldsky_order_filled(lower(taker));
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_timestamp ON goldsky_order_filled("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_maker_time ON goldsky_order_filled(lower(maker), "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_taker_time ON goldsky_order_filled(lower(taker), "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_maker_asset ON goldsky_order_filled(maker_asset_id);
CREATE INDEX IF NOT EXISTS idx_goldsky_filled_taker_asset ON goldsky_order_filled(taker_asset_id);

-- ============================================
-- TOKEN MARKET MAPPING
-- ============================================
-- Maps token_id to condition_id/outcome for metrics grouping
-- Populated from Polymarket Subgraph or Gamma API

CREATE TABLE IF NOT EXISTS token_market_mapping (
    token_id TEXT PRIMARY KEY,              -- Outcome token ID
    condition_id TEXT NOT NULL,             -- Market condition ID
    outcome TEXT,                           -- Outcome name (Yes/No)
    outcome_index INTEGER,                  -- Outcome index (0 or 1)
    market_slug TEXT,                       -- Market slug for UI
    question TEXT,                          -- Market question
    end_date TIMESTAMPTZ,                   -- Market end date
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for token mapping
CREATE INDEX IF NOT EXISTS idx_token_mapping_condition ON token_market_mapping(condition_id);
CREATE INDEX IF NOT EXISTS idx_token_mapping_slug ON token_market_mapping(market_slug);

-- ============================================
-- HELPER FUNCTION: Get user fills with market info
-- ============================================

CREATE OR REPLACE FUNCTION get_user_fills_with_market(
    p_address TEXT,
    p_days INT DEFAULT 0
)
RETURNS TABLE (
    fill_timestamp BIGINT,
    is_maker BOOLEAN,
    token_id TEXT,
    condition_id TEXT,
    outcome TEXT,
    amount_filled DECIMAL,
    usdc_amount DECIMAL,
    fee DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f."timestamp" as fill_timestamp,
        lower(f.maker) = lower(p_address) as is_maker,
        CASE WHEN lower(f.maker) = lower(p_address) THEN f.maker_asset_id ELSE f.taker_asset_id END as token_id,
        m.condition_id,
        m.outcome,
        CASE WHEN lower(f.maker) = lower(p_address) THEN f.maker_amount_filled ELSE f.taker_amount_filled END as amount_filled,
        CASE WHEN lower(f.maker) = lower(p_address) THEN f.taker_amount_filled ELSE f.maker_amount_filled END as usdc_amount,
        f.fee
    FROM goldsky_order_filled f
    LEFT JOIN token_market_mapping m ON (
        CASE WHEN lower(f.maker) = lower(p_address) THEN f.maker_asset_id ELSE f.taker_asset_id END = m.token_id
    )
    WHERE (lower(f.maker) = lower(p_address) OR lower(f.taker) = lower(p_address))
    AND (p_days = 0 OR f."timestamp" >= EXTRACT(EPOCH FROM NOW() - (p_days || ' days')::INTERVAL))
    ORDER BY f."timestamp" DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Get user position summary from Goldsky
-- ============================================

CREATE OR REPLACE FUNCTION get_goldsky_position_summary(p_address TEXT)
RETURNS TABLE (
    total_realized_pnl DECIMAL,
    total_bought DECIMAL,
    position_count BIGINT,
    token_ids TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(p.realized_pnl), 0) as total_realized_pnl,
        COALESCE(SUM(p.total_bought), 0) as total_bought,
        COUNT(*) as position_count,
        ARRAY_AGG(p.token_id) as token_ids
    FROM goldsky_user_positions p
    WHERE lower(p."user") = lower(p_address);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE goldsky_user_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goldsky_user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE goldsky_order_filled ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_market_mapping ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read on goldsky_user_positions" ON goldsky_user_positions FOR SELECT USING (true);
CREATE POLICY "Allow public read on goldsky_user_balances" ON goldsky_user_balances FOR SELECT USING (true);
CREATE POLICY "Allow public read on goldsky_order_filled" ON goldsky_order_filled FOR SELECT USING (true);
CREATE POLICY "Allow public read on token_market_mapping" ON token_market_mapping FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role on goldsky_user_positions" ON goldsky_user_positions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role on goldsky_user_balances" ON goldsky_user_balances FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role on goldsky_order_filled" ON goldsky_order_filled FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role on token_market_mapping" ON token_market_mapping FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE goldsky_user_positions IS 'Goldsky-synced user position data from polymarket.user_positions';
COMMENT ON TABLE goldsky_user_balances IS 'Goldsky-synced user balance data from polymarket.user_balances';
COMMENT ON TABLE goldsky_order_filled IS 'Goldsky-synced order fill events from polymarket.order_filled';
COMMENT ON TABLE token_market_mapping IS 'Mapping from token_id to condition_id/outcome for metrics grouping';

COMMENT ON COLUMN goldsky_user_positions.realized_pnl IS 'Realized PnL - may need scaling (check if raw value or USDC 6 decimals)';
COMMENT ON COLUMN goldsky_user_positions.total_bought IS 'Total USDC invested - may need scaling';
COMMENT ON COLUMN goldsky_order_filled.taker_amount_filled IS 'Usually USDC amount - may need scaling (6 decimals)';
