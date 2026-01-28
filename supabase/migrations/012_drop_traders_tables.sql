-- Migration: 012_drop_traders_tables.sql
-- Description: Drop obsolete traders and trader_positions tables
-- These tables are replaced by the unified 'wallets' table

-- Drop tables that are no longer used
DROP TABLE IF EXISTS trader_positions CASCADE;
DROP TABLE IF EXISTS trader_closed_positions CASCADE;
DROP TABLE IF EXISTS traders CASCADE;
