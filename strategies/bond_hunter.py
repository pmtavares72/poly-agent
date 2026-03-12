"""
Bond Hunter Strategy
====================
Buys YES tokens in binary markets at 0.92-0.995, holds until resolution,
exits at 1.0 for small but consistent returns.

Risk model:
- Win rate must exceed breakeven threshold (e.g., at 0.95 entry, need >95.2% wins)
- Protection comes from SELECTION, not stop-losses
- Diversify: many small positions across uncorrelated markets
- Higher probability = larger position (confidence scaling)
"""

import json
import time
import sqlite3
from datetime import datetime, timezone
from typing import Optional

import requests
from rich.console import Console

from strategies.base import BaseStrategy

GAMMA_API = "https://gamma-api.polymarket.com/markets"
CLOB_PRICES = "https://clob.polymarket.com/prices-history"
CLOB_LAST_TRADE = "https://clob.polymarket.com/last-trade-price"
REQUEST_TIMEOUT = 10
SLEEP_BETWEEN_REQUESTS = 0.1

console = Console()


class BondHunterStrategy(BaseStrategy):
    slug = "bond_hunter"
    name = "Bond Hunter"
    strategy_type = "cron"

    def init_tables(self, conn: sqlite3.Connection):
        """Bond Hunter uses the existing 'signals' table — no new tables needed."""
        pass

    def default_config(self) -> dict:
        return {
            "initial_capital": 500.0,
            "min_probability": 0.92,
            "max_probability": 0.995,
            "min_profit_net": 0.025,        # 2.5% min edge (after fees) — skip marginal trades
            "max_hours_to_close": 168.0,     # up to 7 days
            "min_liquidity_usdc": 300.0,
            "kelly_fraction": 0.35,
            "max_position_pct": 0.20,        # max 20% of capital per trade
            "max_capital_deployed_pct": 0.70, # deploy up to 70%
            "max_per_market_pct": 0.20,      # max exposure per single market
            "min_unique_traders": 10,         # skip thinly traded markets
            "fee_rate": 0.005,
            "scan_interval_min": 15,
        }

    def run(self, conn: sqlite3.Connection, config: dict):
        """Execute a scan — paper or live depending on config['mode']."""
        mode = config.get("mode", "paper")
        if mode == "live":
            run_live(conn, config)
        else:
            run_paper(conn, config)

    def resolve_signals(self, conn: sqlite3.Connection) -> int:
        return resolve_pending_signals(conn)

    def get_signals(self, conn: sqlite3.Connection, status: str = None,
                    limit: int = 100, offset: int = 0) -> dict:
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
        data = [dict(r) for r in cur.fetchall()]
        cur.execute(
            "SELECT COUNT(*) FROM signals" + (" WHERE status=?" if status else ""),
            (status,) if status else (),
        )
        total = cur.fetchone()[0]
        return {"total": total, "limit": limit, "offset": offset, "data": data}

    def get_stats(self, conn: sqlite3.Connection) -> dict:
        cur = conn.cursor()

        def scalar(sql, params=()):
            cur.execute(sql, params)
            v = cur.fetchone()[0]
            return v or 0

        total = scalar("SELECT COUNT(*) FROM signals")
        open_c = scalar("SELECT COUNT(*) FROM signals WHERE status='open'")
        resolved_c = scalar("SELECT COUNT(*) FROM signals WHERE status='resolved'")
        wins = scalar("SELECT COUNT(*) FROM signals WHERE outcome='YES'")
        losses = scalar("SELECT COUNT(*) FROM signals WHERE outcome='NO'")
        total_pnl = scalar("SELECT SUM(pnl_usdc) FROM signals WHERE status='resolved'")
        avg_spread = scalar("SELECT AVG(spread_entry_pct) FROM signals")
        best = scalar("SELECT MAX(pnl_usdc) FROM signals WHERE status='resolved'")
        worst = scalar("SELECT MIN(pnl_usdc) FROM signals WHERE status='resolved'")
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

        win_rate = round(wins / resolved_c * 100, 1) if resolved_c > 0 else 0.0

        return {
            "total_signals": total,
            "open": open_c,
            "resolved": resolved_c,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "total_pnl": round(float(total_pnl), 4),
            "avg_spread_pct": round(float(avg_spread) * 100, 3) if avg_spread else 0,
            "best_trade": round(float(best), 4),
            "worst_trade": round(float(worst), 4),
            "total_fees": round(float(total_fees), 4),
            "pnl_series": pnl_series,
        }


# ─────────────────────────────────────────────
# HTTP HELPERS
# ─────────────────────────────────────────────

def safe_get(url: str, params: dict = None) -> Optional[dict]:
    """GET with retry on 429."""
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 429:
            time.sleep(2)
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        console.print(f"[yellow]  HTTP error: {exc}[/yellow]")
        return None


# ─────────────────────────────────────────────
# MARKET FETCHING
# ─────────────────────────────────────────────

