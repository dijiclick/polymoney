-- Migration: 025_goldsky_wallets.sql
-- Goldsky dashboard: separate wallets table for Goldsky-analyzed metrics
-- Same schema as wallets so WalletTable component works unchanged

CREATE TABLE IF NOT EXISTS goldsky_wallets (
    address TEXT PRIMARY KEY,
    source TEXT DEFAULT 'goldsky',
    balance DECIMAL(18,2) DEFAULT 0,
    balance_updated_at TIMESTAMPTZ,
    username TEXT,
    account_created_at TIMESTAMPTZ,

    -- 7-day metrics
    pnl_7d DECIMAL DEFAULT 0,
    roi_7d DECIMAL DEFAULT 0,
    win_rate_7d DECIMAL DEFAULT 0,
    volume_7d DECIMAL DEFAULT 0,
    trade_count_7d INTEGER DEFAULT 0,
    drawdown_7d DECIMAL DEFAULT 0,

    -- 30-day metrics
    pnl_30d DECIMAL DEFAULT 0,
    roi_30d DECIMAL DEFAULT 0,
    win_rate_30d DECIMAL DEFAULT 0,
    volume_30d DECIMAL DEFAULT 0,
    trade_count_30d INTEGER DEFAULT 0,
    drawdown_30d DECIMAL DEFAULT 0,

    -- All-time metrics
    pnl_all DECIMAL DEFAULT 0,
    roi_all DECIMAL DEFAULT 0,
    win_rate_all DECIMAL DEFAULT 0,
    volume_all DECIMAL DEFAULT 0,
    trade_count_all INTEGER DEFAULT 0,
    drawdown_all DECIMAL DEFAULT 0,
    drawdown_amount_all DECIMAL DEFAULT 0,

    -- Position counts
    total_positions INTEGER DEFAULT 0,
    active_positions INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    total_losses INTEGER DEFAULT 0,

    -- PnL breakdown
    realized_pnl DECIMAL DEFAULT 0,
    unrealized_pnl DECIMAL DEFAULT 0,
    overall_pnl DECIMAL DEFAULT 0,
    overall_roi DECIMAL DEFAULT 0,
    overall_win_rate DECIMAL DEFAULT 0,
    total_volume DECIMAL DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    top_category TEXT,

    -- Copy-trade metrics
    profit_factor_30d DECIMAL DEFAULT 0,
    profit_factor_all DECIMAL DEFAULT 0,
    diff_win_rate_30d DECIMAL DEFAULT 0,
    diff_win_rate_all DECIMAL DEFAULT 0,
    weekly_profit_rate DECIMAL DEFAULT 0,
    copy_score DECIMAL DEFAULT 0,
    avg_trades_per_day DECIMAL DEFAULT 0,
    median_profit_pct DECIMAL,

    -- Metadata
    metrics_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sorting and filtering (matching main wallets table patterns)
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_copy_score ON goldsky_wallets(copy_score DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_overall_pnl ON goldsky_wallets(overall_pnl DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_volume_30d ON goldsky_wallets(volume_30d DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_balance ON goldsky_wallets(balance DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_pnl_30d ON goldsky_wallets(pnl_30d DESC);
CREATE INDEX IF NOT EXISTS idx_goldsky_wallets_win_rate_30d ON goldsky_wallets(win_rate_30d DESC);

-- Row Level Security
ALTER TABLE goldsky_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on goldsky_wallets"
    ON goldsky_wallets FOR SELECT USING (true);

CREATE POLICY "Allow service role full access on goldsky_wallets"
    ON goldsky_wallets FOR ALL USING (auth.role() = 'service_role');

-- Add analysis_mode setting (main or goldsky)
INSERT INTO system_settings (key, value, updated_by) VALUES
    ('analysis_mode', '"main"'::jsonb, 'migration')
ON CONFLICT (key) DO NOTHING;
