-- Migration: 010_drop_obsolete_tables.sql
-- Description: Drop all obsolete tables, views, and functions from legacy pipeline system

-- ============================================
-- DROP OBSOLETE VIEWS FIRST (they depend on tables)
-- ============================================

DROP VIEW IF EXISTS v_current_pipeline CASCADE;
DROP VIEW IF EXISTS v_step_progress CASCADE;
DROP VIEW IF EXISTS v_top_copytrade CASCADE;
DROP VIEW IF EXISTS v_likely_bots CASCADE;

-- ============================================
-- DROP OBSOLETE FUNCTIONS
-- ============================================

DROP FUNCTION IF EXISTS create_pipeline_run(INT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS log_pipeline_message(UUID, TEXT, TEXT, INT, TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS update_step_progress(UUID, INT, INT, INT, INT) CASCADE;

-- ============================================
-- DROP OBSOLETE TABLES
-- ============================================

-- Pipeline tracking tables (old batch processing system)
DROP TABLE IF EXISTS pipeline_stats CASCADE;
DROP TABLE IF EXISTS pipeline_logs CASCADE;
DROP TABLE IF EXISTS pipeline_progress CASCADE;
DROP TABLE IF EXISTS pipeline_runs CASCADE;

-- Legacy trader tables (replaced by wallets system)
DROP TABLE IF EXISTS trader_positions CASCADE;
DROP TABLE IF EXISTS trader_closed_positions CASCADE;

-- Note: traders table has a FK from watchlist, need to handle carefully
-- First remove the FK constraint, then drop traders
ALTER TABLE IF EXISTS watchlist DROP CONSTRAINT IF EXISTS watchlist_address_fkey;

DROP TABLE IF EXISTS traders CASCADE;

-- ============================================
-- DROP OBSOLETE INDEXES (if tables still had remnants)
-- ============================================

DROP INDEX IF EXISTS idx_pipeline_runs_status;
DROP INDEX IF EXISTS idx_pipeline_runs_created;
DROP INDEX IF EXISTS idx_pipeline_progress_run;
DROP INDEX IF EXISTS idx_pipeline_logs_run;
DROP INDEX IF EXISTS idx_pipeline_logs_recent;
DROP INDEX IF EXISTS idx_pipeline_stats_run;
DROP INDEX IF EXISTS idx_traders_pipeline_step;
DROP INDEX IF EXISTS idx_traders_copytrade;
DROP INDEX IF EXISTS idx_traders_bot;
DROP INDEX IF EXISTS idx_traders_portfolio;
DROP INDEX IF EXISTS idx_traders_winrate;
DROP INDEX IF EXISTS idx_traders_pnl;
DROP INDEX IF EXISTS idx_traders_last_trade;
DROP INDEX IF EXISTS idx_traders_classification;
DROP INDEX IF EXISTS idx_positions_address;
DROP INDEX IF EXISTS idx_closed_positions_address;

-- ============================================
-- FIX WATCHLIST TABLE (if it was referencing traders)
-- ============================================

-- Ensure watchlist.address doesn't require traders table anymore
-- The address column should just be a TEXT field now
-- (watchlist is now standalone or references wallets)

-- ============================================
-- OPTIONAL: Drop trade_stats_hourly if it exists
-- (appears in screenshot but not in migrations - may be manually created)
-- ============================================

DROP TABLE IF EXISTS trade_stats_hourly CASCADE;

-- ============================================
-- CLEANUP COMPLETE
-- ============================================

-- Summary of dropped objects:
-- Tables: pipeline_runs, pipeline_progress, pipeline_logs, pipeline_stats,
--         traders, trader_positions, trader_closed_positions, trade_stats_hourly
-- Views: v_current_pipeline, v_step_progress, v_top_copytrade, v_likely_bots
-- Functions: create_pipeline_run, log_pipeline_message, update_step_progress
