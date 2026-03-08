"""
POLYAGENT — API (FastAPI)
=========================
Expone polyagent.db para consumo desde Next.js.
Incluye control del bot (start/stop) y configuración en tiempo real.

Uso:
    uvicorn api:app --reload --port 8765

Swagger UI: http://localhost:8765/docs
"""

import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = "polyagent.db"
AGENT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent.py")

app = FastAPI(
    title="PolyAgent API",
    description="Paper trading signals & bot control for PolyAgent",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# DB HELPER
# ─────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# ─────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────

class ConfigUpdate(BaseModel):
    initial_capital:    Optional[float] = None
    min_probability:    Optional[float] = None
    max_probability:    Optional[float] = None
    min_profit_net:     Optional[float] = None
    max_hours_to_close: Optional[float] = None
    min_liquidity_usdc: Optional[float] = None
    kelly_fraction:     Optional[float] = None
    max_position_pct:   Optional[float] = None
    fee_rate:           Optional[float] = None
    scan_interval_min:  Optional[int]   = None


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "db": DB_PATH, "ts": datetime.now(timezone.utc).isoformat()}


# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

@app.get("/config")
def get_config():
    """Devuelve la configuración actual del bot."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM config WHERE id=1")
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Config not found — run agent.py once to initialize DB")
    return dict(row)


@app.post("/config")
def update_config(cfg: ConfigUpdate):
    """Actualiza uno o varios parámetros de configuración."""
    updates = {k: v for k, v in cfg.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    conn = get_conn()
    fields = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values())
    conn.execute(f"UPDATE config SET {fields} WHERE id=1", values)
    conn.commit()

    cur = conn.cursor()
    cur.execute("SELECT * FROM config WHERE id=1")
    row = dict(cur.fetchone())
    conn.close()
    return row


# ─────────────────────────────────────────────
# BOT STATUS & CONTROL
# ─────────────────────────────────────────────

@app.get("/bot")
def get_bot_status():
    """Devuelve el estado actual del bot."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM bot_status WHERE id=1")
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Bot status not found — run agent.py once to initialize DB")

    status = dict(row)

    pid = status.get("pid")
    if pid:
        try:
            os.kill(pid, 0)
            # Check process is not a zombie (Z state)
            result = subprocess.run(
                ["ps", "-o", "stat=", "-p", str(pid)],
                capture_output=True, text=True
            )
            state = result.stdout.strip()
            status["pid_alive"] = bool(state) and "Z" not in state
        except (ProcessLookupError, PermissionError, OSError):
            status["pid_alive"] = False
    else:
        status["pid_alive"] = False

    return status


@app.post("/bot/enable")
def enable_bot():
    """Activa el bot — el próximo cron ejecutará el scan."""
    conn = get_conn()
    conn.execute("UPDATE bot_status SET enabled=1 WHERE id=1")
    conn.commit()
    conn.close()
    return {"enabled": True, "message": "Bot enabled — will scan on next cron trigger"}


@app.post("/bot/disable")
def disable_bot():
    """Desactiva el bot — los crons siguientes no ejecutarán el scan."""
    conn = get_conn()
    conn.execute("UPDATE bot_status SET enabled=0, pid=NULL WHERE id=1")
    conn.commit()
    conn.close()
    return {"enabled": False, "message": "Bot disabled"}