def fetch_open_markets(min_liquidity: float) -> list:
    """Download currently open markets from Gamma API."""
    markets = []
    offset = 0
    limit = 500
    while True:
        params = {
            "active": "true",
            "closed": "false",
            "limit": limit,
            "offset": offset,
            "order": "endDate",
            "ascending": "true",
        }
        data = safe_get(GAMMA_API, params)
        if not data:
            break
        batch = data if isinstance(data, list) else data.get("markets", [])
        if not batch:
            break
        for m in batch:
            outcomes_raw = m.get("outcomes", [])
            if isinstance(outcomes_raw, str):
                try:
                    outcomes_raw = json.loads(outcomes_raw)
                except (ValueError, TypeError):
                    outcomes_raw = []
            if len(outcomes_raw) != 2:
                continue
            if not m.get("clobTokenIds"):
                continue
            if float(m.get("volume") or 0) < 1000:
                continue
            markets.append(m)
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        offset += limit
        if len(batch) < limit:
            break
    return markets


def fetch_price_series(token_id: str, start_ts: int, end_ts: int) -> list:
    """Returns list of {'t': unix, 'p': price} or []."""
    params = {
        "market": token_id,
        "startTs": start_ts,
        "endTs": end_ts,
        "fidelity": 1,
    }
    data = safe_get(CLOB_PRICES, params)
    if not data:
        return []
    history = data.get("history", [])
    return history if isinstance(history, list) else []


# ─────────────────────────────────────────────
# FILTERS
# ─────────────────────────────────────────────

def passes_basic_filters(m: dict, min_liquidity: float, require_resolved: bool = True) -> tuple:
    """
    Returns (True, token_id_yes, outcome_winner) or (False, reason, None).
    require_resolved=True: requires outcomePrices=[1,0] or [0,1] (backtest)
    require_resolved=False: accepts any valid price (paper)
    """
    outcomes = m.get("outcomes") or []
    if isinstance(outcomes, str):
        try:
            outcomes = json.loads(outcomes)
        except (ValueError, TypeError):
            outcomes = []

    if len(outcomes) != 2:
        return False, "not_binary", None

    outcome_prices_raw = m.get("outcomePrices") or []
    if isinstance(outcome_prices_raw, str):
        try:
            outcome_prices_raw = json.loads(outcome_prices_raw)
        except (ValueError, TypeError):
            outcome_prices_raw = []

    if len(outcome_prices_raw) != 2:
        return False, "no_outcome_prices", None

    try:
        op = [float(x) for x in outcome_prices_raw]
    except (TypeError, ValueError):
        return False, "bad_outcome_prices", None

    if op == [1.0, 0.0]:
        outcome_winner = "YES"
    elif op == [0.0, 1.0]:
        outcome_winner = "NO"
    elif require_resolved:
        return False, "disputed_resolution", None
    else:
        outcome_winner = None

    volume = float(m.get("volume", 0) or 0)
    if volume < 1000:
        return False, "low_volume", None

    liquidity_raw = m.get("liquidity")
    if liquidity_raw is not None:
        liquidity = float(liquidity_raw or 0)
        if liquidity < min_liquidity:
            return False, "low_liquidity", None
    else:
        spread_raw = float(m.get("spread") or 1.0)
        if spread_raw > 0.05:
            return False, "low_liquidity_proxy", None

    clob_ids_raw = m.get("clobTokenIds") or m.get("clob_token_ids") or []
    if isinstance(clob_ids_raw, str):
        try:
            clob_ids_raw = json.loads(clob_ids_raw)
        except (ValueError, TypeError):
            clob_ids_raw = []

    if not clob_ids_raw:
        return False, "no_clob_ids", None

    token_id_yes = clob_ids_raw[0]
    return True, token_id_yes, outcome_winner


def compute_wash_score(m: dict) -> tuple:
    """Returns (is_wash: bool, reason: str)"""
    volume_total = float(m.get("volume", 0) or 0)
    volume_24h = float(m.get("volume24hr", 0) or m.get("volume_24h", 0) or 0)
    liquidity = float(m.get("liquidity") or 0)
    traders = int(m.get("uniqueTraderCount", 0) or m.get("unique_traders_count", 0) or 999)

    duration_h = None
    start_str = m.get("startDate") or m.get("startDateIso")
    closed_str = m.get("closedTime") or m.get("endDate") or m.get("endDateIso")
    if start_str and closed_str:
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            close_dt = datetime.fromisoformat(closed_str.replace("Z", "+00:00"))
            duration_h = (close_dt - start_dt).total_seconds() / 3600
        except ValueError:
            pass

    if duration_h is None or duration_h > 24:
        if volume_total > 0 and (volume_24h / volume_total) > 0.85:
            return True, "vol24h/total>0.85"

    if volume_24h > 1000 and traders < 5:
        return True, "few_traders_high_vol"
    if liquidity > 0 and volume_24h > liquidity * 50:
        return True, "vol/liq_anomaly"
    return False, "ok"


# ─────────────────────────────────────────────
# SPREAD & SIZING
# ─────────────────────────────────────────────

def estimate_spread(liquidity: float) -> float:
    """Returns estimated spread as fraction (e.g. 0.005 = 0.5%)."""
    if liquidity > 5000:
        return 0.005
    if liquidity > 1000:
        return 0.010
    return 0.020


