"""
Signal Engine
==============
Generates IFNL-Lite signals by combining:
1. Informed Flow Score (IFS) from wallet-attributed trades (delayed ~15s from REST)
2. Microstructure features (real-time from WebSocket)
3. Divergence detection (expected move vs actual move)

Signal is generated when informed wallets are buying but price hasn't moved yet.
"""

import logging
import sqlite3
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from strategies.ifnl_lite.microstructure import MicrostructureEngine

logger = logging.getLogger(__name__)


@dataclass
class InformedFlowAccumulator:
    """Accumulates informed flow per direction over rolling windows."""
    # (timestamp, size_usd, informed_score, reliability, direction)
    flows: list = field(default_factory=list)

    def add(self, size_usd: float, informed_score: float, reliability: float,
            direction: str, ts: float = None):
        self.flows.append({
            "ts": ts or time.time(),
            "size_usd": size_usd,
            "informed_score": informed_score,
            "reliability": reliability,
            "direction": direction,
        })

    def ifs(self, direction: str, window_sec: float) -> float:
        """Compute Informed Flow Score for a direction over window."""
        cutoff = time.time() - window_sec
        return sum(
            f["size_usd"] * f["informed_score"] * f["reliability"]
            for f in self.flows
            if f["ts"] >= cutoff and f["direction"] == direction
        )

    def active_informed_wallets(self, direction: str, window_sec: float,
                                 min_score: float) -> int:
        """Count unique informed wallets active in window (approximate by flow entries)."""
        cutoff = time.time() - window_sec
        return sum(
            1 for f in self.flows
            if f["ts"] >= cutoff and f["direction"] == direction
            and f["informed_score"] >= min_score
        )

    def last_informed_trade_ts(self, direction: str, min_score: float) -> float:
        """Timestamp of the most recent informed trade in a direction."""
        for f in reversed(self.flows):
            if f["direction"] == direction and f["informed_score"] >= min_score:
                return f["ts"]
        return 0.0

    def prune(self, max_age_sec: float = 600):
        """Remove old entries."""
        cutoff = time.time() - max_age_sec
        self.flows = [f for f in self.flows if f["ts"] >= cutoff]


@dataclass
class Signal:
    """A generated IFNL signal before DB insertion."""
    token_id: str
    direction: str  # 'YES' or 'NO'
    signal_strength: float
    entry_mid: float
    informed_flow: float
    divergence: float
    book_imbalance: float
    expected_move: float
    question: str = ""
    market_url: str = ""


