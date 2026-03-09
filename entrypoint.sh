#!/bin/bash
set -e

echo "🚀 PolyAgent API starting..."

# 1. Apply migrations
echo "📊 Applying database migrations..."
python3 -c "
import sqlite3
import os

db_path = os.getenv('POLYAGENT_DB', '/app/data/polyagent.db')
conn = sqlite3.connect(db_path)

# Read and execute migrations
with open('/app/migrations.sql', 'r') as f:
    conn.executescript(f.read())

conn.commit()
conn.close()
print('✅ Migrations applied')
"

# 2. Check if IFNL-Lite should auto-start
echo "🔍 Checking IFNL-Lite status..."
IFNL_ENABLED=$(python3 -c "
import sqlite3
import os

db_path = os.getenv('POLYAGENT_DB', '/app/data/polyagent.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute('SELECT enabled FROM strategies WHERE slug = \"ifnl_lite\"')
row = c.fetchone()
print(row[0] if row else 0)
conn.close()
" 2>/dev/null || echo "0")

# 3. Start IFNL-Lite runner in background if enabled
if [ "$IFNL_ENABLED" = "1" ]; then
    echo "▶️  Starting IFNL-Lite runner..."
    nohup python3 -m strategies.ifnl_lite.ifnl_runner --db /app/data/polyagent.db > /app/logs/ifnl_lite.log 2>&1 &
    echo $! > /app/logs/ifnl_lite.pid
    echo "✅ IFNL-Lite started (PID: $(cat /app/logs/ifnl_lite.pid))"
else
    echo "⏸️  IFNL-Lite disabled (enabled=$IFNL_ENABLED)"
fi

# 4. Start API server
echo "🌐 Starting API server on port 8765..."
exec uvicorn api:app --host 0.0.0.0 --port 8765
