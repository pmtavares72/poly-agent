"""
POLYAGENT — API (FastAPI)
=========================
Expone polyagent.db para consumo desde Next.js.
Incluye control del bot (start/stop) y configuración en tiempo real.

Uso:
    uvicorn api:app --reload --port 8765

Swagger UI: http://localhost:8765/docs
"""

import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from strategies import get_strategy, STRATEGY_REGISTRY

load_dotenv()

DB_PATH = os.environ.get("POLYAGENT_DB", "/app/data/polyagent.db")
AGENT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent.py")
TRADING_MODE = os.environ.get("POLYAGENT_MODE", "paper")  # "paper" or "live"

# Track running continuous strategy processes {slug: subprocess.Popen}
_running_processes: dict[str, subprocess.Popen] = {}

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
    kelly_fraction:              Optional[float] = None
    max_position_pct:            Optional[float] = None
    max_capital_deployed_pct:    Optional[float] = None
    fee_rate:                    Optional[float] = None
    scan_interval_min:  Optional[int]   = None


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "db": DB_PATH, "mode": TRADING_MODE, "ts": datetime.now(timezone.utc).isoformat()}


@app.get("/trading-mode")
def get_trading_mode():
    """Returns the current trading mode (paper or live)."""
    return {"mode": TRADING_MODE}