@app.post("/bot/scan-now")
def scan_now():
    """Lanza un scan inmediato en background sin esperar al cron."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT enabled FROM bot_status WHERE id=1")
    row = cur.fetchone()
    conn.close()

    if not row or not row["enabled"]:
        raise HTTPException(status_code=400, detail="Bot is disabled — enable it first")

    try:
        proc = subprocess.Popen(
            [sys.executable, AGENT_SCRIPT, "--mode", "paper", "--force"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {
            "triggered": True,
            "pid": proc.pid,
            "message": f"Scan launched (pid={proc.pid}). Results appear in ~2-5 min.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch agent: {e}")


# ─────────────────────────────────────────────
# SIGNALS
# ─────────────────────────────────────────────

@app.get("/signals")
def get_signals(
    status: Optional[str] = Query(None, description="open | resolved | expired"),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    conn = get_conn()
    cur = conn.cursor()
    if status in ("open", "resolved", "expired"):
        cur.execute(
            "SELECT * FROM signals WHERE status=? ORDER BY detected_at DESC LIMIT ? OFFSET ?",
            (status, limit, offset),
        )
    else:
        cur.execute(
            "SELECT * FROM signals ORDER BY detected_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
    data = rows(cur)
    cur.execute(
        "SELECT COUNT(*) FROM signals" + (" WHERE status=?" if status else ""),
        (status,) if status else (),
    )
    total = cur.fetchone()[0]
    conn.close()
    return {"total": total, "limit": limit, "offset": offset, "data": data}


@app.get("/signals/open")
def get_open_signals(limit: int = Query(100, le=500), offset: int = Query(0)):
    return get_signals(status="open", limit=limit, offset=offset)


@app.get("/signals/resolved")
def get_resolved_signals(limit: int = Query(100, le=500), offset: int = Query(0)):
    return get_signals(status="resolved", limit=limit, offset=offset)


@app.get("/signals/{signal_id}")
def get_signal(signal_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM signals WHERE id=?", (signal_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Signal not found")
    return dict(row)


# ─────────────────────────────────────────────
# STATS
# ─────────────────────────────────────────────

@app.get("/stats")
def get_stats():
    conn = get_conn()
    cur = conn.cursor()

    def scalar(sql, params=()):
        cur.execute(sql, params)
        v = cur.fetchone()[0]
        return v or 0

    cur.execute("SELECT initial_capital FROM config WHERE id=1")
    cfg_row = cur.fetchone()
    base_capital = float(cfg_row[0]) if cfg_row else 500.0

    total      = scalar("SELECT COUNT(*) FROM signals")
    open_c     = scalar("SELECT COUNT(*) FROM signals WHERE status='open'")
    resolved_c = scalar("SELECT COUNT(*) FROM signals WHERE status='resolved'")
    wins       = scalar("SELECT COUNT(*) FROM signals WHERE outcome='YES'")
    losses     = scalar("SELECT COUNT(*) FROM signals WHERE outcome='NO'")
    total_pnl  = scalar("SELECT SUM(pnl_usdc) FROM signals WHERE status='resolved'")
    avg_spread = scalar("SELECT AVG(spread_entry_pct) FROM signals")
    best       = scalar("SELECT MAX(pnl_usdc) FROM signals WHERE status='resolved'")
    worst      = scalar("SELECT MIN(pnl_usdc) FROM signals WHERE status='resolved'")
    total_fees = scalar("SELECT SUM(protocol_fee) FROM signals WHERE status='resolved'")

    cur.execute("""
        SELECT resolved_at, pnl_usdc FROM signals
        WHERE status='resolved' AND resolved_at IS NOT NULL
        ORDER BY resolved_at ASC
    """)
    pnl_series = []
    cumulative = 0.0
    for r in cur.fetchall():
        cumulative += (r["pnl_usdc"] or 0)
        pnl_series.append({"ts": r["resolved_at"], "cumulative_pnl": round(cumulative, 4)})

    cur.execute("SELECT * FROM bot_status WHERE id=1")
    bot_row = cur.fetchone()
    bot = dict(bot_row) if bot_row else {}

    conn.close()

    win_rate = round(wins / resolved_c * 100, 1) if resolved_c > 0 else 0.0

    return {
        "base_capital":   base_capital,
        "total_signals":  total,
        "open":           open_c,
        "resolved":       resolved_c,
        "wins":           wins,
        "losses":         losses,
        "win_rate":       win_rate,
        "total_pnl":      round(float(total_pnl), 4),
        "avg_spread_pct": round(float(avg_spread) * 100, 3),
        "best_trade":     round(float(best), 4),
        "worst_trade":    round(float(worst), 4),
        "total_fees":     round(float(total_fees), 4),
        "pnl_series":     pnl_series,
        "bot_enabled":    bool(bot.get("enabled", 0)),
        "bot_last_scan":  bot.get("last_scan_at"),
        "bot_scan_count": bot.get("scan_count", 0),
        "bot_last_error": bot.get("last_error"),
        "generated_at":   datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────
# RUNS (backtest)
# ─────────────────────────────────────────────

@app.get("/runs")
def get_runs(limit: int = Query(20, le=100), offset: int = Query(0)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
    data = rows(cur)
    cur.execute("SELECT COUNT(*) FROM runs")
    total = cur.fetchone()[0]
    conn.close()
    return {"total": total, "data": data}


@app.get("/runs/{run_id}")
def get_run(run_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM runs WHERE id=?", (run_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    return dict(row)


@app.get("/runs/{run_id}/trades")
def get_run_trades(
    run_id: int,
    limit: int = Query(500, le=1000),
    offset: int = Query(0),
):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM runs WHERE id=?", (run_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Run not found")
    cur.execute(
        "SELECT * FROM trades WHERE run_id=? ORDER BY id ASC LIMIT ? OFFSET ?",
        (run_id, limit, offset),
    )
    data = rows(cur)
    cur.execute("SELECT COUNT(*) FROM trades WHERE run_id=?", (run_id,))
    total = cur.fetchone()[0]
    conn.close()
    return {"run_id": run_id, "total": total, "data": data}
