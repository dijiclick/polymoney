-- Migration: 021_system_settings.sql
-- System settings table for controlling service behavior via dashboard

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT 'true'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT DEFAULT 'system'
);

-- Insert default settings
INSERT INTO system_settings (key, value, updated_by) VALUES
    ('wallet_discovery_enabled', 'true'::jsonb, 'migration')
ON CONFLICT (key) DO NOTHING;

-- Row Level Security
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on system_settings"
    ON system_settings FOR SELECT USING (true);

CREATE POLICY "Allow service role full access on system_settings"
    ON system_settings FOR ALL USING (auth.role() = 'service_role');