@app.post("/orders/cancel-all")
def api_cancel_all_orders():
    """Emergency: cancel all open CLOB orders. Only works in live mode."""
    if TRADING_MODE != "live":
        raise HTTPException(status_code=400, detail="Not in live mode — no real orders to cancel")
    try:
        from clob_client import cancel_all_orders
        result = cancel_all_orders()
        return {"cancelled": True, "result": str(result)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cancel failed: {e}")


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
            [sys.executable, AGENT_SCRIPT, "--mode", TRADING_MODE, "--force"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {
            "triggered": True,
            "pid": proc.pid,
            "mode": TRADING_MODE,
            "message": f"Scan launched in {TRADING_MODE} mode (pid={proc.pid}). Results appear in ~2-5 min.",
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

    # Get active strategies count
    cur.execute("SELECT COUNT(*) FROM strategies WHERE enabled=1")
    active_strategies = cur.fetchone()[0] or 0

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
        "active_strategies": active_strategies,
        "generated_at":   datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────
# STRATEGIES
# ─────────────────────────────────────────────

@app.get("/strategies")
def list_strategies():
    """List all registered strategies with their status."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM strategies ORDER BY slug")
    data = rows(cur)
    conn.close()
    # Parse config_json, merge with strategy defaults
    for s in data:
        try:
            stored = json.loads(s.get("config_json") or "{}")
        except (json.JSONDecodeError, TypeError):
            stored = {}
        strategy = get_strategy(s["slug"])
        defaults = strategy.default_config() if strategy else {}
        s["config"] = {**defaults, **stored}
    return {"strategies": data}


@app.get("/strategies/{slug}")
def get_strategy_detail(slug: str):
    """Get strategy detail including config and stats."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM strategies WHERE slug=?", (slug,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    result = dict(row)
    try:
        stored = json.loads(result.get("config_json") or "{}")
    except (json.JSONDecodeError, TypeError):
        stored = {}
    strategy = get_strategy(slug)
    defaults = strategy.default_config() if strategy else {}
    result["config"] = {**defaults, **stored}

    # Get strategy stats
    if strategy:
        result["stats"] = strategy.get_stats(conn)
    else:
        result["stats"] = {}

    # For continuous strategies, report if runner process is alive
    proc = _running_processes.get(slug)
    result["runner_alive"] = proc is not None and proc.poll() is None

    conn.close()
    return result


@app.post("/strategies/{slug}/config")
def update_strategy_config(slug: str, config: dict):
    """Update strategy-specific config."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT config_json FROM strategies WHERE slug=?", (slug,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")

    # Merge with existing config
    existing = json.loads(row["config_json"] or "{}")
    existing.update(config)
    now_iso = datetime.now(timezone.utc).isoformat()

    conn.execute(
        "UPDATE strategies SET config_json=?, updated_at=? WHERE slug=?",
        (json.dumps(existing), now_iso, slug)
    )
    conn.commit()
    conn.close()
    return {"slug": slug, "config": existing, "updated_at": now_iso}


@app.post("/strategies/{slug}/enable")
def enable_strategy(slug: str):
    """Enable a strategy. For continuous strategies, also starts the runner process."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT slug, type FROM strategies WHERE slug=?", (slug,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute("UPDATE strategies SET enabled=1, updated_at=? WHERE slug=?", (now_iso, slug))
    conn.commit()
    conn.close()

    pid = None
    # Start continuous strategy runner process
    if row["type"] == "continuous" and slug == "ifnl_lite":
        # Kill existing process if any
        _stop_continuous_process(slug)
        try:
            log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "ifnl_lite.log")
            log_file = open(log_path, "a")
            proc = subprocess.Popen(
                [sys.executable, "-m", "strategies.ifnl_lite.ifnl_runner", "--db", DB_PATH],
                stdout=log_file,
                stderr=log_file,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            )
            _running_processes[slug] = proc
            pid = proc.pid
            # Write PID file for stop.sh / start.sh
            pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", f"{slug}.pid")
            with open(pid_path, "w") as pf:
                pf.write(str(pid))
        except Exception as e:
            return {"slug": slug, "enabled": True, "error": f"Enabled but failed to start runner: {e}"}

    return {"slug": slug, "enabled": True, "pid": pid}


@app.post("/strategies/{slug}/disable")
def disable_strategy(slug: str):
    """Disable a strategy. For continuous strategies, also stops the runner process."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT slug, type FROM strategies WHERE slug=?", (slug,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute("UPDATE strategies SET enabled=0, updated_at=? WHERE slug=?", (now_iso, slug))
    conn.commit()
    conn.close()

    # Stop continuous strategy runner process
    if row["type"] == "continuous":
        _stop_continuous_process(slug)

    return {"slug": slug, "enabled": False}


def _stop_continuous_process(slug: str):
    """Stop a running continuous strategy process."""
    proc = _running_processes.pop(slug, None)
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    # Clean up PID file
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", f"{slug}.pid")
    if os.path.exists(pid_path):
        os.remove(pid_path)


@app.post("/strategies/{slug}/scan-now")
def strategy_scan_now(slug: str):
    """Trigger an immediate scan for a cron-type strategy."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT type, enabled FROM strategies WHERE slug=?", (slug,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    if row["type"] != "cron":
        raise HTTPException(status_code=400, detail=f"Strategy '{slug}' is continuous, not cron-based")
    if not row["enabled"]:
        raise HTTPException(status_code=400, detail=f"Strategy '{slug}' is disabled — enable it first")

    try:
        proc = subprocess.Popen(
            [sys.executable, AGENT_SCRIPT, "--mode", TRADING_MODE, "--strategy", slug, "--force"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"triggered": True, "pid": proc.pid, "strategy": slug, "mode": TRADING_MODE,
                "message": f"Scan launched in {TRADING_MODE} mode (pid={proc.pid})"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch scan: {e}")


@app.get("/strategies/{slug}/signals")
def get_strategy_signals(
    slug: str,
    status: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    """Get signals for a specific strategy."""
    strategy = get_strategy(slug)
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    conn = get_conn()
    result = strategy.get_signals(conn, status=status, limit=limit, offset=offset)
    conn.close()
    return result


@app.get("/strategies/{slug}/signals/open")
def get_strategy_open_signals(slug: str, limit: int = Query(100, le=500), offset: int = Query(0)):
    return get_strategy_signals(slug, status="open", limit=limit, offset=offset)


@app.get("/strategies/{slug}/stats")
def get_strategy_stats(slug: str):
    """Get stats for a specific strategy."""
    strategy = get_strategy(slug)
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy '{slug}' not found")
    conn = get_conn()
    stats = strategy.get_stats(conn)
    conn.close()
    return stats


@app.get("/strategies/{slug}/activity")
def get_strategy_activity(slug: str):
    """Get live activity/status of a running strategy (reads status file from runner)."""
    status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", f"{slug}_status.json")
    if not os.path.exists(status_file):
        return {"running": False, "message": "No status file — strategy may not have been started yet"}
    try:
        with open(status_file, "r") as f:
            data = json.load(f)
        # Check if status is stale (>60s old)
        last_update = data.get("last_status_update", 0)
        if last_update and (time.time() - last_update) > 60:
            data["possibly_stale"] = True
            data["stale_seconds"] = int(time.time() - last_update)
        return data
    except (json.JSONDecodeError, IOError):
        return {"running": False, "message": "Status file unreadable"}


# ─────────────────────────────────────────────
# SCAN LOGS
# ─────────────────────────────────────────────

@app.get("/scan-logs")
def get_scan_logs(limit: int = Query(50, le=200), offset: int = Query(0)):
    """Historial de ejecuciones del scanner paper trading."""
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scan_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TEXT NOT NULL,
            finished_at     TEXT,
            duration_sec    REAL,
            markets_fetched INTEGER DEFAULT 0,
            markets_checked INTEGER DEFAULT 0,
            signals_found   INTEGER DEFAULT 0,
            signals_resolved INTEGER DEFAULT 0,
            skipped_wash    INTEGER DEFAULT 0,
            skipped_spread  INTEGER DEFAULT 0,
            skipped_no_data INTEGER DEFAULT 0,
            skipped_price   INTEGER DEFAULT 0,
            error           TEXT,
            mode            TEXT DEFAULT 'paper'
        )
    """)
    conn.commit()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM scan_log ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset)
    )
    data = rows(cur)
    cur.execute("SELECT COUNT(*) FROM scan_log")
    total = cur.fetchone()[0]
    conn.close()
    return {"total": total, "limit": limit, "offset": offset, "data": data}


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


# ─────────────────────────────────────────────
# SETTINGS / CREDENTIALS
# ─────────────────────────────────────────────

# Polymarket CREATE2 constants for proxy wallet derivation
PROXY_FACTORY = "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052"
PROXY_INIT_CODE_HASH = bytes.fromhex(
    "d21df8dc65880a8606f09fe0ce3df9b8869287ab0b058be05aa9e8af6330a00b"
)


def _keccak256(data: bytes) -> bytes:
    """Keccak-256 hash using pysha3 or hashlib (Python 3.11+)."""
    try:
        import sha3
        k = sha3.keccak_256()
        k.update(data)
        return k.digest()
    except ImportError:
        import hashlib
        return hashlib.sha3_256(data).digest()  # fallback, NOT keccak — see below


def derive_funder_address(private_key: str) -> str:
    """
    Derive Polymarket proxy wallet (funder address) from private key using CREATE2.
    Formula: address = last20bytes(keccak256(0xff ++ factory ++ salt ++ initCodeHash))
    where salt = keccak256(abi.encodePacked(eoaAddress))
    """
    try:
        from eth_account import Account
        from eth_utils import keccak as eth_keccak
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="eth-account not installed. Run: pip install eth-account"
        )

    # Ensure 0x prefix
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    # Derive EOA address from private key
    account = Account.from_key(private_key)
    eoa_address = account.address.lower()

    # salt = keccak256(abi.encodePacked(eoaAddress))
    eoa_bytes = bytes.fromhex(eoa_address[2:])  # remove 0x
    salt = eth_keccak(eoa_bytes)

    # CREATE2: keccak256(0xff ++ factory ++ salt ++ initCodeHash)
    factory_bytes = bytes.fromhex(PROXY_FACTORY[2:].lower())
    create2_input = b'\xff' + factory_bytes + salt + PROXY_INIT_CODE_HASH
    address_hash = eth_keccak(create2_input)

    # Take last 20 bytes as the address
    proxy_address = "0x" + address_hash[-20:].hex()
    return proxy_address


def derive_api_creds(private_key: str, funder_address: str, signature_type: int) -> dict:
    """Derive API credentials from private key using py-clob-client."""
    try:
        from py_clob_client.client import ClobClient
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="py-clob-client not installed. Run: pip install py-clob-client"
        )

    host = os.environ.get("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")
    chain_id = int(os.environ.get("POLYMARKET_CHAIN_ID", "137"))

    client = ClobClient(
        host,
        key=private_key if private_key.startswith("0x") else "0x" + private_key,
        chain_id=chain_id,
        signature_type=signature_type,
        funder=funder_address,
    )
    creds = client.create_or_derive_api_creds()
    return {
        "api_key": creds.api_key,
        "api_secret": creds.api_secret,
        "api_passphrase": creds.api_passphrase,
    }


class CredentialsUpdate(BaseModel):
    private_key: Optional[str] = None
    funder_address: Optional[str] = None
    signature_type: Optional[int] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    api_passphrase: Optional[str] = None


@app.get("/settings/credentials")
def get_credentials():
    """Get stored credentials (private key is masked)."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM credentials WHERE id=1")
    row = cur.fetchone()
    conn.close()
    if not row:
        return {"configured": False}

    creds = dict(row)
    pk = creds.get("private_key") or ""
    has_pk = bool(pk and len(pk) >= 10)

    return {
        "configured": has_pk,
        "private_key_masked": f"{pk[:6]}...{pk[-4:]}" if has_pk else "",
        "funder_address": creds.get("funder_address") or "",
        "signature_type": creds.get("signature_type", 1),
        "has_api_creds": bool(creds.get("api_key")),
        "updated_at": creds.get("updated_at"),
    }


@app.post("/settings/credentials")
def save_credentials(creds: CredentialsUpdate):
    """
    Save credentials. If private_key is provided, auto-derives:
    1. Funder address (CREATE2 proxy wallet)
    2. API credentials (via CLOB API)
    """
    conn = get_conn()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Load existing credentials
    cur = conn.cursor()
    cur.execute("SELECT * FROM credentials WHERE id=1")
    row = cur.fetchone()
    existing = dict(row) if row else {}

    pk = creds.private_key or existing.get("private_key") or ""
    sig_type = creds.signature_type if creds.signature_type is not None else existing.get("signature_type", 1)
    funder = creds.funder_address or existing.get("funder_address") or ""
    api_key = creds.api_key or existing.get("api_key") or ""
    api_secret = creds.api_secret or existing.get("api_secret") or ""
    api_passphrase = creds.api_passphrase or existing.get("api_passphrase") or ""

    errors = []

    # Auto-derive funder address from private key
    if creds.private_key and not creds.funder_address:
        try:
            funder = derive_funder_address(pk)
        except Exception as e:
            errors.append(f"Could not derive funder address: {e}")

    # Auto-derive API credentials
    if creds.private_key and funder:
        try:
            api = derive_api_creds(pk, funder, sig_type)
            api_key = api["api_key"]
            api_secret = api["api_secret"]
            api_passphrase = api["api_passphrase"]
        except Exception as e:
            errors.append(f"Could not derive API credentials: {e}")

    # Save to DB
    conn.execute("""
        INSERT OR REPLACE INTO credentials
        (id, private_key, funder_address, signature_type, api_key, api_secret, api_passphrase, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    """, (pk, funder, sig_type, api_key, api_secret, api_passphrase, now_iso))
    conn.commit()

    # Also update environment variables for current process
    if pk:
        os.environ["POLYMARKET_PRIVATE_KEY"] = pk
    if funder:
        os.environ["POLYMARKET_FUNDER_ADDRESS"] = funder
    if api_key:
        os.environ["POLYMARKET_API_KEY"] = api_key
        os.environ["POLYMARKET_API_SECRET"] = api_secret
        os.environ["POLYMARKET_API_PASSPHRASE"] = api_passphrase
    os.environ["POLYMARKET_SIGNATURE_TYPE"] = str(sig_type)

    # Reset CLOB client singleton so it picks up new creds
    try:
        import clob_client
        clob_client._client = None
    except (ImportError, AttributeError):
        pass

    conn.close()

    has_pk = bool(pk and len(pk) >= 10)
    return {
        "saved": True,
        "configured": has_pk,
        "private_key_masked": f"{pk[:6]}...{pk[-4:]}" if has_pk else "",
        "funder_address": funder,
        "signature_type": sig_type,
        "has_api_creds": bool(api_key),
        "errors": errors if errors else None,
        "updated_at": now_iso,
    }


@app.post("/settings/credentials/test")
def test_credentials():
    """Test CLOB API connection with stored credentials."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM credentials WHERE id=1")
    row = cur.fetchone()
    conn.close()

    if not row or not row["private_key"]:
        raise HTTPException(status_code=400, detail="No credentials configured")

    pk = row["private_key"]
    funder = row["funder_address"] or ""
    sig_type = row["signature_type"] or 1

    if not funder:
        raise HTTPException(status_code=400, detail="No funder address — save credentials first")

    try:
        from py_clob_client.client import ClobClient
        from py_clob_client.clob_types import ApiCreds

        host = os.environ.get("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")
        chain_id = int(os.environ.get("POLYMARKET_CHAIN_ID", "137"))

        client = ClobClient(
            host,
            key=pk if pk.startswith("0x") else "0x" + pk,
            chain_id=chain_id,
            signature_type=sig_type,
            funder=funder,
        )

        # Use stored API creds if available
        api_key = row["api_key"] or ""
        if api_key:
            client.set_api_creds(ApiCreds(
                api_key=api_key,
                api_secret=row["api_secret"] or "",
                api_passphrase=row["api_passphrase"] or "",
            ))
        else:
            creds = client.create_or_derive_api_creds()
            client.set_api_creds(creds)

        # Test authenticated request
        orders = client.get_orders()
        return {
            "success": True,
            "message": "CLOB API connection successful",
            "open_orders": len(orders) if isinstance(orders, list) else 0,
        }
    except Exception as e:
        return {"success": False, "message": str(e)}
