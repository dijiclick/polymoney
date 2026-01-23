-- ============================================================================
-- MIGRATION 004: Add Insider Detection Fields
-- ============================================================================

-- Add insider fields to traders table
ALTER TABLE traders ADD COLUMN IF NOT EXISTS insider_score INTEGER DEFAULT 0;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS insider_level TEXT;
ALTER TABLE traders ADD COLUMN IF NOT EXISTS insider_red_flags TEXT[];
ALTER TABLE traders ADD COLUMN IF NOT EXISTS avg_entry_probability DECIMAL(5,2);
ALTER TABLE traders ADD COLUMN IF NOT EXISTS pnl_concentration DECIMAL(5,2);
ALTER TABLE traders ADD COLUMN IF NOT EXISTS category_focus TEXT;

-- Add insider fields to live_trades table
ALTER TABLE live_trades ADD COLUMN IF NOT EXISTS is_insider_suspect BOOLEAN DEFAULT FALSE;
ALTER TABLE live_trades ADD COLUMN IF NOT EXISTS trader_insider_score INTEGER;
ALTER TABLE live_trades ADD COLUMN IF NOT EXISTS trader_insider_level TEXT;
ALTER TABLE live_trades ADD COLUMN IF NOT EXISTS trader_red_flags TEXT[];

-- Add watchlist fields for alert configuration (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'watchlist' AND column_name = 'min_trade_size'
    ) THEN
        ALTER TABLE watchlist ADD COLUMN min_trade_size DECIMAL(18,2) DEFAULT 0;
    END IF;
END $$;

-- Update alert_rules check constraint to include insider_activity
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_rule_type_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_rule_type_check
    CHECK (rule_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected',
        'insider_activity'
    ));

-- Update trade_alerts check constraint to include insider_activity
ALTER TABLE trade_alerts DROP CONSTRAINT IF EXISTS trade_alerts_alert_type_check;
ALTER TABLE trade_alerts ADD CONSTRAINT trade_alerts_alert_type_check
    CHECK (alert_type IN (
        'whale_trade',
        'watchlist_activity',
        'unusual_time',
        'concentration',
        'new_market_entry',
        'pattern_detected',
        'insider_activity'
    ));

-- Index for fast insider queries
CREATE INDEX IF NOT EXISTS idx_traders_insider_score
ON traders(insider_score DESC)
WHERE insider_score >= 60;

CREATE INDEX IF NOT EXISTS idx_traders_insider_level
ON traders(insider_level)
WHERE insider_level IN ('very_high', 'high');

-- Index for live trades from insider suspects
CREATE INDEX IF NOT EXISTS idx_live_trades_insider
ON live_trades(trader_insider_score DESC)
WHERE is_insider_suspect = TRUE;

-- View for insider suspects
CREATE OR REPLACE VIEW v_insider_suspects AS
SELECT
    address,
    username,
    portfolio_value,
    total_pnl,
    roi_percent,
    win_rate_30d,
    account_age_days,
    unique_markets_30d,
    position_concentration,
    max_position_size,
    avg_entry_probability,
    insider_score,
    insider_level,
    insider_red_flags,
    last_trade_at,
    last_updated_at
FROM traders
WHERE
    insider_score >= 60
    AND eliminated_at_step IS NULL
ORDER BY insider_score DESC;

-- View for recent insider trades
CREATE OR REPLACE VIEW v_insider_trades AS
SELECT
    lt.trade_id,
    lt.trader_address,
    lt.trader_username,
    lt.trader_insider_score,
    lt.trader_insider_level,
    lt.trader_red_flags,
    lt.market_slug,
    lt.event_slug,
    lt.side,
    lt.outcome,
    lt.usd_value,
    lt.price,
    lt.executed_at,
    lt.received_at,
    lt.is_whale
FROM live_trades lt
WHERE lt.is_insider_suspect = TRUE
ORDER BY lt.received_at DESC;

-- Add insider alert rules
INSERT INTO alert_rules (name, rule_type, conditions, alert_severity, enabled)
VALUES
    ('Insider Activity', 'insider_activity', '{"min_score": 60}', 'warning', true),
    ('High-Risk Insider Trade', 'insider_activity', '{"min_score": 80, "min_usd_value": 5000}', 'critical', true)
ON CONFLICT DO NOTHING;
