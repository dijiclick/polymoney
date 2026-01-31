-- ============================================================================
-- POLYMARKET PROFILE FINDER - SUPABASE SCHEMA v2.0
-- With Real-time Progress Tracking
-- ============================================================================


-- ============================================================================
-- SECTION 1: PIPELINE TRACKING (For Live Dashboard)
-- ============================================================================

-- Main pipeline runs table
CREATE TABLE pipeline_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    current_step INT DEFAULT 0,
    current_step_name TEXT DEFAULT 'Initializing',

    -- Progress
    progress_percent DECIMAL(5,2) DEFAULT 0,

    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    -- Configuration
    config JSONB DEFAULT '{}',
    days_to_scan INT DEFAULT 30,

    -- Results Summary
    total_addresses_found INT DEFAULT 0,
    step1_passed INT DEFAULT 0,
    step2_passed INT DEFAULT 0,
    step3_passed INT DEFAULT 0,
    step4_passed INT DEFAULT 0,
    step5_passed INT DEFAULT 0,
    final_qualified INT DEFAULT 0,

    -- Classification Results
    copytrade_found INT DEFAULT 0,
    bot_found INT DEFAULT 0,

    -- Performance
    api_calls_made INT DEFAULT 0,
    errors_count INT DEFAULT 0,

    -- Error tracking
    last_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step-by-step progress tracking
CREATE TABLE pipeline_progress (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,

    step_number INT NOT NULL,
    step_name TEXT NOT NULL,

    -- Progress
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'skipped', 'failed')),
    total_items INT DEFAULT 0,
    processed_items INT DEFAULT 0,
    passed_items INT DEFAULT 0,
    failed_items INT DEFAULT 0,

    -- Timing
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Speed metrics
    items_per_second DECIMAL(10,2) DEFAULT 0,
    estimated_remaining_seconds INT,

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(run_id, step_number)
);

