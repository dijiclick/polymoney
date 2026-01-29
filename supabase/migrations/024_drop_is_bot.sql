-- Remove is_bot column (bot detection removed from scoring)
ALTER TABLE wallets DROP COLUMN IF EXISTS is_bot;
