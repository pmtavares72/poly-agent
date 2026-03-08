#!/bin/bash
# PolyAgent — Script de parada

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

echo "Stopping PolyAgent..."

# Parar API
if [ -f "$LOG_DIR/api.pid" ]; then
  kill $(cat "$LOG_DIR/api.pid") 2>/dev/null && echo "  ✓ API stopped"
  rm "$LOG_DIR/api.pid"
fi
pkill -f "uvicorn api:app" 2>/dev/null || true

# Parar Frontend
if [ -f "$LOG_DIR/frontend.pid" ]; then
  kill $(cat "$LOG_DIR/frontend.pid") 2>/dev/null && echo "  ✓ Frontend stopped"
  rm "$LOG_DIR/frontend.pid"
fi
pkill -f "next start" 2>/dev/null || true

# Eliminar cron
( crontab -l 2>/dev/null | grep -v "agent.py" ) | crontab -
echo "  ✓ Cron removed"

echo "Done."
