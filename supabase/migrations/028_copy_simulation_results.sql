-- Copy trading simulation results cache
CREATE TABLE IF NOT EXISTS copy_simulations (
  id SERIAL PRIMARY KEY,

  -- Input parameters
  address TEXT NOT NULL,
  starting_capital DECIMAL NOT NULL,
  delay_seconds DECIMAL NOT NULL DEFAULT 2,
  time_period_days INTEGER NOT NULL DEFAULT 30,
  slippage_params JSONB NOT NULL DEFAULT '{}',

  -- Summary results
  final_capital DECIMAL,
  total_pnl DECIMAL,
  total_roi DECIMAL,
  win_rate DECIMAL,
  win_count INTEGER,
  loss_count INTEGER,
  trade_count INTEGER,
  skipped_trades INTEGER,
  avg_slippage DECIMAL,
  max_drawdown DECIMAL,

  -- Comparison with original
  original_roi DECIMAL,
  original_pnl DECIMAL,
  original_win_rate DECIMAL,
  performance_ratio DECIMAL,

  -- Open positions
  unrealized_pnl DECIMAL DEFAULT 0,
  open_position_count INTEGER DEFAULT 0,

  -- Detail data (JSON)
  trades_json JSONB,
  positions_json JSONB,
  equity_curve_json JSONB,

  -- Metadata
  simulated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  duration_ms INTEGER,
  total_trades_fetched INTEGER,
  trades_hash TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lookup cached results by parameters
CREATE INDEX IF NOT EXISTS idx_copy_sim_lookup
  ON copy_simulations(address, starting_capital, delay_seconds, time_period_days);

-- List simulations for a wallet
CREATE INDEX IF NOT EXISTS idx_copy_sim_address
  ON copy_simulations(address, simulated_at DESC);

-- Enable public read access
ALTER TABLE copy_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read copy_simulations" ON copy_simulations FOR SELECT USING (true);
CREATE POLICY "Service write copy_simulations" ON copy_simulations FOR ALL USING (true);
