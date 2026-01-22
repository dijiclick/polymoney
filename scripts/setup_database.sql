-- ============================================================================
-- POLYMARKET PROFILE FINDER - DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- TABLE: traders
-- Main table storing all trader data and metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS traders (
    -- Primary Key
    address TEXT PRIMARY KEY,

    -- Basic Info
    username TEXT,
    profile_image TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 1: Goldsky Data (from blockchain)
    -- ════════════════════════════════════════════════════════════════════════
    trade_count_30d INT DEFAULT 0,
    trade_count_alltime INT DEFAULT 0,
    last_trade_at TIMESTAMPTZ,
    first_trade_at TIMESTAMPTZ,
    account_age_days INT DEFAULT 0,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 2: Balance Data
    -- ════════════════════════════════════════════════════════════════════════
    portfolio_value DECIMAL(18,2) DEFAULT 0,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 3: Position Data
    -- ════════════════════════════════════════════════════════════════════════
    total_positions INT DEFAULT 0,
    active_positions INT DEFAULT 0,
    avg_position_size DECIMAL(18,2) DEFAULT 0,
    max_position_size DECIMAL(18,2) DEFAULT 0,
    position_concentration DECIMAL(5,2) DEFAULT 0,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 4: Performance Data
    -- ════════════════════════════════════════════════════════════════════════
    -- Win Rate
    closed_positions_30d INT DEFAULT 0,
    winning_positions_30d INT DEFAULT 0,
    win_rate_30d DECIMAL(5,2) DEFAULT 0,

    closed_positions_alltime INT DEFAULT 0,
    winning_positions_alltime INT DEFAULT 0,
    win_rate_alltime DECIMAL(5,2) DEFAULT 0,

    -- PnL & ROI
    total_pnl DECIMAL(18,2) DEFAULT 0,
    realized_pnl DECIMAL(18,2) DEFAULT 0,
    unrealized_pnl DECIMAL(18,2) DEFAULT 0,
    total_invested DECIMAL(18,2) DEFAULT 0,
    roi_percent DECIMAL(10,2) DEFAULT 0,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 5: Advanced Metrics
    -- ════════════════════════════════════════════════════════════════════════
    max_drawdown DECIMAL(5,2) DEFAULT 0,
    trade_frequency DECIMAL(5,2) DEFAULT 0,
    unique_markets_30d INT DEFAULT 0,

    -- Bot Detection Metrics
    trade_time_variance_hours DECIMAL(5,2),
    night_trade_ratio DECIMAL(5,2) DEFAULT 0,
    position_size_variance DECIMAL(5,2),
    avg_hold_duration_hours DECIMAL(10,2),

    -- Insider Detection Metrics
    avg_entry_probability DECIMAL(5,2),
    pnl_concentration DECIMAL(5,2),
    category_concentration TEXT,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 6: Classification Scores
    -- ════════════════════════════════════════════════════════════════════════
    copytrade_score INT DEFAULT 0 CHECK (copytrade_score >= 0 AND copytrade_score <= 100),
    bot_score INT DEFAULT 0 CHECK (bot_score >= 0 AND bot_score <= 100),
    insider_score INT DEFAULT 0 CHECK (insider_score >= 0 AND insider_score <= 100),

    -- Primary classification (highest score)
    primary_classification TEXT CHECK (primary_classification IN ('copytrade', 'bot', 'insider', 'none')),

    -- ════════════════════════════════════════════════════════════════════════
    -- Pipeline Tracking
    -- ════════════════════════════════════════════════════════════════════════
    pipeline_step INT DEFAULT 1 CHECK (pipeline_step >= 1 AND pipeline_step <= 6),
    eliminated_at_step INT,
    elimination_reason TEXT,

    -- ════════════════════════════════════════════════════════════════════════
    -- Metadata
    -- ════════════════════════════════════════════════════════════════════════
    is_platform_wallet BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: trader_positions
-- Current open positions for qualified traders
-- ============================================================================

CREATE TABLE IF NOT EXISTS trader_positions (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,

    -- Market Info
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    category TEXT,

    -- Position Details
    outcome TEXT,
    outcome_index INT,
    size DECIMAL(18,6),
    avg_price DECIMAL(10,6),
    current_price DECIMAL(10,6),

    -- Values
    initial_value DECIMAL(18,2),
    current_value DECIMAL(18,2),
    pnl DECIMAL(18,2),
    pnl_percent DECIMAL(10,2),

    -- Dates
    end_date TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(address, condition_id, outcome_index)
);

-- ============================================================================
-- TABLE: trader_closed_positions
-- Historical resolved positions for performance tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS trader_closed_positions (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,

    -- Market Info
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,

    -- Position Details
    outcome TEXT,
    avg_price DECIMAL(10,6),
    total_bought DECIMAL(18,6),
    final_price DECIMAL(10,6),

    -- Result
    realized_pnl DECIMAL(18,2),
    is_win BOOLEAN,

    -- Timing
    resolved_at TIMESTAMPTZ,

    UNIQUE(address, condition_id, outcome)
);

-- ============================================================================
-- TABLE: watchlist
-- User-curated list of traders to monitor
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchlist (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,

    list_type TEXT NOT NULL CHECK (list_type IN ('copytrade', 'bot', 'insider', 'custom')),
    priority INT DEFAULT 0,

    notes TEXT,
    alert_on_new_trade BOOLEAN DEFAULT FALSE,
    alert_on_large_position BOOLEAN DEFAULT FALSE,
    alert_threshold_usd DECIMAL(18,2) DEFAULT 1000,

    added_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(address, list_type)
);

-- ============================================================================
-- TABLE: pipeline_runs
-- Track execution history
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id BIGSERIAL PRIMARY KEY,

    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

    -- Stats
    addresses_found INT DEFAULT 0,
    addresses_processed INT DEFAULT 0,
    step1_passed INT DEFAULT 0,
    step2_passed INT DEFAULT 0,
    step3_passed INT DEFAULT 0,
    step4_passed INT DEFAULT 0,
    step5_passed INT DEFAULT 0,
    final_qualified INT DEFAULT 0,

    -- Classification Results
    copytrade_found INT DEFAULT 0,
    bot_found INT DEFAULT 0,
    insider_found INT DEFAULT 0,

    -- Performance
    api_calls_made INT DEFAULT 0,
    errors_count INT DEFAULT 0,
    duration_seconds INT,

    error_log TEXT
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Pipeline processing
CREATE INDEX IF NOT EXISTS idx_traders_pipeline_step ON traders(pipeline_step) WHERE eliminated_at_step IS NULL;
CREATE INDEX IF NOT EXISTS idx_traders_eliminated ON traders(eliminated_at_step) WHERE eliminated_at_step IS NOT NULL;

-- Classification queries
CREATE INDEX IF NOT EXISTS idx_traders_copytrade ON traders(copytrade_score DESC) WHERE copytrade_score >= 50;
CREATE INDEX IF NOT EXISTS idx_traders_bot ON traders(bot_score DESC) WHERE bot_score >= 50;
CREATE INDEX IF NOT EXISTS idx_traders_insider ON traders(insider_score DESC) WHERE insider_score >= 50;

-- Common filters
CREATE INDEX IF NOT EXISTS idx_traders_portfolio ON traders(portfolio_value DESC);
CREATE INDEX IF NOT EXISTS idx_traders_winrate ON traders(win_rate_30d DESC);
CREATE INDEX IF NOT EXISTS idx_traders_pnl ON traders(total_pnl DESC);
CREATE INDEX IF NOT EXISTS idx_traders_last_trade ON traders(last_trade_at DESC);

-- Position lookups
CREATE INDEX IF NOT EXISTS idx_positions_address ON trader_positions(address);
CREATE INDEX IF NOT EXISTS idx_closed_positions_address ON trader_closed_positions(address);

-- Watchlist
CREATE INDEX IF NOT EXISTS idx_watchlist_type ON watchlist(list_type);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Top Copy Trade Candidates
CREATE OR REPLACE VIEW v_copytrade_candidates AS
SELECT
    address,
    username,
    portfolio_value,
    win_rate_30d,
    win_rate_alltime,
    roi_percent,
    max_drawdown,
    trade_count_30d,
    unique_markets_30d,
    copytrade_score,
    account_age_days
FROM traders
WHERE
    copytrade_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY copytrade_score DESC;

-- View: Likely Bots
CREATE OR REPLACE VIEW v_likely_bots AS
SELECT
    address,
    username,
    portfolio_value,
    win_rate_30d,
    trade_count_30d,
    trade_frequency,
    night_trade_ratio,
    trade_time_variance_hours,
    bot_score
FROM traders
WHERE
    bot_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY bot_score DESC;

-- View: Insider Suspects
CREATE OR REPLACE VIEW v_insider_suspects AS
SELECT
    address,
    username,
    portfolio_value,
    max_position_size,
    position_concentration,
    avg_entry_probability,
    account_age_days,
    unique_markets_30d,
    insider_score
FROM traders
WHERE
    insider_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY insider_score DESC;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (Optional - customize as needed)
-- ============================================================================

-- ALTER TABLE traders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trader_positions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE trader_closed_positions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant access to service role (adjust as needed for your setup)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
