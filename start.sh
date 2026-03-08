#!/bin/bash
# PolyAgent — Script de arranque para OpenClaw
# Uso: bash start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "======================================"
echo "  PolyAgent — Starting up"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "======================================"

# ── 1. Dependencias Python ──────────────────
echo ""
echo "[1/5] Checking Python dependencies..."
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
echo "[2/5] Initializing database..."
$PYTHON_BIN agent.py --mode paper --force 2>/dev/null || true
# Nota: fuerza la creación de tablas aunque el bot esté disabled
# El --force hace que ejecute aunque enabled=0
echo "      ✓ Database initialized (polyagent.db)"

# ── 3. Arrancar API FastAPI ─────────────────
echo ""
echo "[3/5] Starting FastAPI server on port 8765..."
pkill -f "uvicorn api:app" 2>/dev/null || true
sleep 1
nohup $PYTHON_BIN -m uvicorn api:app --host 0.0.0.0 --port 8765 \
  > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
echo "      ✓ API started (pid=$API_PID)"
echo "        Swagger: http://localhost:8765/docs"

# ── 4. Arrancar Next.js frontend ───────────
echo ""
echo "[4/5] Building & starting Next.js frontend..."
cd frontend

# Detectar IP pública del servidor para que el móvil/red externa pueda acceder a la API
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || curl -s ifconfig.me 2>/dev/null || echo "localhost")
echo "      Server IP detected: $SERVER_IP"
echo "NEXT_PUBLIC_API_URL=http://${SERVER_IP}:8765" > .env.local
echo "      ✓ .env.local configured (API URL: http://${SERVER_IP}:8765)"

npm install -q
npm run build -q
pkill -f "next start" 2>/dev/null || true
sleep 1
nohup npm start -- --port 3000 \
  > "$LOG_DIR/frontend.log" 2>&1 &
FRONT_PID=$!
cd "$SCRIPT_DIR"
echo "      ✓ Frontend started (pid=$FRONT_PID)"
echo "        App: http://localhost:3000"

# ── 5. Configurar cron ─────────────────────
echo ""
echo "[5/5] Configuring cron job (every 15 min)..."
CRON_CMD="*/15 * * * * cd $SCRIPT_DIR && $PYTHON_BIN $SCRIPT_DIR/agent.py --mode paper >> $LOG_DIR/agent.log 2>&1"

# Añadir solo si no existe ya
( crontab -l 2>/dev/null | grep -v "agent.py"; echo "$CRON_CMD" ) | crontab -
echo "      ✓ Cron configured"
echo "        Log: $LOG_DIR/agent.log"

# ── Resumen ────────────────────────────────
echo ""
echo "======================================"
echo "  ✓ PolyAgent running!"
echo ""
echo "  App:     http://${SERVER_IP}:3000"
echo "  API:     http://${SERVER_IP}:8765"
echo "  Docs:    http://${SERVER_IP}:8765/docs"
echo ""
echo "  Logs:"
echo "    API:      tail -f $LOG_DIR/api.log"
echo "    Frontend: tail -f $LOG_DIR/frontend.log"
echo "    Agent:    tail -f $LOG_DIR/agent.log"
echo ""
echo "  To stop all:"
echo "    bash stop.sh"
echo "======================================"

# Guardar PIDs
echo "$API_PID" > "$LOG_DIR/api.pid"
echo "$FRONT_PID" > "$LOG_DIR/frontend.pid"
