-- Fast substring search via trigram indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes for fast ILIKE search on username and address
CREATE INDEX IF NOT EXISTS idx_wallets_username_trgm
  ON wallets USING gin (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_wallets_address_trgm
  ON wallets USING gin (address gin_trgm_ops);

-- Efficient aggregate stats function (replaces fetching all rows client-side)
CREATE OR REPLACE FUNCTION get_wallet_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM wallets),
    'analyzed', (SELECT count(*) FROM wallets WHERE metrics_updated_at IS NOT NULL),
    'live', (SELECT count(*) FROM wallets WHERE source = 'live'),
    'qualified200', (SELECT count(*) FROM wallets WHERE balance >= 200),
    'totalBalance', (SELECT COALESCE(sum(balance), 0) FROM wallets),
    'avgBalance', (SELECT COALESCE(avg(balance), 0) FROM wallets)
  );
$$;
