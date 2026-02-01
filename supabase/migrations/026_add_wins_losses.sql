-- Add period-based wins/losses columns to wallets table
-- These track the number of winning/losing positions per time period

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS wins_7d integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses_7d integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins_30d integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses_30d integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins_all integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses_all integer DEFAULT 0;

-- Backfill wins_all / losses_all from existing total_wins / total_losses
UPDATE wallets
SET wins_all = COALESCE(total_wins, 0),
    losses_all = COALESCE(total_losses, 0)
WHERE total_wins IS NOT NULL OR total_losses IS NOT NULL;
