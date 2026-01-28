# Goldsky Setup Script for Polymarket Analytics (Windows PowerShell)
#
# This script sets up Goldsky Mirror pipelines to sync Polymarket data to Supabase.
#
# Prerequisites:
#   - Goldsky CLI installed
#   - Goldsky account with API access
#
# Usage: .\setup.ps1

$ErrorActionPreference = "Stop"

# Goldsky API Key
$env:GOLDSKY_API_KEY = "cmku971nm23yk01uce8nv3ycc"

# Supabase Session Pooler Connection (IPv4 compatible)
$SUPABASE_SECRET_JSON = '{"type":"jdbc","protocol":"postgresql","host":"aws-1-ap-south-1.pooler.supabase.com","port":5432,"databaseName":"postgres","user":"postgres.rrpjxbnqrjlnqnlgicdk","password":"XSj042zrQU5KnS6g"}'

Write-Host "=== Goldsky Setup for Polymarket Analytics ===" -ForegroundColor Cyan
Write-Host ""

# Check if goldsky CLI is installed
$goldskyPath = Get-Command goldsky -ErrorAction SilentlyContinue
if (-not $goldskyPath) {
    Write-Host "Goldsky CLI not found. Installing via npm..." -ForegroundColor Yellow
    npm install -g @goldskycom/cli
    $goldskyPath = Get-Command goldsky -ErrorAction SilentlyContinue
    if (-not $goldskyPath) {
        Write-Host "Failed to install Goldsky CLI. Please install manually:" -ForegroundColor Red
        Write-Host "  npm install -g @goldskycom/cli" -ForegroundColor White
        exit 1
    }
}

Write-Host "Goldsky CLI found at: $($goldskyPath.Source)"
goldsky --version

# Authenticate with API key
Write-Host ""
Write-Host "=== Authenticating with Goldsky ===" -ForegroundColor Cyan
goldsky auth set-api-key $env:GOLDSKY_API_KEY

# Create database secret
Write-Host ""
Write-Host "=== Creating Supabase Database Secret ===" -ForegroundColor Cyan
try {
    goldsky secret create --name SUPABASE_POLYMARKET_DB --value $SUPABASE_SECRET_JSON
    Write-Host "Secret created successfully" -ForegroundColor Green
} catch {
    Write-Host "Secret may already exist, continuing..." -ForegroundColor Yellow
}

# Get script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Apply pipelines
Write-Host ""
Write-Host "=== Deploying Mirror Pipelines ===" -ForegroundColor Cyan

Write-Host "Deploying polymarket-user-positions..."
try {
    goldsky pipeline apply "$SCRIPT_DIR\polymarket-user-positions.yaml"
    Write-Host "  Success" -ForegroundColor Green
} catch {
    Write-Host "  Failed: $_" -ForegroundColor Red
}

Write-Host "Deploying polymarket-user-balances..."
try {
    goldsky pipeline apply "$SCRIPT_DIR\polymarket-user-balances.yaml"
    Write-Host "  Success" -ForegroundColor Green
} catch {
    Write-Host "  Failed: $_" -ForegroundColor Red
}

Write-Host "Deploying polymarket-order-filled..."
try {
    goldsky pipeline apply "$SCRIPT_DIR\polymarket-order-filled.yaml"
    Write-Host "  Success" -ForegroundColor Green
} catch {
    Write-Host "  Failed: $_" -ForegroundColor Red
}

# Check pipeline status
Write-Host ""
Write-Host "=== Pipeline Status ===" -ForegroundColor Cyan
goldsky pipeline list

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Run the database migration in Supabase dashboard"
Write-Host "2. Sync token mappings: python scripts/sync_token_mapping.py --full"
Write-Host "3. Start the service with data_source='both' to validate"
Write-Host ""
Write-Host "Monitor pipelines:" -ForegroundColor Yellow
Write-Host "  goldsky pipeline status polymarket-user-positions"
Write-Host "  goldsky pipeline logs polymarket-user-positions"