def kelly_size(capital: float, entry_price: float, ask_price: float,
               kelly_fraction: float, max_pct: float) -> float:
    """
    Position sizing for Bond Hunter with profit-weighted scaling.

    Uses assumed win probability of 0.995 (Bond Hunter thesis: these markets
    resolve YES with near certainty). Position scales up with expected profit
    — a trade at 0.93 (7% profit) deserves more capital than one at 0.96 (3%).
    """
    assumed_win_prob = 0.995
    b = (1.0 - ask_price) / ask_price  # payout odds
    p = assumed_win_prob
    q = 1.0 - p
    kelly_f = max(0.0, (b * p - q) / b)

    # Profit-weighted scaling: lower entry = higher profit = more capital
    # net_profit ≈ (1 - ask_price) - fee, so scale by expected return
    # At 0.93 (~6% profit): multiplier 1.3
    # At 0.95 (~4% profit): multiplier 1.1
    # At 0.96 (~3% profit): multiplier 1.0
    # At 0.97 (~2% profit): multiplier 0.7
    net_profit = 1.0 - ask_price
    confidence_mult = min(1.4, max(0.6, net_profit * 20.0))  # 3%→0.6, 5%→1.0, 7%→1.4

    position = capital * kelly_fraction * kelly_f * confidence_mult
    position = min(position, capital * max_pct)
    position = max(position, 5.0)
    return position


# ─────────────────────────────────────────────
# SIGNAL RESOLUTION
# ─────────────────────────────────────────────

