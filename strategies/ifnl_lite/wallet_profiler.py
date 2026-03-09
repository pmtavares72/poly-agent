"""
Wallet Profiler (Offline)
==========================
Runs periodically (daily or manually) to compute wallet profiles from
historical trade data. Profiles are pre-computed and stored in DB for
real-time lookup during signal generation.

Flow:
1. Fetch recent trades from Data API for tracked markets (last 24h)
2. Record wallet + price + size per trade
3. Compute markout P&L at +5m, +30m, +2h after each trade
4. Aggregate per wallet: mean markout, informed_score, noise_score, reliability
5. Store/update ifnl_wallet_profiles table
"""

import logging
import sqlite3
import statistics
import time
from datetime import datetime, timezone, timedelta

import requests

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com/markets"
DATA_API = "https://data-api.polymarket.com"
CLOB_PRICES = "https://clob.polymarket.com/prices-history"
RATE_LIMIT = 0.5

# Minimum requirements for a wallet to be profiled
MIN_TOTAL_TRADES = 30
MIN_N_MARKETS = 5


def run_profiler(db_path: str, lookback_hours: int = 24, market_limit: int = 20):
    """
    Main profiler entry point. Fetches trades, computes markouts, updates profiles.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    logger.info("Starting wallet profiler run...")

    # Step 1: Get active markets to profile
    markets = _fetch_active_markets(market_limit)
    if not markets:
        logger.warning("No active markets found for profiling")
        conn.close()
        return

    logger.info(f"Profiling wallets across {len(markets)} markets")

    # Step 2: Fetch trades and record them
    total_trades = 0
    for market in markets:
        token_id = market.get("token_id", "")
        if not token_id:
            continue

        trades = _fetch_market_trades(token_id, lookback_hours)
        for trade in trades:
            _record_trade(conn, trade, token_id)
            total_trades += 1

        time.sleep(RATE_LIMIT)

    logger.info(f"Recorded {total_trades} trades")

    # Step 3: Fill in markout prices where missing
    _compute_markouts(conn)

    # Step 4: Aggregate into wallet profiles
    _update_profiles(conn)

    conn.commit()
    conn.close()
    logger.info("Wallet profiler run complete")


def _fetch_active_markets(limit: int) -> list[dict]:
    """Fetch high-volume active markets for profiling."""
    try:
        resp = requests.get(GAMMA_API, params={
            "limit": limit,
            "active": True,
            "closed": False,
        }, timeout=15)
        resp.raise_for_status()
        markets = resp.json()
    except Exception as e:
        logger.error(f"Failed to fetch markets for profiling: {e}")
        return []

    result = []
    for m in markets:
        tokens = m.get("clobTokenIds", "")
        if isinstance(tokens, str):
            tokens = [t.strip() for t in tokens.strip("[]").replace('"', '').split(",") if t.strip()]
        if len(tokens) >= 1:
            result.append({
                "token_id": tokens[0],
                "question": m.get("question", ""),
            })

    return result


def _fetch_market_trades(token_id: str, lookback_hours: int) -> list[dict]:
    """Fetch recent trades with wallet info from Data API."""
    try:
        resp = requests.get(f"{DATA_API}/trades", params={
            "market": token_id,
            "limit": 500,
        }, timeout=15)
        resp.raise_for_status()
        trades = resp.json()
    except Exception as e:
        logger.warning(f"Failed to fetch trades for {token_id}: {e}")
        return []

    if not isinstance(trades, list):
        return []

    # Filter by lookback window
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
    result = []
    for t in trades:
        wallet = t.get("proxyWallet") or t.get("proxy_wallet", "")
        if not wallet:
            continue
        ts_str = t.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            if ts < cutoff:
                continue
        except (ValueError, TypeError):
            continue

        try:
            price = float(t.get("price", 0))
            size = float(t.get("size", 0))
        except (TypeError, ValueError):
            continue

        result.append({
            "proxy_wallet": wallet,
            "timestamp": ts_str,
            "side": t.get("side", ""),
            "price": price,
            "size_usd": price * size,
        })

    return result


def _record_trade(conn: sqlite3.Connection, trade: dict, market_id: str):
    """Insert trade into ifnl_wallet_trades if not duplicate."""
    conn.execute("""
        INSERT OR IGNORE INTO ifnl_wallet_trades
        (proxy_wallet, market_id, timestamp, side, price, size_usd, mid_at_trade)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        trade["proxy_wallet"],
        market_id,
        trade["timestamp"],
        trade["side"],
        trade["price"],
        trade["size_usd"],
        trade["price"],  # approximate mid_at_trade as trade price
    ))


def _compute_markouts(conn: sqlite3.Connection):
    """
    Fill in markout prices for trades that are missing them.
    Uses CLOB price history API.
    """
    cur = conn.execute("""
        SELECT id, market_id, timestamp, price FROM ifnl_wallet_trades
        WHERE mid_5m_after IS NULL
        ORDER BY timestamp DESC
        LIMIT 200
    """)
    trades = cur.fetchall()

    if not trades:
        return

    logger.info(f"Computing markouts for {len(trades)} trades")

    for trade in trades:
        trade_id = trade["id"]
        market_id = trade["market_id"]
        ts_str = trade["timestamp"]

        try:
            trade_ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue

        # Check if enough time has passed for each markout window
        now = datetime.now(timezone.utc)
        elapsed_min = (now - trade_ts).total_seconds() / 60

        mid_5m = None
        mid_30m = None
        mid_2h = None

        if elapsed_min >= 5:
            mid_5m = _get_price_at(market_id, trade_ts + timedelta(minutes=5))
        if elapsed_min >= 30:
            mid_30m = _get_price_at(market_id, trade_ts + timedelta(minutes=30))
        if elapsed_min >= 120:
            mid_2h = _get_price_at(market_id, trade_ts + timedelta(hours=2))

        if mid_5m is not None or mid_30m is not None or mid_2h is not None:
            conn.execute("""
                UPDATE ifnl_wallet_trades SET
                    mid_5m_after = COALESCE(?, mid_5m_after),
                    mid_30m_after = COALESCE(?, mid_30m_after),
                    mid_2h_after = COALESCE(?, mid_2h_after)
                WHERE id = ?
            """, (mid_5m, mid_30m, mid_2h, trade_id))

        time.sleep(RATE_LIMIT)


