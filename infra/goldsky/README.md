# Goldsky Mirror Pipelines

This directory contains Goldsky Mirror pipeline configurations for syncing Polymarket data to Supabase.

## Quick Setup

**Windows (PowerShell):**
```powershell
.\infra\goldsky\setup.ps1
```

**Linux/Mac:**
```bash
chmod +x infra/goldsky/setup.sh
./infra/goldsky/setup.sh
```

The setup scripts will:
1. Authenticate with Goldsky using the configured API key
2. Create the Supabase database secret
3. Deploy all three Mirror pipelines

## Manual Setup

### Prerequisites

1. **Install Goldsky CLI**
   ```bash
   npm install -g @goldskycom/cli
   ```

2. **Authenticate**
   ```bash
   goldsky auth set-api-key YOUR_API_KEY
   ```

3. **Create Supabase Database Secret**
   ```bash
   goldsky secret create SUPABASE_POLYMARKET_DB \
     --value "postgres://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres"
   ```

### Deploy Pipelines

Run the database migration first (see `supabase/migrations/014_goldsky_tables.sql`), then:

```bash
goldsky pipeline apply infra/goldsky/polymarket-user-positions.yaml
goldsky pipeline apply infra/goldsky/polymarket-user-balances.yaml
goldsky pipeline apply infra/goldsky/polymarket-order-filled.yaml
```

## Monitor Pipelines

```bash
# List all pipelines
goldsky pipeline list

# Check pipeline status
goldsky pipeline status polymarket-user-positions
goldsky pipeline status polymarket-user-balances
goldsky pipeline status polymarket-order-filled

# View logs
goldsky pipeline logs polymarket-user-positions
```

## Datasets

| Pipeline | Goldsky Dataset | Supabase Table | Purpose |
|----------|-----------------|----------------|---------|
| polymarket-user-positions | `polymarket.user_positions` | `goldsky_user_positions` | Realized PnL, total_bought, avg_price |
| polymarket-user-balances | `polymarket.user_balances` | `goldsky_user_balances` | Share holdings for NAV |
| polymarket-order-filled | `polymarket.order_filled` | `goldsky_order_filled` | Trade timeline for 7d/30d metrics |

## Troubleshooting

### Pipeline stuck or failing
```bash
# Pause pipeline
goldsky pipeline pause polymarket-user-positions

# Resume pipeline
goldsky pipeline resume polymarket-user-positions

# Delete and recreate if needed
goldsky pipeline delete polymarket-user-positions
goldsky pipeline apply infra/goldsky/polymarket-user-positions.yaml
```

### Check data in Supabase
```sql
-- Verify data is flowing
SELECT COUNT(*) FROM goldsky_user_positions;
SELECT COUNT(*) FROM goldsky_user_balances;
SELECT COUNT(*) FROM goldsky_order_filled;

-- Check for specific wallet
SELECT * FROM goldsky_user_positions
WHERE lower("user") = lower('0xYourWallet')
LIMIT 10;
```