def _check_market_resolution(token_id: str) -> dict | None:
    """
    Query Gamma API to check if a market has OFFICIALLY resolved.
    Returns dict with 'resolved', 'outcome' ('YES'/'NO'/None), or None on error.

    A market is officially resolved when:
      - closed == true
      - outcomePrices[0] == "1" → YES won
      - outcomePrices[0] == "0" → NO won

    DO NOT use last-trade-price for resolution — a price of 0.93 does NOT mean
    the market resolved YES, it just means the probability is high.
    """
    GAMMA_MARKET_API = "https://gamma-api.polymarket.com/markets"
    try:
        resp = requests.get(
            GAMMA_MARKET_API,
            params={"clob_token_ids": token_id},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        markets = resp.json()
        if not markets:
            return None

        m = markets[0]
        is_closed = m.get("closed", False)
        if not is_closed:
            return {"resolved": False, "outcome": None}

        # Parse outcomePrices to determine winner
        outcome_prices_raw = m.get("outcomePrices", "")
        try:
            if isinstance(outcome_prices_raw, str):
                import json as _json
                outcome_prices = _json.loads(outcome_prices_raw)
            else:
                outcome_prices = outcome_prices_raw
        except (ValueError, TypeError):
            return {"resolved": False, "outcome": None}

        if not outcome_prices or len(outcome_prices) < 2:
            return {"resolved": False, "outcome": None}

        yes_price = float(outcome_prices[0])
        no_price = float(outcome_prices[1])

        # Only consider it resolved if outcome is definitive (1.0 or 0.0)
        if yes_price >= 0.99:
            return {"resolved": True, "outcome": "YES"}
        elif no_price >= 0.99:
            return {"resolved": True, "outcome": "NO"}
        else:
            # Market is closed but not yet fully resolved (still settling)
            return {"resolved": False, "outcome": None}

    except Exception:
        return None


def resolve_pending_signals(conn: sqlite3.Connection) -> int:
    """
    For each 'open' signal, checks the Gamma API for OFFICIAL market resolution.
    Only marks a signal as resolved when the market has definitively closed
    with outcomePrices showing [1,0] (YES) or [0,1] (NO).

    NEVER uses last-trade-price to determine outcome — that was a critical bug
    that could mark positions as won while the market was still open.

    For LIVE signals that resolve YES, auto-sells tokens at 0.99 to recover USDC.
    """
    import logging
    logger = logging.getLogger("bond_hunter.resolve")

    cur = conn.cursor()
    cur.execute("SELECT id, token_id, question, closes_at, position_usdc, shares, protocol_fee, mode FROM signals WHERE status='open'")
    pending = cur.fetchall()
    if not pending:
        return 0
    resolved_count = 0

    now = datetime.now(timezone.utc)
    console.print(f"\n[cyan]Checking {len(pending)} pending signals for official resolution...[/cyan]")

    for row in pending:
        sig_id = row["id"]
        token_id = row["token_id"]
        question = row["question"]
        closes_at_str = row["closes_at"]
        position_usdc = row["position_usdc"]
        shares = row["shares"]
        protocol_fee = row["protocol_fee"]
        mode = row["mode"] or "paper"

        # Query Gamma API for official resolution status
        resolution = _check_market_resolution(token_id)
        time.sleep(SLEEP_BETWEEN_REQUESTS)

        if resolution is None:
            logger.warning(f"Could not check resolution for signal #{sig_id}: {question[:40]}")
            continue

        if not resolution["resolved"]:
            # Market has NOT officially resolved — do nothing
            # Expire only if way past close date and still no resolution
            try:
                closes_dt = datetime.fromisoformat(closes_at_str.replace("Z", "+00:00"))
                hours_past = (now - closes_dt).total_seconds() / 3600
                if hours_past > 72:  # 3 days past close with no resolution
                    cur.execute("UPDATE signals SET status='expired' WHERE id=?", (sig_id,))
                    conn.commit()
                    logger.info(f"Expired signal #{sig_id} (72h past close, no resolution): {question[:40]}")
            except (ValueError, TypeError):
                pass
            continue

        # Market has OFFICIALLY resolved
        outcome = resolution["outcome"]

        if outcome == "YES":
            redeem_fee = 0.0
            if mode == "live":
                redeem_fee = _auto_redeem(token_id, shares, question, logger)
            revenue = (shares or 0) * 1.0 - redeem_fee
            pnl = revenue - (position_usdc or 0) - (protocol_fee or 0)
        else:  # NO
            revenue = 0.0
            pnl = -((position_usdc or 0) + (protocol_fee or 0))

        pnl_pct = (pnl / position_usdc * 100) if position_usdc else 0
        icon = "✅" if outcome == "YES" else "❌"
        q_short = (question[:50] + "…") if question and len(question) > 50 else question
        color = "green" if pnl >= 0 else "red"
        pnl_str = f"+${pnl:.2f}" if pnl >= 0 else f"-${abs(pnl):.2f}"
        redeem_tag = " [bold magenta](REDEEMED)[/bold magenta]" if mode == "live" and outcome == "YES" else ""
        console.print(f"  {icon}  [bold]{q_short}[/bold]  [{color}]{pnl_str}[/{color}]  (resolved){redeem_tag}")
        logger.info(f"Resolved #{sig_id}: {outcome} | pnl=${pnl:.2f} | {question[:40]}")

        cur.execute("""
            UPDATE signals SET outcome=?, resolved_at=?, pnl_usdc=?, pnl_pct=?, status='resolved'
            WHERE id=?
        """, (outcome, now.isoformat(), pnl, pnl_pct, sig_id))
        conn.commit()
        resolved_count += 1

    return resolved_count


def _auto_redeem(token_id: str, shares: float, question: str, logger) -> float:
    """
    Auto-redeem a winning live position by selling tokens at 0.99.
    Returns the redeem cost (shares * 0.01) on success, 0.0 on failure.
    The caller deducts this from revenue.
    """
    try:
        from clob_client import sell_position
        sell_size = round(shares, 2)
        if sell_size < 1.0:
            logger.info(f"Redeem skip (too small): {sell_size} shares for {question[:40]}")
            return 0.0

        response = sell_position(token_id=token_id, size=sell_size, price=0.99)
        order_id = response.get("orderID") or response.get("id") or "unknown"
        logger.info(f"Auto-redeem OK: {question[:40]} | {sell_size} shares | order={order_id}")
        console.print(f"    [magenta]💰 Auto-redeem: sold {sell_size} shares @ 0.99 → order {order_id}[/magenta]")
        # Cost of selling at 0.99 instead of 1.00
        return shares * 0.01
    except Exception as e:
        logger.error(f"Auto-redeem FAILED: {question[:40]} | {shares} shares | {e}")
        console.print(f"    [red]⚠ Auto-redeem failed: {e}[/red]")
        console.print(f"    [red]  Manual claim needed for {token_id}[/red]")
        return 0.0


# ─────────────────────────────────────────────
# PAPER TRADING SCAN
# ─────────────────────────────────────────────

def run_paper(conn: sqlite3.Connection, config: dict):
    """
    Paper trading mode: scan open markets, detect Bond Hunter signals,
    record in signals table without executing real orders.
    """
    defaults = BondHunterStrategy().default_config()
    def cfg(key):
        return config.get(key, defaults[key])

    min_prob = cfg("min_probability")
    max_prob = cfg("max_probability")
    min_profit_net = cfg("min_profit_net")
    max_hours = cfg("max_hours_to_close")
    min_liquidity = cfg("min_liquidity_usdc")
    fee_rate = cfg("fee_rate")
    capital = cfg("initial_capital")
    kelly_fraction = cfg("kelly_fraction")
    max_position_pct = cfg("max_position_pct")
    max_capital_deployed_pct = cfg("max_capital_deployed_pct")
    min_unique_traders = cfg("min_unique_traders")

    import time as _time
    scan_start = _time.time()

    # Insert scan_log entry
    scan_started_at = datetime.now(timezone.utc).isoformat()
    cur_log = conn.cursor()
    cur_log.execute(
        "INSERT INTO scan_log (started_at, mode) VALUES (?, 'paper')",
        (scan_started_at,)
    )
    conn.commit()
    scan_log_id = cur_log.lastrowid

    # Resolve pending signals first
    resolved_count = resolve_pending_signals(conn)

    # Check available capital
    cur_cap = conn.cursor()
    cur_cap.execute("SELECT COALESCE(SUM(position_usdc),0), COUNT(*) FROM signals WHERE status='open'")
    committed_usdc, open_count = cur_cap.fetchone()
    max_deployable = capital * max_capital_deployed_pct
    available_capital = max(0.0, max_deployable - committed_usdc)
    deployed_pct = (committed_usdc / capital * 100) if capital > 0 else 0

    # Build set of markets with recent losses (cooldown: skip for 24h)
    cur_cap.execute("""
        SELECT token_id FROM signals
        WHERE outcome='NO' AND resolved_at > datetime('now', '-24 hours')
    """)
    recent_loss_tokens = {row[0] for row in cur_cap.fetchall()}

    if committed_usdc >= max_deployable:
        console.print(
            f"\n[yellow]⚠ Capital deployed ${committed_usdc:.2f} "
            f"({deployed_pct:.0f}%) ≥ limit {max_capital_deployed_pct*100:.0f}% "
            f"of capital. No new positions.[/yellow]\n"
        )
        markets = []
    else:
        console.print(f"\n[cyan]Scanning open markets for Bond Hunter signals...[/cyan]\n")
        console.print(
            f"[cyan]  Capital: ${capital:.2f} · Deployed: ${committed_usdc:.2f} "
            f"({deployed_pct:.0f}%) · Available: ${available_capital:.2f} "
            f"(limit {max_capital_deployed_pct*100:.0f}%)[/cyan]\n"
        )
        markets = fetch_open_markets(min_liquidity)
        console.print(f"[cyan]  {len(markets)} active markets found[/cyan]\n")

    new_signals = 0
    markets_checked = 0
    skipped_wash = 0
    skipped_spread = 0
    skipped_no_data = 0
    skipped_price = 0
    skipped_quality = 0

    for m in markets:
        question = m.get("question", m.get("title", "Unknown"))

        ok, token_or_reason, _ = passes_basic_filters(m, min_liquidity, require_resolved=False)
        if not ok:
            continue

        token_id_yes = token_or_reason
        markets_checked += 1

        # Skip markets where we recently lost
        if token_id_yes in recent_loss_tokens:
            continue

        is_wash, _ = compute_wash_score(m)
        if is_wash:
            skipped_wash += 1
            continue

        # Minimum unique traders filter (only apply if data available)
        traders = int(m.get("uniqueTraderCount", 0) or m.get("unique_traders_count", 0) or 0)
        if traders > 0 and traders < min_unique_traders:
            skipped_quality += 1
            continue

        end_date_str = m.get("endDate") or m.get("endDateIso") or ""
        try:
            end_dt = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            end_ts = int(end_dt.timestamp())
        except ValueError:
            continue

        now_ts = int(datetime.now(timezone.utc).timestamp())
        hours_to_close = (end_ts - now_ts) / 3600.0
        if hours_to_close <= 0 or hours_to_close > max_hours:
            continue

        time.sleep(SLEEP_BETWEEN_REQUESTS)
        start_ts = now_ts - 600
        history = fetch_price_series(token_id_yes, start_ts, now_ts)
        if not history:
            skipped_no_data += 1
            continue

        try:
            current_price = float(history[-1]["p"])
        except (KeyError, TypeError, ValueError):
            continue

        if not (min_prob <= current_price <= max_prob):
            skipped_price += 1
            continue

        # Price stability check: reject if price dropped >3% in last 10 min
        if len(history) >= 2:
            oldest_price = float(history[0]["p"])
            if oldest_price > 0 and (current_price - oldest_price) / oldest_price < -0.03:
                skipped_quality += 1
                continue

        # Skip if we already have any position for this token (open or recent)
        cur = conn.cursor()
        cur.execute("""
            SELECT id FROM signals
            WHERE token_id=? AND (
                status='open'
                OR detected_at > datetime('now', '-7 days')
            )
        """, (token_id_yes,))
        if cur.fetchone():
            continue

        if available_capital < 5.0:
            break

        liquidity_raw = m.get("liquidity")
        liquidity = float(liquidity_raw or 0) if liquidity_raw is not None else None
        if liquidity is None:
            market_spread = float(m.get("spread") or 0.02)
            liquidity = 10000.0 if market_spread < 0.005 else (2000.0 if market_spread < 0.01 else 800.0)

        spread = estimate_spread(liquidity)
        ask_price = min(current_price + spread / 2, 0.999)
        net_profit_pct = (1.0 - ask_price) - fee_rate

        if net_profit_pct < min_profit_net:
            skipped_spread += 1
            continue

        if available_capital < 5.0:
            break
        position_usdc = kelly_size(capital, current_price, ask_price, kelly_fraction, max_position_pct)
        position_usdc = min(position_usdc, available_capital)  # can't exceed available
        available_capital -= position_usdc
        shares = position_usdc / ask_price
        protocol_fee = position_usdc * fee_rate
        breakeven = ask_price + fee_rate

        volume_24h = float(m.get("volume24hr") or 0)
        market_url = f"https://polymarket.com/event/{m.get('slug', '')}"

        cur.execute("""
            INSERT INTO signals (
                detected_at, token_id, question, market_url, closes_at,
                hours_to_close, entry_price, ask_price, spread_entry_pct,
                net_profit_pct, position_usdc, shares, protocol_fee,
                breakeven_price, liquidity, volume_24h, wash_score, status,
                mode
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            datetime.now(timezone.utc).isoformat(),
            token_id_yes, question, market_url,
            end_date_str, hours_to_close,
            current_price, ask_price, spread,
            net_profit_pct, position_usdc, shares, protocol_fee,
            breakeven, liquidity, volume_24h, "ok", "open",
            "paper"
        ))
        conn.commit()
        new_signals += 1

        q_short = (question[:52] + "…") if len(question) > 52 else question.ljust(53)
        console.print(
            f"  🎯  [bold]{q_short}[/bold]  "
            f"[cyan]${current_price:.4f}[/cyan]  "
            f"[yellow]${position_usdc:.2f}[/yellow]  "
            f"closes in [white]{hours_to_close:.1f}h[/white]  "
            f"net=[green]+{net_profit_pct*100:.2f}%[/green]"
        )

    # Update scan_log
    finished_at = datetime.now(timezone.utc).isoformat()
    duration_sec = round(_time.time() - scan_start, 1)
    conn.execute("""
        UPDATE scan_log SET
            finished_at=?, duration_sec=?,
            markets_fetched=?, markets_checked=?,
            signals_found=?, signals_resolved=?,
            skipped_wash=?, skipped_spread=?,
            skipped_no_data=?, skipped_price=?
        WHERE id=?
    """, (
        finished_at, duration_sec,
        len(markets), markets_checked,
        new_signals, resolved_count,
        skipped_wash, skipped_spread,
        skipped_no_data, skipped_price,
        scan_log_id,
    ))
    conn.commit()

    console.print(f"\n[bold]Bond Hunter paper scan complete.[/bold]")
    console.print(f"  Markets downloaded:   [cyan]{len(markets)}[/cyan]")
    console.print(f"  Markets analyzed:     [cyan]{markets_checked}[/cyan]")
    console.print(f"  New signals:          [green]{new_signals}[/green]")
    console.print(f"  Signals resolved:     [green]{resolved_count}[/green]")
    console.print(f"  Skipped (wash):       [dim]{skipped_wash}[/dim]")
    console.print(f"  Skipped (quality):    [dim]{skipped_quality}[/dim]")
    console.print(f"  Skipped (spread):     [dim]{skipped_spread}[/dim]")
    console.print(f"  No CLOB data:         [dim]{skipped_no_data}[/dim]")
    console.print(f"  Price out of range:   [dim]{skipped_price}[/dim]")
    console.print(f"  Duration:             [dim]{duration_sec}s[/dim]\n")


# ─────────────────────────────────────────────
# LIVE TRADING SCAN
# ─────────────────────────────────────────────

def run_live(conn: sqlite3.Connection, config: dict):
    """
    Live trading mode: same logic as run_paper() but places real limit orders
    on Polymarket via py-clob-client. Uses GTC limit BUY orders only.

    Bond Hunter does NOT sell — when the market resolves YES, tokens
    automatically redeem at $1.00 on-chain (no exit order needed).
    """
    import logging
    logger = logging.getLogger("bond_hunter.live")

    # Validate CLOB client BEFORE scanning markets
    try:
        from clob_client import get_clob_client, place_limit_order
        client = get_clob_client()
        logger.info("CLOB client initialized OK")
        console.print("[green]  ✓ CLOB client connected[/green]")
    except Exception as e:
        logger.error(f"CLOB client failed: {e}")
        console.print(f"\n[red bold]⛔ Cannot connect to CLOB API: {e}[/red bold]")
        console.print("[red]Check credentials in Settings page or environment variables.[/red]\n")
        return

    defaults = BondHunterStrategy().default_config()
    def cfg(key):
        return config.get(key, defaults[key])

    min_prob = cfg("min_probability")
    max_prob = cfg("max_probability")
    min_profit_net = cfg("min_profit_net")
    max_hours = cfg("max_hours_to_close")
    min_liquidity = cfg("min_liquidity_usdc")
    fee_rate = cfg("fee_rate")
    capital = cfg("initial_capital")
    kelly_fraction = cfg("kelly_fraction")
    max_position_pct = cfg("max_position_pct")
    max_capital_deployed_pct = cfg("max_capital_deployed_pct")
    min_unique_traders = cfg("min_unique_traders")

    # Safety rails from env
    import os
    daily_loss_limit = float(os.environ.get("POLYAGENT_DAILY_LOSS_LIMIT", "-50.0"))

    import time as _time
    scan_start = _time.time()

    # Insert scan_log entry
    scan_started_at = datetime.now(timezone.utc).isoformat()
    cur_log = conn.cursor()
    cur_log.execute(
        "INSERT INTO scan_log (started_at, mode) VALUES (?, 'live')",
        (scan_started_at,)
    )
    conn.commit()
    scan_log_id = cur_log.lastrowid

    # Resolve pending signals first (same as paper — checks market resolution)
    resolved_count = resolve_pending_signals(conn)

    # Check daily P&L — stop if below limit
    cur_pnl = conn.cursor()
    cur_pnl.execute("""
        SELECT COALESCE(SUM(pnl_usdc), 0) FROM signals
        WHERE mode='live' AND status='resolved'
        AND resolved_at >= date('now', 'start of day')
    """)
    daily_pnl = cur_pnl.fetchone()[0]
    if daily_pnl <= daily_loss_limit:
        console.print(
            f"\n[red bold]⛔ Daily loss limit reached: ${daily_pnl:.2f} "
            f"(limit: ${daily_loss_limit:.2f}). No new orders.[/red bold]\n"
        )
        return

    # Check available capital (only count live open positions)
    cur_cap = conn.cursor()
    cur_cap.execute("SELECT COALESCE(SUM(position_usdc),0), COUNT(*) FROM signals WHERE status='open' AND mode='live'")
    committed_usdc, open_count = cur_cap.fetchone()
    max_deployable = capital * max_capital_deployed_pct
    available_capital = max(0.0, max_deployable - committed_usdc)
    deployed_pct = (committed_usdc / capital * 100) if capital > 0 else 0

    # Cooldown: skip markets where we recently lost
    cur_cap.execute("""
        SELECT token_id FROM signals
        WHERE outcome='NO' AND resolved_at > datetime('now', '-24 hours')
    """)
    recent_loss_tokens = {row[0] for row in cur_cap.fetchall()}

    if committed_usdc >= max_deployable:
        console.print(
            f"\n[yellow]⚠ Capital deployed ${committed_usdc:.2f} "
            f"({deployed_pct:.0f}%) ≥ limit {max_capital_deployed_pct*100:.0f}% "
            f"of capital. No new orders.[/yellow]\n"
        )
        markets = []
    else:
        console.print(f"\n[cyan]Scanning open markets for Bond Hunter [bold]LIVE[/bold] signals...[/cyan]\n")
        console.print(
            f"[cyan]  Capital: ${capital:.2f} · Deployed: ${committed_usdc:.2f} "
            f"({deployed_pct:.0f}%) · Available: ${available_capital:.2f} "
            f"(limit {max_capital_deployed_pct*100:.0f}%) · Daily P&L: ${daily_pnl:.2f}[/cyan]\n"
        )
        markets = fetch_open_markets(min_liquidity)
        console.print(f"[cyan]  {len(markets)} active markets found[/cyan]\n")

    new_signals = 0
    markets_checked = 0
    skipped_wash = 0
    skipped_spread = 0
    skipped_no_data = 0
    skipped_price = 0
    skipped_quality = 0
    order_errors = 0

    for m in markets:
        question = m.get("question", m.get("title", "Unknown"))

        ok, token_or_reason, _ = passes_basic_filters(m, min_liquidity, require_resolved=False)
        if not ok:
            continue

        token_id_yes = token_or_reason
        markets_checked += 1

        # Skip markets where we recently lost
        if token_id_yes in recent_loss_tokens:
            continue

        is_wash, _ = compute_wash_score(m)
        if is_wash:
            skipped_wash += 1
            continue

        # Minimum unique traders filter
        traders = int(m.get("uniqueTraderCount", 0) or m.get("unique_traders_count", 0) or 0)
        if traders > 0 and traders < min_unique_traders:
            skipped_quality += 1
            continue

        end_date_str = m.get("endDate") or m.get("endDateIso") or ""
        try:
            end_dt = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            end_ts = int(end_dt.timestamp())
        except ValueError:
            continue

        now_ts = int(datetime.now(timezone.utc).timestamp())
        hours_to_close = (end_ts - now_ts) / 3600.0
        if hours_to_close <= 0 or hours_to_close > max_hours:
            continue

        time.sleep(SLEEP_BETWEEN_REQUESTS)
        start_ts = now_ts - 600
        history = fetch_price_series(token_id_yes, start_ts, now_ts)
        if not history:
            skipped_no_data += 1
            continue

        try:
            current_price = float(history[-1]["p"])
        except (KeyError, TypeError, ValueError):
            continue

        if not (min_prob <= current_price <= max_prob):
            skipped_price += 1
            continue

        # Price stability check
        if len(history) >= 2:
            oldest_price = float(history[0]["p"])
            if oldest_price > 0 and (current_price - oldest_price) / oldest_price < -0.03:
                skipped_quality += 1
                continue

        # Check no existing position for this token (open OR recently placed)
        # This prevents duplicate orders across scans.
        # Check ANY signal for this token in the last 7 days, regardless of status —
        # if we already bought it, don't buy again even if it was resolved/expired.
        cur = conn.cursor()
        cur.execute("""
            SELECT id FROM signals
            WHERE token_id=? AND (
                status='open'
                OR (mode='live' AND detected_at > datetime('now', '-7 days'))
            )
        """, (token_id_yes,))
        if cur.fetchone():
            continue

        if available_capital < 5.0:
            break

        liquidity_raw = m.get("liquidity")
        liquidity = float(liquidity_raw or 0) if liquidity_raw is not None else None
        if liquidity is None:
            market_spread = float(m.get("spread") or 0.02)
            liquidity = 10000.0 if market_spread < 0.005 else (2000.0 if market_spread < 0.01 else 800.0)

        spread = estimate_spread(liquidity)
        ask_price = min(current_price + spread / 2, 0.999)
        net_profit_pct = (1.0 - ask_price) - fee_rate

        if net_profit_pct < min_profit_net:
            skipped_spread += 1
            continue

        if available_capital < 5.0:
            break
        position_usdc = kelly_size(capital, current_price, ask_price, kelly_fraction, max_position_pct)
        position_usdc = min(position_usdc, available_capital)
        shares = position_usdc / ask_price
        protocol_fee = position_usdc * fee_rate
        breakeven = ask_price + fee_rate

        # ── PLACE REAL ORDER ──────────────────────
        # Round price to 2 decimal places (CLOB requirement for prices near 1.0)
        order_price = round(ask_price, 2)
        order_size = round(shares, 2)

        if order_size < 5.0 or position_usdc < 5.0:
            continue  # Too small — minimum $5 / 5 shares per order

        try:
            response = place_limit_order(
                token_id=token_id_yes,
                price=order_price,
                size=order_size,
            )
            order_id = response.get("orderID") or response.get("id") or "unknown"
        except Exception as e:
            logger.error(f"Order failed: {question[:50]} | price={order_price} size={order_size} | {e}")
            console.print(f"  [red]✗ Order failed for {question[:40]}...: {e}[/red]")
            order_errors += 1
            continue

        # Order placed successfully — record in DB
        available_capital -= position_usdc

        volume_24h = float(m.get("volume24hr") or 0)
        market_url = f"https://polymarket.com/event/{m.get('slug', '')}"

        cur.execute("""
            INSERT INTO signals (
                detected_at, token_id, question, market_url, closes_at,
                hours_to_close, entry_price, ask_price, spread_entry_pct,
                net_profit_pct, position_usdc, shares, protocol_fee,
                breakeven_price, liquidity, volume_24h, wash_score, status,
                mode, order_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            datetime.now(timezone.utc).isoformat(),
            token_id_yes, question, market_url,
            end_date_str, hours_to_close,
            current_price, order_price, spread,
            net_profit_pct, position_usdc, order_size, protocol_fee,
            breakeven, liquidity, volume_24h, "ok", "open",
            "live", str(order_id),
        ))
        conn.commit()
        new_signals += 1

        q_short = (question[:52] + "…") if len(question) > 52 else question.ljust(53)
        console.print(
            f"  🎯  [bold]{q_short}[/bold]  "
            f"[cyan]${order_price:.4f}[/cyan]  "
            f"[yellow]${position_usdc:.2f}[/yellow]  "
            f"closes in [white]{hours_to_close:.1f}h[/white]  "
            f"net=[green]+{net_profit_pct*100:.2f}%[/green]  "
            f"[bold magenta]ORDER={order_id}[/bold magenta]"
        )

    # Update scan_log
    finished_at = datetime.now(timezone.utc).isoformat()
    duration_sec = round(_time.time() - scan_start, 1)
    conn.execute("""
        UPDATE scan_log SET
            finished_at=?, duration_sec=?,
            markets_fetched=?, markets_checked=?,
            signals_found=?, signals_resolved=?,
            skipped_wash=?, skipped_spread=?,
            skipped_no_data=?, skipped_price=?
        WHERE id=?
    """, (
        finished_at, duration_sec,
        len(markets), markets_checked,
        new_signals, resolved_count,
        skipped_wash, skipped_spread,
        skipped_no_data, skipped_price,
        scan_log_id,
    ))
    conn.commit()

    logger.info(
        f"LIVE scan done: markets={len(markets)} analyzed={markets_checked} "
        f"orders={new_signals} errors={order_errors} resolved={resolved_count}"
    )

    console.print(f"\n[bold]Bond Hunter LIVE scan complete.[/bold]")
    console.print(f"  Markets downloaded:   [cyan]{len(markets)}[/cyan]")
    console.print(f"  Markets analyzed:     [cyan]{markets_checked}[/cyan]")
    console.print(f"  [bold green]Orders placed:       {new_signals}[/bold green]")
    console.print(f"  Signals resolved:     [green]{resolved_count}[/green]")
    if order_errors > 0:
        console.print(f"  [red bold]Order errors:         {order_errors} ← check logs/agent.log[/red bold]")
    else:
        console.print(f"  Order errors:         [dim]{order_errors}[/dim]")
    console.print(f"  Skipped (wash):       [dim]{skipped_wash}[/dim]")
    console.print(f"  Skipped (quality):    [dim]{skipped_quality}[/dim]")
    console.print(f"  Skipped (spread):     [dim]{skipped_spread}[/dim]")
    console.print(f"  No CLOB data:         [dim]{skipped_no_data}[/dim]")
    console.print(f"  Price out of range:   [dim]{skipped_price}[/dim]")
    console.print(f"  Daily P&L:            [dim]${daily_pnl:.2f}[/dim]")
    console.print(f"  Duration:             [dim]{duration_sec}s[/dim]\n")