def _get_price_at(market_id: str, target_dt: datetime) -> float | None:
    """
    Get approximate price at a specific time from CLOB price history.
    Returns mid price or None if unavailable.
    """
    ts_sec = int(target_dt.timestamp())

    try:
        resp = requests.get(CLOB_PRICES, params={
            "tokenID": market_id,
            "startTs": ts_sec - 60,
            "endTs": ts_sec + 60,
            "fidelity": 1,  # 1-minute candles
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    if not data or not isinstance(data, list):
        return None

    # Find closest price point
    closest = None
    min_diff = float("inf")
    for point in data:
        try:
            pt_ts = int(point.get("t", 0))
            diff = abs(pt_ts - ts_sec)
            if diff < min_diff:
                min_diff = diff
                closest = float(point.get("p", 0))
        except (TypeError, ValueError):
            continue

    return closest


def _update_profiles(conn: sqlite3.Connection):
    """Aggregate wallet trades into profiles."""
    cur = conn.execute("""
        SELECT proxy_wallet,
               COUNT(*) as total_trades,
               COUNT(DISTINCT market_id) as n_markets,
               AVG(size_usd) as avg_trade_size,
               AVG(mid_5m_after - mid_at_trade) as avg_markout_5m,
               AVG(mid_30m_after - mid_at_trade) as avg_markout_30m,
               AVG(mid_2h_after - mid_at_trade) as avg_markout_2h
        FROM ifnl_wallet_trades
        WHERE mid_at_trade IS NOT NULL
        GROUP BY proxy_wallet
        HAVING COUNT(*) >= ? AND COUNT(DISTINCT market_id) >= ?
    """, (MIN_TOTAL_TRADES, MIN_N_MARKETS))

    wallets = cur.fetchall()
    if not wallets:
        logger.info("No wallets meet minimum requirements for profiling")
        return

    # Collect markout values for z-score normalization
    markouts_5m = []
    markouts_30m = []
    markouts_2h = []
    wallet_data = []

    for w in wallets:
        m5 = w["avg_markout_5m"] or 0
        m30 = w["avg_markout_30m"] or 0
        m2h = w["avg_markout_2h"] or 0
        markouts_5m.append(m5)
        markouts_30m.append(m30)
        markouts_2h.append(m2h)
        wallet_data.append(dict(w))

    # Z-score normalize to [0, 1]
    def normalize(values: list[float]) -> list[float]:
        if len(values) < 2:
            return [0.5] * len(values)
        mean = statistics.mean(values)
        stdev = statistics.stdev(values) if len(values) > 1 else 1.0
        if stdev == 0:
            return [0.5] * len(values)
        # Z-score then sigmoid-like mapping to [0, 1]
        return [max(0, min(1, 0.5 + (v - mean) / (3 * stdev))) for v in values]

    norm_5m = normalize(markouts_5m)
    norm_30m = normalize(markouts_30m)
    norm_2h = normalize(markouts_2h)

    now = datetime.now(timezone.utc).isoformat()
    updated = 0

    for i, w in enumerate(wallet_data):
        informed_score = 0.40 * norm_5m[i] + 0.35 * norm_30m[i] + 0.25 * norm_2h[i]
        noise_score = 1.0 - informed_score
        reliability = min(1.0, w["total_trades"] / 50)

        conn.execute("""
            INSERT INTO ifnl_wallet_profiles
            (proxy_wallet, total_trades, n_markets, avg_trade_size,
             pnl_markout_5m, pnl_markout_30m, pnl_markout_2h,
             informed_score, noise_score, reliability, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(proxy_wallet) DO UPDATE SET
                total_trades = excluded.total_trades,
                n_markets = excluded.n_markets,
                avg_trade_size = excluded.avg_trade_size,
                pnl_markout_5m = excluded.pnl_markout_5m,
                pnl_markout_30m = excluded.pnl_markout_30m,
                pnl_markout_2h = excluded.pnl_markout_2h,
                informed_score = excluded.informed_score,
                noise_score = excluded.noise_score,
                reliability = excluded.reliability,
                last_updated = excluded.last_updated
        """, (
            w["proxy_wallet"],
            w["total_trades"],
            w["n_markets"],
            round(w["avg_trade_size"] or 0, 2),
            round(markouts_5m[i], 6),
            round(markouts_30m[i], 6),
            round(markouts_2h[i], 6),
            round(informed_score, 4),
            round(noise_score, 4),
            round(reliability, 4),
            now,
        ))
        updated += 1

    logger.info(f"Updated {updated} wallet profiles")


if __name__ == "__main__":
    import argparse
    import os

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="IFNL Wallet Profiler")
    parser.add_argument("--db", default=os.environ.get("POLYAGENT_DB", "data/polyagent.db"))
    parser.add_argument("--lookback", type=int, default=24, help="Hours of trade history")
    parser.add_argument("--markets", type=int, default=20, help="Max markets to profile")
    args = parser.parse_args()

    run_profiler(args.db, args.lookback, args.markets)
