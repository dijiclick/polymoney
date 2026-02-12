#!/bin/bash
# Start Signal Manager with Polymarket trading bot
# Usage: ./scripts/start.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
  echo "Loaded .env"
fi

# Verify trading credentials
if [ -z "${POLY_PRIVATE_KEY:-}" ]; then
  echo "WARNING: POLY_PRIVATE_KEY not set — trading disabled"
else
  echo "Trading bot: key loaded, funder=${POLY_FUNDER_ADDRESS:-unknown}"
fi

echo "Starting Signal Manager..."
exec node --max-old-space-size=4096 --max-semi-space-size=64 dist/src/index.js
