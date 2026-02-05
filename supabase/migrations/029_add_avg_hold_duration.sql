-- Add average hold duration column to wallets table
-- Stores the average time (in hours) a trader holds positions before resolution

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS avg_hold_duration_hours DECIMAL;
