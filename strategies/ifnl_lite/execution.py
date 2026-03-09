"""
Execution & Position Management (Paper Trading)
=================================================
Simulates order execution and manages positions for IFNL-Lite signals.
No real orders are placed — fills are simulated at mid + estimated slippage.

Exit rules:
- Take profit: mid moved >= TP_CAPTURE_RATIO of expected_move
- Hard stop: mid moved against by > HARD_STOP_BPS
- Time stop: held > MAX_HOLD_MINUTES (or < MIN_PROGRESS_BPS_AFTER_5M at 5 min)
- Invalidation: book_imbalance flips OR informed flow decays
"""

import logging
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from strategies.ifnl_lite.microstructure import MicrostructureEngine
from strategies.ifnl_lite.signal_engine import Signal, SignalEngine

logger = logging.getLogger(__name__)


class ExecutionManager:
    """Paper trading execution for IFNL-Lite signals."""

    def __init__(self, config: dict, db_path: str, micro_engine: MicrostructureEngine,
                 signal_engine: SignalEngine):
        self.config = config
        self.db_path = db_path
        self.micro = micro_engine
        self.signal_engine = signal_engine
        self._invalidation_counts: dict[int, int] = {}  # signal_id -> consecutive flip count

    def execute_signal(self, signal: Signal, capital: float) -> Optional[int]:
        """
        Simulate entry for a signal. Returns signal DB id or None if skipped.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        # Check capital deployment limit
        cur = conn.execute(
            "SELECT COALESCE(SUM(position_usdc), 0) FROM ifnl_signals WHERE status='open'"
        )
        deployed = cur.fetchone()[0]
        max_deployed = capital * self.config.get("max_total_deployed_pct", 0.50)
        available = max_deployed - deployed

        if available < self.config.get("min_position_usdc", 5.0):
            conn.close()
            return None

        # Position sizing
        position = self._size_position(signal, capital, available)
        if position < self.config.get("min_position_usdc", 5.0):
            conn.close()
            return None

        # Simulate fill: mid + half-spread slippage
        spread_bps = self.signal_engine._market_info.get(signal.token_id, {}).get("spread_bps", 100)
        slippage = (spread_bps / 10000) / 2
        entry_mid = self._get_current_mid(signal.token_id)
        entry_price = entry_mid + slippage if signal.direction == "YES" else entry_mid - slippage

        # Compute TP/SL targets
        expected_move_bps = signal.expected_move  # already in bps
        tp_ratio = self.config.get("tp_capture_ratio", 0.80)
        hard_stop_base = self.config.get("hard_stop_bps", 22)
        max_hold = self.config.get("max_hold_minutes", 20)

        # Adaptive SL: at least hard_stop_base, but scale with expected move
        # so bigger divergence signals get proportionally wider stops
        hard_stop = max(hard_stop_base, expected_move_bps * 1.2)

        if signal.direction == "YES":
            tp_target = entry_price + (expected_move_bps * tp_ratio / 10000)
            sl_target = entry_price - (hard_stop / 10000)
        else:
            tp_target = entry_price - (expected_move_bps * tp_ratio / 10000)
            sl_target = entry_price + (hard_stop / 10000)

        now = datetime.now(timezone.utc).isoformat()

        cur = conn.execute("""
            INSERT INTO ifnl_signals (
                detected_at, token_id, question, market_url, direction,
                signal_strength, entry_mid, entry_price, position_usdc,
                informed_flow, divergence, book_imbalance,
                tp_target, sl_target, time_limit_min, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
        """, (
            now, signal.token_id, signal.question, signal.market_url,
            signal.direction, signal.signal_strength,
            round(entry_mid, 6), round(entry_price, 6), round(position, 2),
            signal.informed_flow, signal.divergence, signal.book_imbalance,
            round(tp_target, 6), round(sl_target, 6), max_hold,
        ))
        conn.commit()
        signal_id = cur.lastrowid
        conn.close()

        logger.info(
            f"IFNL signal opened: {signal.direction} {signal.token_id} "
            f"strength={signal.signal_strength:.2f} size=${position:.2f} "
            f"entry={entry_price:.4f} TP={tp_target:.4f} SL={sl_target:.4f}"
        )
        return signal_id

    def check_exits(self) -> list[dict]:
        """
        Check all open positions for exit conditions.
        Returns list of {signal_id, reason, pnl_usdc, pnl_pct}.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        cur = conn.execute("SELECT * FROM ifnl_signals WHERE status='open'")
        open_signals = cur.fetchall()

        exits = []
        now = time.time()

        for sig in open_signals:
            sig_id = sig["id"]
            token_id = sig["token_id"]
            direction = sig["direction"]
            entry_price = sig["entry_price"]
            tp_target = sig["tp_target"]
            sl_target = sig["sl_target"]
            position_usdc = sig["position_usdc"]

            current_mid = self._get_current_mid(token_id)
            if current_mid == 0:
                continue

            # Elapsed time
            try:
                detected_dt = datetime.fromisoformat(sig["detected_at"].replace("Z", "+00:00"))
                elapsed_min = (datetime.now(timezone.utc) - detected_dt).total_seconds() / 60
            except (ValueError, TypeError):
                elapsed_min = 0

            exit_reason = None
            exit_price = current_mid

            # Compute directional progress
            if direction == "YES":
                progress = current_mid - entry_price
            else:
                progress = entry_price - current_mid
            tp_distance = abs(tp_target - entry_price) if tp_target else 0
            progress_ratio = progress / tp_distance if tp_distance > 0 else 0

            # 1. Take profit
            if direction == "YES" and current_mid >= tp_target:
                exit_reason = "tp"
            elif direction == "NO" and current_mid <= tp_target:
                exit_reason = "tp"

            # 2. Trailing stop: after reaching 50% of TP, move stop to breakeven
            #    After reaching 70% of TP, trail stop at 50% of current profit
            effective_sl = sl_target
            if progress_ratio >= 0.7 and exit_reason is None:
                # Trail stop at 50% of current profit
                trail_offset = progress * 0.5
                if direction == "YES":
                    effective_sl = max(sl_target, entry_price + trail_offset)
                else:
                    effective_sl = min(sl_target, entry_price - trail_offset)
            elif progress_ratio >= 0.5 and exit_reason is None:
                # Move stop to breakeven
                effective_sl = entry_price

            # 3. Hard stop (using effective SL which may have been trailed)
            if exit_reason is None:
                if direction == "YES" and current_mid <= effective_sl:
                    exit_reason = "sl" if effective_sl == sl_target else "trail_sl"
                elif direction == "NO" and current_mid >= effective_sl:
                    exit_reason = "sl" if effective_sl == sl_target else "trail_sl"

            # 4. Time stop
            max_hold = sig["time_limit_min"] or self.config.get("max_hold_minutes", 20)
            if elapsed_min >= max_hold:
                exit_reason = "time"

            # 5. Early exit: after 8 min, check progress (relaxed from 5 min / 6 bps)
            min_progress = self.config.get("min_progress_bps_after_5m", 4) / 10000
            early_check_min = self.config.get("early_exit_check_min", 8)
            if elapsed_min >= early_check_min and exit_reason is None:
                if progress < min_progress:
                    exit_reason = "time"

            # 6. Invalidation: book imbalance flip
            if exit_reason is None:
                features = self.micro.get_features(token_id)
                book_imb = features["book_imbalance"]
                flipped = (direction == "YES" and book_imb < -0.10) or \
                          (direction == "NO" and book_imb > 0.10)
                if flipped:
                    count = self._invalidation_counts.get(sig_id, 0) + 1
                    self._invalidation_counts[sig_id] = count
                    if count >= 2:  # two consecutive checks
                        exit_reason = "invalidation"
                else:
                    self._invalidation_counts[sig_id] = 0

            # 7. Invalidation: informed flow decay
            if exit_reason is None:
                max_decay = self.config.get("max_informed_flow_decay_seconds", 90)
                min_score = self.config.get("min_informed_score", 0.65)
                accumulator = self.signal_engine.flow_accumulators.get(token_id)
                if accumulator:
                    last_ts = accumulator.last_informed_trade_ts(direction, min_score)
                    if last_ts > 0 and (now - last_ts) > max_decay:
                        exit_reason = "invalidation"

            if exit_reason:
                # Calculate PnL
                if direction == "YES":
                    pnl_pct = (exit_price - entry_price) / entry_price
                else:
                    pnl_pct = (entry_price - exit_price) / entry_price
                pnl_usdc = position_usdc * pnl_pct

                now_iso = datetime.now(timezone.utc).isoformat()
                conn.execute("""
                    UPDATE ifnl_signals SET
                        status='resolved', exit_price=?, exit_reason=?,
                        resolved_at=?, pnl_usdc=?, pnl_pct=?
                    WHERE id=?
                """, (
                    round(exit_price, 6), exit_reason,
                    now_iso, round(pnl_usdc, 4), round(pnl_pct, 6),
                    sig_id,
                ))
                conn.commit()

                # Set cooldown if stop or invalidation (not trail_sl — that's profit protection)
                if exit_reason in ("sl", "invalidation"):
                    self.signal_engine.set_cooldown(token_id)

                self._invalidation_counts.pop(sig_id, None)

                logger.info(
                    f"IFNL signal closed: {direction} {token_id} "
                    f"reason={exit_reason} pnl=${pnl_usdc:+.2f} ({pnl_pct:+.2%})"
                )

                exits.append({
                    "signal_id": sig_id,
                    "reason": exit_reason,
                    "pnl_usdc": round(pnl_usdc, 4),
                    "pnl_pct": round(pnl_pct, 6),
                })

        conn.close()
        return exits

    def _size_position(self, signal: Signal, capital: float, available: float) -> float:
        """
        Position sizing with tiered scaling by signal strength:
        - Weak signals (0.65-0.72): base_pct * 0.8
        - Standard signals (0.72-0.80): base_pct * 1.0
        - Strong signals (0.80+): scales up to max_pct
        """
        base_pct = self.config.get("base_position_pct", 0.10)
        max_pct = self.config.get("max_position_pct", 0.15)
        min_pos = self.config.get("min_position_usdc", 5.0)

        # Tiered strength multiplier
        strength = signal.signal_strength
        if strength >= 0.80:
            # Strong signal: scale from base_pct up to max_pct
            pct = base_pct + (max_pct - base_pct) * min(1.0, (strength - 0.80) / 0.20)
        elif strength >= 0.72:
            pct = base_pct
        else:
            # Weaker signal (still above min threshold): reduce size
            pct = base_pct * 0.8

        # Liquidity factor from market info
        info = self.signal_engine._market_info.get(signal.token_id, {})
        liquidity = info.get("liquidity", 3000)
        liquidity_factor = max(0.5, min(1.5, liquidity / 3000))

        position = capital * pct * liquidity_factor

        # Hard limits
        position = min(position, capital * max_pct)
        position = min(position, available)
        position = max(position, 0)

        if position < min_pos:
            return 0.0

        return position

    def _get_current_mid(self, token_id: str) -> float:
        """Get current midpoint from microstructure engine."""
        state = self.micro.states.get(token_id)
        if state and state.mids:
            return state.mids[-1].mid
        return 0.0