-- Real-time log entries (for live feed)
CREATE TABLE pipeline_logs (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,

    -- Log details
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    level TEXT DEFAULT 'info' CHECK (level IN ('debug', 'info', 'success', 'warning', 'error')),
    step_number INT,

    -- Content
    message TEXT NOT NULL,
    address TEXT,  -- Optional: trader address involved
    details JSONB, -- Optional: extra data

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time stats (updated frequently)
CREATE TABLE pipeline_stats (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,

    timestamp TIMESTAMPTZ DEFAULT NOW(),

    -- Current metrics
    addresses_found INT DEFAULT 0,
    addresses_processed INT DEFAULT 0,
    addresses_qualified INT DEFAULT 0,
    addresses_eliminated INT DEFAULT 0,

    -- Speed
    current_speed DECIMAL(10,2) DEFAULT 0,  -- items per second
    api_calls_total INT DEFAULT 0,
    api_calls_per_minute DECIMAL(10,2) DEFAULT 0,

    -- Memory/Performance
    memory_usage_mb DECIMAL(10,2),

    UNIQUE(run_id, timestamp)
);


-- ============================================================================
-- SECTION 2: TRADER DATA TABLES
-- ============================================================================

-- Main traders table
CREATE TABLE traders (
    -- Primary Key
    address TEXT PRIMARY KEY,

    -- Basic Info
    username TEXT,
    profile_image TEXT,

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 1: Trade Data
    -- ════════════════════════════════════════════════════════════════════════
    trade_count_30d INT DEFAULT 0,
    trade_count_alltime INT DEFAULT 0,
    first_trade_at TIMESTAMPTZ,
    last_trade_at TIMESTAMPTZ,
    account_age_days INT,

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

    -- Bot Detection
    trade_time_variance_hours DECIMAL(5,2),
    night_trade_ratio DECIMAL(5,2) DEFAULT 0,
    position_size_variance DECIMAL(5,2),
    avg_hold_duration_hours DECIMAL(10,2),

    -- ════════════════════════════════════════════════════════════════════════
    -- STEP 6: Classification
    -- ════════════════════════════════════════════════════════════════════════
    copytrade_score INT DEFAULT 0,
    bot_score INT DEFAULT 0,
    primary_classification TEXT CHECK (primary_classification IN ('copytrade', 'bot', 'none', NULL)),

    -- ════════════════════════════════════════════════════════════════════════
    -- Pipeline Tracking
    -- ════════════════════════════════════════════════════════════════════════
    pipeline_step INT DEFAULT 1,
    eliminated_at_step INT,
    elimination_reason TEXT,
    last_run_id UUID,

    -- ════════════════════════════════════════════════════════════════════════
    -- Metadata
    -- ════════════════════════════════════════════════════════════════════════
    is_platform_wallet BOOLEAN DEFAULT FALSE,
    notes TEXT,

    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Current open positions
CREATE TABLE trader_positions (
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

-- Closed/resolved positions
CREATE TABLE trader_closed_positions (
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

-- User watchlist
CREATE TABLE watchlist (
    id BIGSERIAL PRIMARY KEY,
    address TEXT REFERENCES traders(address) ON DELETE CASCADE,

    list_type TEXT NOT NULL CHECK (list_type IN ('copytrade', 'bot', 'custom')),
    priority INT DEFAULT 0,

    notes TEXT,
    alert_on_new_trade BOOLEAN DEFAULT FALSE,
    alert_threshold_usd DECIMAL(18,2) DEFAULT 1000,

    added_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(address, list_type)
);


-- ============================================================================
-- SECTION 3: INDEXES
-- ============================================================================

-- Pipeline tracking indexes
CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_created ON pipeline_runs(created_at DESC);
CREATE INDEX idx_pipeline_progress_run ON pipeline_progress(run_id);
CREATE INDEX idx_pipeline_logs_run ON pipeline_logs(run_id, timestamp DESC);
CREATE INDEX idx_pipeline_logs_recent ON pipeline_logs(timestamp DESC);
CREATE INDEX idx_pipeline_stats_run ON pipeline_stats(run_id, timestamp DESC);

-- Trader indexes
CREATE INDEX idx_traders_pipeline_step ON traders(pipeline_step) WHERE eliminated_at_step IS NULL;
CREATE INDEX idx_traders_copytrade ON traders(copytrade_score DESC) WHERE copytrade_score >= 50;
CREATE INDEX idx_traders_bot ON traders(bot_score DESC) WHERE bot_score >= 50;
CREATE INDEX idx_traders_portfolio ON traders(portfolio_value DESC);
CREATE INDEX idx_traders_winrate ON traders(win_rate_30d DESC);
CREATE INDEX idx_traders_pnl ON traders(total_pnl DESC);
CREATE INDEX idx_traders_last_trade ON traders(last_trade_at DESC);
CREATE INDEX idx_traders_classification ON traders(primary_classification);

-- Position indexes
CREATE INDEX idx_positions_address ON trader_positions(address);
CREATE INDEX idx_closed_positions_address ON trader_closed_positions(address);
CREATE INDEX idx_watchlist_type ON watchlist(list_type);


-- ============================================================================
-- SECTION 4: REAL-TIME SUBSCRIPTIONS (Enable in Supabase)
-- ============================================================================

-- Enable real-time for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_stats;


-- ============================================================================
-- SECTION 5: VIEWS
-- ============================================================================

-- Current pipeline status (for dashboard header)
CREATE VIEW v_current_pipeline AS
SELECT
    r.id,
    r.status,
    r.current_step,
    r.current_step_name,
    r.progress_percent,
    r.started_at,
    r.total_addresses_found,
    r.final_qualified,
    r.copytrade_found,
    r.bot_found,
    r.api_calls_made,
    r.errors_count,
    EXTRACT(EPOCH FROM (NOW() - r.started_at)) as elapsed_seconds
FROM pipeline_runs r
ORDER BY r.created_at DESC
LIMIT 1;

-- Step progress summary
CREATE VIEW v_step_progress AS
SELECT
    p.run_id,
    p.step_number,
    p.step_name,
    p.status,
    p.total_items,
    p.processed_items,
    p.passed_items,
    p.failed_items,
    CASE WHEN p.total_items > 0
         THEN ROUND((p.processed_items::DECIMAL / p.total_items) * 100, 1)
         ELSE 0
    END as progress_percent,
    p.items_per_second,
    p.estimated_remaining_seconds
FROM pipeline_progress p
ORDER BY p.run_id, p.step_number;

-- Top copy trade candidates
CREATE VIEW v_top_copytrade AS
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
    copytrade_score >= 50
    AND eliminated_at_step IS NULL
ORDER BY copytrade_score DESC
LIMIT 100;

-- Likely bots
CREATE VIEW v_likely_bots AS
SELECT
    address,
    username,
    portfolio_value,
    win_rate_30d,
    trade_count_30d,
    trade_frequency,
    night_trade_ratio,
    bot_score
FROM traders
WHERE
    bot_score >= 50
    AND eliminated_at_step IS NULL
ORDER BY bot_score DESC
LIMIT 100;


-- ============================================================================
-- SECTION 6: HELPER FUNCTIONS
-- ============================================================================

-- Function to create a new pipeline run
CREATE OR REPLACE FUNCTION create_pipeline_run(p_days INT DEFAULT 30, p_config JSONB DEFAULT '{}')
RETURNS UUID AS $$
DECLARE
    v_run_id UUID;
BEGIN
    INSERT INTO pipeline_runs (days_to_scan, config, status)
    VALUES (p_days, p_config, 'pending')
    RETURNING id INTO v_run_id;

    -- Create progress entries for each step
    INSERT INTO pipeline_progress (run_id, step_number, step_name, status)
    VALUES
        (v_run_id, 1, 'Trade Extraction', 'pending'),
        (v_run_id, 2, 'Balance Check', 'pending'),
        (v_run_id, 3, 'Positions Analysis', 'pending'),
        (v_run_id, 4, 'Win Rate Calculation', 'pending'),
        (v_run_id, 5, 'Deep Analysis', 'pending'),
        (v_run_id, 6, 'Classification', 'pending');

    RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;

-- Function to log a message
CREATE OR REPLACE FUNCTION log_pipeline_message(
    p_run_id UUID,
    p_level TEXT,
    p_message TEXT,
    p_step INT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_details JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO pipeline_logs (run_id, level, message, step_number, address, details)
    VALUES (p_run_id, p_level, p_message, p_step, p_address, p_details);
END;
$$ LANGUAGE plpgsql;

-- Function to update step progress
CREATE OR REPLACE FUNCTION update_step_progress(
    p_run_id UUID,
    p_step INT,
    p_processed INT,
    p_passed INT,
    p_total INT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    UPDATE pipeline_progress
    SET
        processed_items = p_processed,
        passed_items = p_passed,
        failed_items = p_processed - p_passed,
        total_items = COALESCE(p_total, total_items),
        updated_at = NOW()
    WHERE run_id = p_run_id AND step_number = p_step;
END;
$$ LANGUAGE plpgsql;
