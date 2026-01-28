#!/bin/bash
# Goldsky Setup Script for Polymarket Analytics
#
# This script sets up Goldsky Mirror pipelines to sync Polymarket data to Supabase.
#
# Prerequisites:
#   - Goldsky CLI installed: curl -fsSL https://goldsky.com/install | sh
#   - Goldsky account with API access

set -e

# Goldsky API Key
export GOLDSKY_API_KEY="cmku971nm23yk01uce8nv3ycc"

# Supabase Session Pooler Connection (IPv4 compatible - JSON format for Goldsky)
SUPABASE_SECRET_JSON='{"type":"jdbc","protocol":"postgresql","host":"aws-1-ap-south-1.pooler.supabase.com","port":5432,"databaseName":"postgres","user":"postgres.rrpjxbnqrjlnqnlgicdk","password":"XSj042zrQU5KnS6g"}'

echo "=== Goldsky Setup for Polymarket Analytics ==="
echo ""

# Check if goldsky CLI is installed
if ! command -v goldsky &> /dev/null; then
    echo "Installing Goldsky CLI via npm..."
    npm install -g @goldskycom/cli
fi

echo "Goldsky CLI version:"
goldsky --version

# Authenticate with API key
echo ""
echo "=== Authenticating with Goldsky ==="
goldsky auth set-api-key "$GOLDSKY_API_KEY"

# Create database secret
echo ""
echo "=== Creating Supabase Database Secret ==="
goldsky secret create --name SUPABASE_POLYMARKET_DB --value "$SUPABASE_SECRET_JSON" 2>/dev/null || \
    echo "Secret may already exist, continuing..."

# Apply pipelines
echo ""
echo "=== Deploying Mirror Pipelines ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Deploying polymarket-user-positions..."
goldsky pipeline apply "$SCRIPT_DIR/polymarket-user-positions.yaml" || echo "Failed to deploy user-positions"

echo "Deploying polymarket-user-balances..."
goldsky pipeline apply "$SCRIPT_DIR/polymarket-user-balances.yaml" || echo "Failed to deploy user-balances"

echo "Deploying polymarket-order-filled..."
goldsky pipeline apply "$SCRIPT_DIR/polymarket-order-filled.yaml" || echo "Failed to deploy order-filled"

# Check pipeline status
echo ""
echo "=== Pipeline Status ==="
goldsky pipeline list

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Run the database migration: supabase db push"
echo "2. Sync token mappings: python scripts/sync_token_mapping.py --full"
echo "3. Start the service with data_source='both' to validate"
echo ""
echo "Monitor pipelines:"
echo "  goldsky pipeline status polymarket-user-positions"
echo "  goldsky pipeline logs polymarket-user-positions"
