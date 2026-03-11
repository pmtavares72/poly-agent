#!/bin/bash
# PolyAgent — Reset Database
# ===========================
# Clears trading data (signals, logs, trades) but PRESERVES:
#   - config (Bond Hunter settings)
#   - strategies (strategy configs, enabled/disabled state)
#   - credentials (private key, funder address, API creds)
#
# Usage:
#   bash reset_db.sh              # clear trading data, keep config
#   bash reset_db.sh --full       # delete everything and recreate from scratch
#
# Run this BEFORE start.sh when switching from paper to live,
# or when deploying a fresh instance on OpenClaw.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

DATA_DIR="${POLYAGENT_DATA_DIR:-$SCRIPT_DIR/data}"
DB_PATH="${POLYAGENT_DB:-$DATA_DIR/polyagent.db}"
PYTHON_BIN=$(which python3 2>/dev/null || which python)

echo "PolyAgent — Database Reset"
echo "=========================="
echo "  DB: $DB_PATH"
echo ""

if [ ! -f "$DB_PATH" ]; then
  echo "  No database found — nothing to reset."
  echo "  Run start.sh to create a fresh database."
  exit 0
fi

# --full: delete everything and recreate (old behavior)
if [ "$1" = "--full" ]; then
  echo "  FULL RESET — deleting entire database..."
  rm -f "$DB_PATH"
  echo "  Database deleted."

  echo "  Recreating database..."
  mkdir -p "$DATA_DIR"
  export POLYAGENT_DB="$DB_PATH"
  $PYTHON_BIN -c "
import sys, os
sys.path.insert(0, '$SCRIPT_DIR')
os.environ['POLYAGENT_DB'] = '$DB_PATH'
from agent import init_db
conn = init_db('$DB_PATH')
conn.close()
print('  Tables created.')
"

  if [ -f "$SCRIPT_DIR/migrations.sql" ]; then
    sqlite3 "$DB_PATH" < "$SCRIPT_DIR/migrations.sql" 2>/dev/null || true
    echo "  Migrations applied."
  fi

  echo ""
  echo "  Done. Database fully recreated (all config lost)."
  echo "  Run 'bash start.sh' to start PolyAgent."
  exit 0
fi

# Default: clear trading data only, preserve config/credentials/strategies
echo "  Clearing trading data (preserving config, strategies, credentials)..."

sqlite3 "$DB_PATH" <<'SQL'
-- Clear Bond Hunter signals
DELETE FROM signals;

-- Clear IFNL signals
DELETE FROM ifnl_signals;

-- Clear IFNL wallet data
DELETE FROM ifnl_wallet_profiles;
DELETE FROM ifnl_wallet_trades;

-- Clear scan logs
DELETE FROM scan_log;

-- Clear bot status runs
DELETE FROM runs;
DELETE FROM trades;

-- Reset bot status counters but keep the row
UPDATE bot_status SET
  total_scans = 0,
  total_signals = 0,
  updated_at = datetime('now')
WHERE id = 1;

-- Reset PnL in strategies table but keep config
UPDATE strategies SET
  updated_at = datetime('now');
SQL

echo "  Trading data cleared."
echo ""
echo "  Preserved:"
echo "    - config (Bond Hunter settings)"
echo "    - strategies (configs + enabled state)"
echo "    - credentials (private key, funder, API creds)"
echo ""
echo "  Done. Database is clean and ready for live trading."
echo "  Run 'bash start.sh' to start PolyAgent."
