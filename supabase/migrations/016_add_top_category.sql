-- Add top_category column to wallets table
-- Stores the most frequently traded market category for each wallet
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS top_category TEXT DEFAULT '';
