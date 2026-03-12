"""
IFNL-Lite Strategy
===================
Informed Flow vs Non-Informative Liquidity (Lite version).

Detects divergence between informed trade flow and price movement using
WebSocket real-time data + offline wallet profiling. Continuous strategy
with 5-20 minute holding periods.

Lite simplifications vs full spec:
- Offline wallet profiling only (no real-time wallet scoring)
- Delayed wallet identification via REST polling (~15s)
- Paper trading execution with trailing stops (no maker-first, no pyramiding)
"""

import json
import sqlite3
from datetime import datetime, timezone

from strategies.base import BaseStrategy


class IfnlLiteStrategy(BaseStrategy):
    slug = "ifnl_lite"
    name = "IFNL-Lite"
    strategy_type = "continuous"

    def init_tables(self, conn: sqlite3.Connection):
        """IFNL tables are created in agent.py init_db() — nothing extra needed here."""
        pass

    def default_config(self) -> dict:
        return {
            # Market selection
            "min_24h_volume": 30000,         # was 50k — more markets eligible
            "min_open_interest": 50000,      # was 100k — less restrictive
            "max_spread_bps": 250,
            "min_ttr_hours": 6,
            "max_ttr_days": 45,
            "min_top_level_liquidity_usd": 1500,
            "max_monitored_markets": 20,     # was 10 — more opportunities
            # Signal thresholds
            "min_signal_to_enter": 0.68,     # was 0.72 — allow more signals
            "min_divergence_bps": 14,        # was 18 — capture smaller divergences
            "min_active_informed_wallets": 2,
            "min_informed_score": 0.65,
            "min_book_imbalance": 0.12,      # was 0.15 — slightly relaxed
            # Position sizing
            "base_position_pct": 0.10,
            "max_position_pct": 0.15,
            "min_position_usdc": 5.0,
            "max_total_deployed_pct": 0.50,
            # Exit rules
            "tp_capture_ratio": 0.80,
            "hard_stop_bps": 22,             # base stop — adaptive SL scales with divergence
            "max_hold_minutes": 20,
            "min_progress_bps_after_5m": 4,  # was 6 — less aggressive early exit
            "early_exit_check_min": 8,       # was implicit 5 — give signals more time
            "max_informed_flow_decay_seconds": 90,
            "market_cooldown_after_stop_min": 10,
            # IFS parameters
            "ifs_k1": 0.5,
            "ifs_k2": 0.3,
        }

    def run(self, conn: sqlite3.Connection, config: dict):
        """
        IFNL-Lite is a continuous strategy — this method is not used for cron.
        The actual run loop is in ifnl_runner.py.
        """
        from rich.console import Console
        Console().print("[yellow]IFNL-Lite is a continuous strategy. Use ifnl_runner.py to start it.[/yellow]")

    def resolve_signals(self, conn: sqlite3.Connection) -> int:
        """Resolve IFNL signals that have exceeded their time limit."""
        cur = conn.cursor()
        cur.execute("""
            SELECT id, detected_at, time_limit_min, entry_price, position_usdc
            FROM ifnl_signals WHERE status='open'
        """)
        pending = cur.fetchall()
        if not pending:
            return 0

        resolved = 0
        now = datetime.now(timezone.utc)

        for row in pending:
            sig_id = row["id"]
            detected_at_str = row["detected_at"]
            time_limit = row["time_limit_min"] or 20

            try:
                detected_dt = datetime.fromisoformat(detected_at_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue

            elapsed_min = (now - detected_dt).total_seconds() / 60
            if elapsed_min > time_limit:
                cur.execute("""
                    UPDATE ifnl_signals SET status='expired', exit_reason='time',
                    resolved_at=? WHERE id=?
                """, (now.isoformat(), sig_id))
                conn.commit()
                resolved += 1

        return resolved

    def get_signals(self, conn: sqlite3.Connection, status: str = None,
                    limit: int = 100, offset: int = 0) -> dict:
        cur = conn.cursor()
        if status in ("open", "resolved", "expired"):
            cur.execute(
                "SELECT * FROM ifnl_signals WHERE status=? ORDER BY detected_at DESC LIMIT ? OFFSET ?",
                (status, limit, offset),
            )
        else:
            cur.execute(
                "SELECT * FROM ifnl_signals ORDER BY detected_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        data = [dict(r) for r in cur.fetchall()]
        cur.execute(
            "SELECT COUNT(*) FROM ifnl_signals" + (" WHERE status=?" if status else ""),
            (status,) if status else (),
        )
        total = cur.fetchone()[0]
        return {"total": total, "limit": limit, "offset": offset, "data": data}

    def get_stats(self, conn: sqlite3.Connection, mode: str | None = None) -> dict:
        cur = conn.cursor()

        def scalar(sql, params=()):
            cur.execute(sql, params)
            v = cur.fetchone()[0]
            return v or 0

        total = scalar("SELECT COUNT(*) FROM ifnl_signals")
        open_c = scalar("SELECT COUNT(*) FROM ifnl_signals WHERE status='open'")
        resolved_c = scalar("SELECT COUNT(*) FROM ifnl_signals WHERE status='resolved'")
        wins = scalar("SELECT COUNT(*) FROM ifnl_signals WHERE status='resolved' AND pnl_usdc > 0")
        losses = scalar("SELECT COUNT(*) FROM ifnl_signals WHERE status='resolved' AND pnl_usdc <= 0")
        total_pnl = scalar("SELECT SUM(pnl_usdc) FROM ifnl_signals WHERE status='resolved'")
        avg_strength = scalar("SELECT AVG(signal_strength) FROM ifnl_signals")
        best = scalar("SELECT MAX(pnl_usdc) FROM ifnl_signals WHERE status='resolved'")
        worst = scalar("SELECT MIN(pnl_usdc) FROM ifnl_signals WHERE status='resolved'")
        avg_hold_min = scalar("""
            SELECT AVG(
                (julianday(resolved_at) - julianday(detected_at)) * 24 * 60
            ) FROM ifnl_signals WHERE status='resolved' AND resolved_at IS NOT NULL
        """)

        # PnL series
        cur.execute("""
            SELECT resolved_at, pnl_usdc FROM ifnl_signals
            WHERE status='resolved' AND resolved_at IS NOT NULL
            ORDER BY resolved_at ASC
        """)
        pnl_series = []
        cumulative = 0.0
        for r in cur.fetchall():
            cumulative += (r["pnl_usdc"] or 0)
            pnl_series.append({"ts": r["resolved_at"], "cumulative_pnl": round(cumulative, 4)})

        # Wallet profile stats
        wallet_count = scalar("SELECT COUNT(*) FROM ifnl_wallet_profiles")
        informed_wallets = scalar("SELECT COUNT(*) FROM ifnl_wallet_profiles WHERE informed_score >= 0.65")

        win_rate = round(wins / resolved_c * 100, 1) if resolved_c > 0 else 0.0

        return {
            "total_signals": total,
            "open": open_c,
            "resolved": resolved_c,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "total_pnl": round(float(total_pnl), 4),
            "avg_signal_strength": round(float(avg_strength), 3) if avg_strength else 0,
            "best_trade": round(float(best), 4),
            "worst_trade": round(float(worst), 4),
            "avg_hold_minutes": round(float(avg_hold_min), 1) if avg_hold_min else 0,
            "pnl_series": pnl_series,
            "tracked_wallets": wallet_count,
            "informed_wallets": informed_wallets,
        }
