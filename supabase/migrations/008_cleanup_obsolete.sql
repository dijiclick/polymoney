-- Migration: 008_cleanup_obsolete.sql
-- Description: Clean up obsolete database objects after removing legacy pipelines

-- ============================================
-- DROP OBSOLETE FUNCTIONS
-- ============================================

-- Drop the old upsert_wallet function that references 'both' source
DROP FUNCTION IF EXISTS upsert_wallet(TEXT, TEXT, DECIMAL);

-- Drop the old get_wallet_metrics function (we now use pre-calculated metrics)
DROP FUNCTION IF EXISTS get_wallet_metrics(TEXT, INT);

-- ============================================
-- CREATE SIMPLIFIED UPSERT FUNCTION
-- ============================================

-- New simplified upsert function for 'live' source only
CREATE OR REPLACE FUNCTION upsert_wallet(
    p_address TEXT,
    p_source TEXT,
    p_balance DECIMAL DEFAULT NULL
)
RETURNS wallets AS $$
DECLARE
    v_result wallets;
BEGIN
    -- Validate source (only 'live' allowed)
    IF p_source NOT IN ('live') THEN
        RAISE EXCEPTION 'Invalid source: %. Must be live', p_source;
    END IF;

    -- Upsert
    INSERT INTO wallets (address, source, balance, balance_updated_at, updated_at)
    VALUES (
        LOWER(p_address),
        p_source,
        COALESCE(p_balance, 0),
        CASE WHEN p_balance IS NOT NULL THEN NOW() ELSE NULL END,
        NOW()
    )
    ON CONFLICT (address) DO UPDATE SET
        balance = COALESCE(EXCLUDED.balance, wallets.balance),
        balance_updated_at = CASE
            WHEN EXCLUDED.balance IS NOT NULL AND EXCLUDED.balance != wallets.balance THEN NOW()
            ELSE wallets.balance_updated_at
        END,
        updated_at = NOW()
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- CLEANUP: Remove any remaining 'both' or 'leaderboard' source entries
-- ============================================

-- Update any remaining 'both' entries to 'live' (shouldn't exist after 007)
UPDATE wallets SET source = 'live' WHERE source = 'both';

-- Update any remaining 'leaderboard' entries to 'live' (shouldn't exist after 007)
UPDATE wallets SET source = 'live' WHERE source = 'leaderboard';
