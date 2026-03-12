#!/bin/bash
# PolyAgent — Script de arranque para OpenClaw
# Uso: bash start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# Load .env if present (contains POLYMARKET credentials + POLYAGENT_MODE)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# Directorio de datos persistente (volumen Docker en OpenClaw, local fallback)
DATA_DIR="${POLYAGENT_DATA_DIR:-$SCRIPT_DIR/data}"
mkdir -p "$DATA_DIR"
export POLYAGENT_DB="$DATA_DIR/polyagent.db"

# Trading mode (paper or live) — read from .env or default to paper
TRADING_MODE="${POLYAGENT_MODE:-paper}"

echo "======================================"
echo "  PolyAgent — Starting up"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  Mode: $(echo "$TRADING_MODE" | tr '[:lower:]' '[:upper:]')"
echo "======================================"

# ── 1. Dependencias Python ──────────────────
echo ""
echo "[1/6] Checking Python dependencies..."
PYTHON_BIN=$(which python3 2>/dev/null || which python)
if [ -z "$PYTHON_BIN" ]; then
  echo "ERROR: python3 not found. Install it with: apt install python3 python3-pip"
  exit 1
fi
echo "      Using: $PYTHON_BIN ($(${PYTHON_BIN} --version))"
$PYTHON_BIN -m pip install -r requirements.txt -q --break-system-packages 2>/dev/null || \
$PYTHON_BIN -m pip install -r requirements.txt -q
echo "      ✓ Python deps OK"

# ── 2. Inicializar BD y config ─────────────
echo ""
echo "[2/6] Initializing database..."
$PYTHON_BIN agent.py --mode paper --force 2>/dev/null || true
# Nota: fuerza la creación de tablas aunque el bot esté disabled
# El --force hace que ejecute aunque enabled=0
echo "      ✓ Base tables initialized"

# Apply migrations (strategies, IFNL tables, seed data)
if [ -f "$SCRIPT_DIR/migrations.sql" ]; then
  sqlite3 "$POLYAGENT_DB" < "$SCRIPT_DIR/migrations.sql" 2>/dev/null || true
  echo "      ✓ Migrations applied (migrations.sql)"
fi
echo "      ✓ Database ready ($POLYAGENT_DB)"

# ── 3. Arrancar API FastAPI ─────────────────
echo ""
echo "[3/6] Starting FastAPI server on port 8765..."
pkill -f "uvicorn api:app" 2>/dev/null || true
sleep 1
nohup $PYTHON_BIN -m uvicorn api:app --host 0.0.0.0 --port 8765 \
  > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
echo "      ✓ API started (pid=$API_PID)"
echo "        Swagger: http://localhost:8765/docs"

# ── 4. Arrancar Next.js frontend ───────────
echo ""
echo "[4/6] Building & starting Next.js frontend..."
cd frontend

# Detectar IP para mostrar en el resumen (el proxy de Next.js hace que no sea necesaria para la API)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "localhost")

npm install -q
npm run build -q
pkill -f "next start" 2>/dev/null || true
sleep 1
nohup npm start -- --port 3000 \
  > "$LOG_DIR/frontend.log" 2>&1 &
FRONT_PID=$!
cd "$SCRIPT_DIR"
echo "      ✓ Frontend started (pid=$FRONT_PID)"
echo "        App: http://${SERVER_IP}:3000"

# ── 5. Configurar cron ─────────────────────
echo ""
echo "[5/6] Configuring cron job (every 15 min, mode from DB)..."
# Source .env in cron so CLOB credentials are available in live mode
# NOTE: No --mode flag — agent.py reads trading mode from bot_status.trading_mode in DB
# This allows switching paper/live from the dashboard without reconfiguring cron
CRON_CMD="*/15 * * * * cd $SCRIPT_DIR && set -a && [ -f $SCRIPT_DIR/.env ] && . $SCRIPT_DIR/.env; set +a && $PYTHON_BIN $SCRIPT_DIR/agent.py >> $LOG_DIR/agent.log 2>&1"

# Añadir solo si no existe ya
( crontab -l 2>/dev/null | grep -v "agent.py"; echo "$CRON_CMD" ) | crontab -
echo "      ✓ Cron configured"
echo "        Log: $LOG_DIR/agent.log"

# ── 6. Auto-start enabled continuous strategies ──
echo ""
echo "[6/6] Checking for enabled continuous strategies..."
# Query DB for IFNL-Lite enabled status
IFNL_ENABLED=$($PYTHON_BIN -c "
import sqlite3, os
db = os.environ.get('POLYAGENT_DB', '$POLYAGENT_DB')
try:
    conn = sqlite3.connect(db)
    cur = conn.execute(\"SELECT enabled FROM strategies WHERE slug='ifnl_lite'\")
    row = cur.fetchone()
    conn.close()
    print(row[0] if row else 0)
except:
    print(0)
" 2>/dev/null || echo "0")

if [ "$IFNL_ENABLED" = "1" ]; then
  echo "      IFNL-Lite is enabled — starting runner..."
  # Kill any existing runner
  if [ -f "$LOG_DIR/ifnl_lite.pid" ]; then
    kill $(cat "$LOG_DIR/ifnl_lite.pid") 2>/dev/null || true
    rm -f "$LOG_DIR/ifnl_lite.pid"
  fi
  pkill -f "ifnl_runner" 2>/dev/null || true
  sleep 1
  nohup $PYTHON_BIN -m strategies.ifnl_lite.ifnl_runner --db "$POLYAGENT_DB" \
    >> "$LOG_DIR/ifnl_lite.log" 2>&1 &
  IFNL_PID=$!
  echo "$IFNL_PID" > "$LOG_DIR/ifnl_lite.pid"
  echo "      ✓ IFNL-Lite runner started (pid=$IFNL_PID)"
  echo "        Log: $LOG_DIR/ifnl_lite.log"
else
  echo "      IFNL-Lite is disabled — skipping"
  echo "      (Enable it from the dashboard to start)"
fi

# ── Resumen ────────────────────────────────
echo ""
echo "======================================"
echo "  ✓ PolyAgent running!"
echo "  Mode: $(echo "$TRADING_MODE" | tr '[:lower:]' '[:upper:]')"
if [ "$TRADING_MODE" = "live" ]; then
echo "  ⚠  LIVE TRADING — Real money at risk!"
echo "  Capital: \$${POLYAGENT_LIVE_CAPITAL:-500.00}"
fi
echo ""
echo "  App:     http://${SERVER_IP}:3000"
echo "  API:     http://${SERVER_IP}:8765"
echo "  Docs:    http://${SERVER_IP}:8765/docs"
echo ""
echo "  Logs:"
echo "    API:      tail -f $LOG_DIR/api.log"
echo "    Frontend: tail -f $LOG_DIR/frontend.log"
echo "    Agent:    tail -f $LOG_DIR/agent.log"
echo "    IFNL:     tail -f $LOG_DIR/ifnl_lite.log"
echo ""
echo "  To stop all:"
echo "    bash stop.sh"
echo "======================================"

# Guardar PIDs
echo "$API_PID" > "$LOG_DIR/api.pid"
echo "$FRONT_PID" > "$LOG_DIR/frontend.pid"