class SignalEngine:
    """
    Generates IFNL signals by detecting divergence between informed flow
    and price movement.
    """

    def __init__(self, config: dict, micro_engine: MicrostructureEngine, db_path: str):
        self.config = config
        self.micro = micro_engine
        self.db_path = db_path
        self.flow_accumulators: dict[str, InformedFlowAccumulator] = defaultdict(InformedFlowAccumulator)
        self._market_info: dict[str, dict] = {}  # token_id -> {question, market_url, ...}
        self._cooldowns: dict[str, float] = {}  # token_id -> cooldown_until_ts
        self._avg_volume_30m: dict[str, float] = {}  # for normalization

    def set_market_info(self, markets: list[dict]):
        """Store market metadata for signal enrichment."""
        for m in markets:
            self._market_info[m["token_id"]] = m

    def process_wallet_trades(self, market_id: str, trades: list) -> None:
        """
        Process wallet-attributed trades from DataApiClient.
        Looks up each wallet in the profile DB and accumulates informed flow.
        """
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row

        accumulator = self.flow_accumulators[market_id]

        for trade in trades:
            # Look up wallet profile
            cur = conn.execute(
                "SELECT informed_score, noise_score, reliability FROM ifnl_wallet_profiles WHERE proxy_wallet=?",
                (trade.proxy_wallet,)
            )
            profile = cur.fetchone()

            if not profile:
                continue

            informed_score = profile["informed_score"]
            reliability = profile["reliability"]

            # Determine direction from trade
            side = trade.side.lower()
            outcome = trade.outcome.lower() if trade.outcome else ""
            if "buy" in side and "yes" in outcome:
                direction = "YES"
            elif "buy" in side and "no" in outcome:
                direction = "NO"
            elif "sell" in side and "yes" in outcome:
                direction = "NO"  # selling YES = bearish
            elif "sell" in side and "no" in outcome:
                direction = "YES"  # selling NO = bullish
            else:
                continue

            accumulator.add(
                size_usd=trade.size_usd,
                informed_score=informed_score,
                reliability=reliability,
                direction=direction,
            )

            # Enrich microstructure with trade size
            self.micro.enrich_trade_size(market_id, trade.price, trade.size_usd)

        conn.close()

        # Prune old flow data
        accumulator.prune()

    def check_signals(self) -> list[Signal]:
        """
        Check all monitored markets for signal conditions.
        Returns list of generated signals.
        """
        signals = []
        now = time.time()

        min_divergence = self.config.get("min_divergence_bps", 18) / 10000
        min_strength = self.config.get("min_signal_to_enter", 0.72)
        min_imbalance = self.config.get("min_book_imbalance", 0.15)
        min_informed_wallets = self.config.get("min_active_informed_wallets", 2)
        min_informed_score = self.config.get("min_informed_score", 0.65)
        k1 = self.config.get("ifs_k1", 0.5)
        k2 = self.config.get("ifs_k2", 0.3)
        cooldown_min = self.config.get("market_cooldown_after_stop_min", 10)

        for token_id, accumulator in self.flow_accumulators.items():
            # Check cooldown
            if token_id in self._cooldowns and now < self._cooldowns[token_id]:
                continue

            features = self.micro.get_features(token_id)

            for direction in ["YES", "NO"]:
                # 1. Compute IFS over windows
                ifs_30s = accumulator.ifs(direction, 30)
                ifs_2m = accumulator.ifs(direction, 120)

                if ifs_30s == 0 and ifs_2m == 0:
                    continue

                # Normalize IFS
                avg_vol = self._avg_volume_30m.get(token_id, 1000)
                norm_ifs_30s = ifs_30s / avg_vol if avg_vol > 0 else 0
                norm_ifs_2m = ifs_2m / avg_vol if avg_vol > 0 else 0

                # 2. Expected vs actual move
                expected_move = k1 * norm_ifs_30s + k2 * norm_ifs_2m
                actual_move = features["mid_drift_2m"]

                # Direction sign: YES = positive move expected, NO = negative
                if direction == "NO":
                    actual_move = -actual_move

                divergence = expected_move - actual_move

                # 3. Check signal conditions
                if divergence < min_divergence:
                    continue

                # Book imbalance confirms direction
                book_imb = features["book_imbalance"]
                if direction == "YES" and book_imb < min_imbalance:
                    continue
                if direction == "NO" and book_imb > -min_imbalance:
                    continue

                # Absorption should be high
                if features["absorption_score"] < 0.3:
                    continue

                # Minimum informed wallets
                active = accumulator.active_informed_wallets(direction, 120, min_informed_score)
                if active < min_informed_wallets:
                    continue

                # 4. Compute signal strength
                wallet_flow_score = min(1.0, norm_ifs_2m * 2)
                divergence_score = min(1.0, divergence / (min_divergence * 3))
                micro_score = min(1.0, (abs(book_imb) + features["absorption_score"]) / 2)
                # Execution score based on spread
                spread_bps = self._market_info.get(token_id, {}).get("spread_bps", 200)
                execution_score = max(0, 1.0 - spread_bps / 300)

                strength = (
                    0.35 * wallet_flow_score
                    + 0.30 * divergence_score
                    + 0.20 * micro_score
                    + 0.15 * execution_score
                )

                if strength < min_strength:
                    continue

                # Check no existing open signal for this market
                if self._has_open_signal(token_id):
                    continue

                info = self._market_info.get(token_id, {})
                signals.append(Signal(
                    token_id=token_id,
                    direction=direction,
                    signal_strength=round(strength, 4),
                    entry_mid=features.get("mid_drift_2m", 0),  # current mid from micro state
                    informed_flow=round(ifs_2m, 2),
                    divergence=round(divergence * 10000, 2),  # store as bps
                    book_imbalance=round(book_imb, 4),
                    expected_move=round(expected_move * 10000, 2),  # store as bps
                    question=info.get("question", ""),
                    market_url=info.get("market_url", ""),
                ))

        return signals

    def set_cooldown(self, token_id: str):
        """Set market cooldown after a stop loss or invalidation."""
        cooldown_min = self.config.get("market_cooldown_after_stop_min", 10)
        self._cooldowns[token_id] = time.time() + cooldown_min * 60

    def update_avg_volume(self, token_id: str, avg_vol_30m: float):
        """Update average aggressive volume for IFS normalization."""
        self._avg_volume_30m[token_id] = avg_vol_30m

    def _has_open_signal(self, token_id: str) -> bool:
        """Check if there's already an open signal for this market."""
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.execute(
                "SELECT COUNT(*) FROM ifnl_signals WHERE token_id=? AND status='open'",
                (token_id,)
            )
            count = cur.fetchone()[0]
            conn.close()
            return count > 0
        except Exception:
            return False
