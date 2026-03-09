"""
Microstructure Analysis
========================
Computes real-time microstructure features from WebSocket order book data:
- Book imbalance (bid/ask volume ratio)
- Trade imbalance (net signed volume over rolling windows)
- Mid drift (midpoint change over window)
- Absorption detection (volume at best without price moving)
"""

import logging
import time
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class TradeEvent:
    """Timestamped trade from WebSocket."""
    ts: float
    price: float
    side: str  # 'buy' or 'sell'
    size_usd: float = 0.0


@dataclass
class MidSnapshot:
    """Timestamped midpoint snapshot."""
    ts: float
    mid: float


@dataclass
class MicrostructureState:
    """Rolling microstructure state for a single market."""
    token_id: str
    trades: deque = field(default_factory=lambda: deque(maxlen=500))
    mids: deque = field(default_factory=lambda: deque(maxlen=500))

    # Latest computed features
    book_imbalance: float = 0.0
    trade_imbalance_30s: float = 0.0
    trade_imbalance_2m: float = 0.0
    trade_imbalance_5m: float = 0.0
    mid_drift_2m: float = 0.0
    mid_drift_5m: float = 0.0
    absorption_score: float = 0.0
    last_update_ts: float = 0.0


class MicrostructureEngine:
    """
    Maintains per-market microstructure state.
    Fed by WsClient callbacks for book updates and trades.
    """

    def __init__(self):
        self.states: dict[str, MicrostructureState] = {}

    def ensure_state(self, token_id: str) -> MicrostructureState:
        if token_id not in self.states:
            self.states[token_id] = MicrostructureState(token_id=token_id)
        return self.states[token_id]

    def on_book_update(self, token_id: str, book) -> None:
        """Called on each book update from WsClient. Computes imbalance and records mid."""
        state = self.ensure_state(token_id)
        now = time.time()

        # Book imbalance: (bid_qty - ask_qty) / (bid_qty + ask_qty) over top 3 levels
        bid_qty = sum(level.size for level in book.bids[:3]) if book.bids else 0.0
        ask_qty = sum(level.size for level in book.asks[:3]) if book.asks else 0.0
        total = bid_qty + ask_qty
        state.book_imbalance = (bid_qty - ask_qty) / total if total > 0 else 0.0

        # Record mid snapshot
        mid = book.mid
        if mid > 0:
            state.mids.append(MidSnapshot(ts=now, mid=mid))

        # Compute mid drift
        state.mid_drift_2m = self._mid_drift(state, window_sec=120)
        state.mid_drift_5m = self._mid_drift(state, window_sec=300)

        # Compute absorption (bid volume that didn't move price)
        state.absorption_score = self._compute_absorption(state, book)

        state.last_update_ts = now

    def on_trade(self, token_id: str, price: float, side: str) -> None:
        """Called on each trade event from WsClient."""
        state = self.ensure_state(token_id)
        now = time.time()

        state.trades.append(TradeEvent(
            ts=now,
            price=price,
            side=side,
            size_usd=0.0,  # WS doesn't provide size, set from Data API later
        ))

        # Update trade imbalances
        state.trade_imbalance_30s = self._trade_imbalance(state, window_sec=30)
        state.trade_imbalance_2m = self._trade_imbalance(state, window_sec=120)
        state.trade_imbalance_5m = self._trade_imbalance(state, window_sec=300)

    def enrich_trade_size(self, token_id: str, price: float, size_usd: float) -> None:
        """Enrich a recent trade with size info from Data API polling."""
        state = self.states.get(token_id)
        if not state:
            return
        # Find matching trade by price (most recent) and fill in size
        for trade in reversed(state.trades):
            if abs(trade.price - price) < 0.001 and trade.size_usd == 0.0:
                trade.size_usd = size_usd
                break

    def get_features(self, token_id: str) -> dict:
        """Return current microstructure features for signal engine."""
        state = self.states.get(token_id)
        if not state:
            return {
                "book_imbalance": 0.0,
                "trade_imbalance_30s": 0.0,
                "trade_imbalance_2m": 0.0,
                "trade_imbalance_5m": 0.0,
                "mid_drift_2m": 0.0,
                "mid_drift_5m": 0.0,
                "absorption_score": 0.0,
            }
        return {
            "book_imbalance": round(state.book_imbalance, 4),
            "trade_imbalance_30s": round(state.trade_imbalance_30s, 4),
            "trade_imbalance_2m": round(state.trade_imbalance_2m, 4),
            "trade_imbalance_5m": round(state.trade_imbalance_5m, 4),
            "mid_drift_2m": round(state.mid_drift_2m, 6),
            "mid_drift_5m": round(state.mid_drift_5m, 6),
            "absorption_score": round(state.absorption_score, 4),
        }

    def _trade_imbalance(self, state: MicrostructureState, window_sec: float) -> float:
        """Net signed volume: +1 for buy, -1 for sell, weighted by size if available."""
        cutoff = time.time() - window_sec
        net = 0.0
        count = 0
        for trade in state.trades:
            if trade.ts < cutoff:
                continue
            sign = 1.0 if trade.side.lower() in ("buy", "buy_yes") else -1.0
            weight = trade.size_usd if trade.size_usd > 0 else 1.0
            net += sign * weight
            count += 1
        if count == 0:
            return 0.0
        # Normalize by count to get directional bias [-1, 1]
        total_abs = sum(
            (t.size_usd if t.size_usd > 0 else 1.0)
            for t in state.trades if t.ts >= cutoff
        )
        return net / total_abs if total_abs > 0 else 0.0

    def _mid_drift(self, state: MicrostructureState, window_sec: float) -> float:
        """Midpoint change over window in absolute price terms."""
        if len(state.mids) < 2:
            return 0.0
        cutoff = time.time() - window_sec
        # Find earliest mid in window
        earliest = None
        for snap in state.mids:
            if snap.ts >= cutoff:
                earliest = snap
                break
        if earliest is None:
            return 0.0
        latest = state.mids[-1]
        return latest.mid - earliest.mid

    def _compute_absorption(self, state: MicrostructureState, book) -> float:
        """
        Absorption score: how much volume was traded at best bid/ask without
        the price moving. High absorption = passive liquidity absorbing aggressive flow.
        Score 0-1.
        """
        if len(state.mids) < 5:
            return 0.0

        now = time.time()
        window = 60  # last 60 seconds
        cutoff = now - window

        # Count trades at best levels
        best_bid = book.best_bid if book.bids else 0
        best_ask = book.best_ask if book.asks else 1

        trades_at_best = 0
        total_recent = 0
        for trade in state.trades:
            if trade.ts < cutoff:
                continue
            total_recent += 1
            if abs(trade.price - best_bid) < 0.005 or abs(trade.price - best_ask) < 0.005:
                trades_at_best += 1

        if total_recent == 0:
            return 0.0

        # High absorption = many trades at best levels with stable mid
        mid_stability = 1.0 - min(abs(self._mid_drift(state, window)), 0.02) / 0.02
        trade_concentration = trades_at_best / total_recent

        return min(1.0, trade_concentration * mid_stability)
