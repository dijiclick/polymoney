-- ============================================================================
-- COPY TRADING TABLES MIGRATION
-- Adds tables for order execution, position tracking, and copy trading audit
-- ============================================================================

-- ============================================================================
-- USER ORDERS TABLE
-- Tracks orders placed by the copy trading system
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Order identification
    order_id TEXT NOT NULL UNIQUE,
    token_id TEXT NOT NULL,

    -- Order details
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    size DECIMAL(18,6) NOT NULL,
    price DECIMAL(10,6) NOT NULL,

    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'open', 'filled', 'partial', 'cancelled', 'failed')),
    filled_size DECIMAL(18,6) DEFAULT 0,

    -- Copy trade source (NULL if manual trade)
    copied_from TEXT,  -- Trader address if copy trade

    -- Error tracking
    error_message TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- USER POSITIONS TABLE
-- Tracks current positions from filled orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Market identification
    market_id TEXT NOT NULL,
    condition_id TEXT NOT NULL,
    token_id TEXT NOT NULL UNIQUE,

    -- Position details
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    size DECIMAL(18,6) NOT NULL,
    avg_price DECIMAL(10,6) NOT NULL,

    -- Current valuation
    current_price DECIMAL(10,6),
    unrealized_pnl DECIMAL(18,2),

    -- Copy trade source
    copied_from TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- COPY TRADE LOG TABLE
-- Audit trail of all copy trade decisions (executed, rejected, failed)
-- ============================================================================

CREATE TABLE IF NOT EXISTS copy_trade_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Source trade info
    source_trader TEXT NOT NULL,
    source_trade_id TEXT NOT NULL,

    -- Our execution
    our_order_id TEXT,  -- NULL if rejected

    -- Market info
    market_id TEXT NOT NULL,
    condition_id TEXT NOT NULL,

    -- Trade details
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    source_size DECIMAL(18,6) NOT NULL,
    copy_size DECIMAL(18,6) NOT NULL,
    source_price DECIMAL(10,6) NOT NULL,
    our_price DECIMAL(10,6) NOT NULL,

    -- Trader scoring
    trader_score INT NOT NULL,

    -- Result
    status TEXT NOT NULL CHECK (status IN ('executed', 'rejected', 'failed')),
    rejection_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- UPDATE WATCHLIST TABLE
-- Add 'copy' list type and copy trading config fields
-- ============================================================================

-- Add 'copy' to list_type if not already present
DO $$
BEGIN
    -- Drop and recreate the constraint with 'copy' included
    ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_list_type_check;
    ALTER TABLE watchlist ADD CONSTRAINT watchlist_list_type_check
        CHECK (list_type IN ('copytrade', 'bot', 'custom', 'copy'));
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- Add copy trading config column if not exists
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS min_trade_size DECIMAL(18,2) DEFAULT 0;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- User orders indexes
CREATE INDEX IF NOT EXISTS idx_user_orders_status ON user_orders(status);
CREATE INDEX IF NOT EXISTS idx_user_orders_token ON user_orders(token_id);
CREATE INDEX IF NOT EXISTS idx_user_orders_created ON user_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_orders_copied_from ON user_orders(copied_from) WHERE copied_from IS NOT NULL;

-- User positions indexes
CREATE INDEX IF NOT EXISTS idx_user_positions_token ON user_positions(token_id);
CREATE INDEX IF NOT EXISTS idx_user_positions_market ON user_positions(market_id);

-- Copy trade log indexes
CREATE INDEX IF NOT EXISTS idx_copy_log_trader ON copy_trade_log(source_trader);
CREATE INDEX IF NOT EXISTS idx_copy_log_status ON copy_trade_log(status);
CREATE INDEX IF NOT EXISTS idx_copy_log_created ON copy_trade_log(created_at DESC);

-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================

-- Enable realtime for copy trading tables
ALTER PUBLICATION supabase_realtime ADD TABLE user_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE user_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE copy_trade_log;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active positions with P&L summary
CREATE OR REPLACE VIEW v_user_positions_summary AS
SELECT
    p.token_id,
    p.market_id,
    p.side,
    p.size,
    p.avg_price,
    p.current_price,
    p.unrealized_pnl,
    p.copied_from,
    p.created_at,
    CASE WHEN p.current_price IS NOT NULL AND p.avg_price > 0
        THEN ROUND(((p.current_price - p.avg_price) / p.avg_price * 100)::DECIMAL, 2)
        ELSE 0
    END as pnl_percent
FROM user_positions p
WHERE p.size > 0
ORDER BY p.created_at DESC;

-- Copy trading performance summary
CREATE OR REPLACE VIEW v_copy_trading_stats AS
SELECT
    DATE_TRUNC('day', created_at) as day,
    COUNT(*) FILTER (WHERE status = 'executed') as executed_count,
    COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
    SUM(copy_size) FILTER (WHERE status = 'executed') as total_volume,
    AVG(trader_score) FILTER (WHERE status = 'executed') as avg_trader_score
FROM copy_trade_log
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day DESC;

-- Top copied traders
CREATE OR REPLACE VIEW v_top_copied_traders AS
SELECT
    source_trader,
    COUNT(*) as copy_count,
    SUM(copy_size * our_price) as total_volume_usd,
    AVG(trader_score) as avg_score,
    MIN(created_at) as first_copy,
    MAX(created_at) as last_copy
FROM copy_trade_log
WHERE status = 'executed'
GROUP BY source_trader
ORDER BY copy_count DESC
LIMIT 50;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get position P&L summary
CREATE OR REPLACE FUNCTION get_portfolio_summary()
RETURNS TABLE (
    total_positions INT,
    total_value DECIMAL,
    total_unrealized_pnl DECIMAL,
    total_cost_basis DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::INT as total_positions,
        COALESCE(SUM(size * COALESCE(current_price, avg_price)), 0) as total_value,
        COALESCE(SUM(unrealized_pnl), 0) as total_unrealized_pnl,
        COALESCE(SUM(size * avg_price), 0) as total_cost_basis
    FROM user_positions
    WHERE size > 0;
END;
$$ LANGUAGE plpgsql;
