"""
Market Selector
================
Determines which markets IFNL-Lite monitors. Runs periodically (every 5 min)
to refresh the eligible universe. Markets are ranked by volume * liquidity
and the top N are selected.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com/markets"
SLEEP_BETWEEN_REQUESTS = 0.2


def select_markets(config: dict) -> list[dict]:
    """
    Fetch open markets from Polymarket and filter by IFNL eligibility criteria.

    Returns list of dicts: [{token_id, question, market_url, volume_24h, liquidity,
                             spread_bps, hours_to_resolution}]
    sorted by score (volume * liquidity) descending, limited to max_monitored_markets.
    """
    min_volume = config.get("min_24h_volume", 50000)
    min_oi = config.get("min_open_interest", 100000)
    max_spread = config.get("max_spread_bps", 250)
    min_ttr_hours = config.get("min_ttr_hours", 6)
    max_ttr_days = config.get("max_ttr_days", 45)
    min_liquidity = config.get("min_top_level_liquidity_usd", 1500)
    max_markets = config.get("max_monitored_markets", 10)

    # Fetch open markets
    markets = _fetch_open_markets(min_liquidity)
    if not markets:
        logger.warning("No markets fetched from Gamma API")
        return []

    now = datetime.now(timezone.utc)
    eligible = []

    for m in markets:
        try:
            # Must be binary (2 outcomes)
            tokens = m.get("clobTokenIds", "")
            if isinstance(tokens, str):
                tokens = [t.strip() for t in tokens.strip("[]").replace('"', '').split(",") if t.strip()]
            if len(tokens) != 2:
                continue

            # Volume check
            volume_24h = float(m.get("volume24hr", 0) or 0)
            if volume_24h < min_volume:
                continue

            # Liquidity check
            liquidity = float(m.get("liquidityClob", 0) or m.get("liquidity", 0) or 0)
            if liquidity < min_liquidity:
                continue

            # Time to resolution
            end_date_str = m.get("endDate") or m.get("closesAt")
            if not end_date_str:
                continue
            try:
                end_date = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                continue

            hours_to_resolution = (end_date - now).total_seconds() / 3600
            if hours_to_resolution < min_ttr_hours:
                continue
            if hours_to_resolution > max_ttr_days * 24:
                continue

            # Spread estimation (rough: from outcome prices if available)
            spread_bps = _estimate_spread_bps(m)
            if spread_bps > max_spread:
                continue

            # Score for ranking
            score = volume_24h * liquidity

            token_id = tokens[0]  # YES token

            eligible.append({
                "token_id": token_id,
                "token_id_no": tokens[1] if len(tokens) > 1 else "",
                "question": m.get("question", ""),
                "market_url": f"https://polymarket.com/event/{m.get('slug', '')}",
                "condition_id": m.get("conditionId", ""),
                "volume_24h": volume_24h,
                "liquidity": liquidity,
                "spread_bps": spread_bps,
                "hours_to_resolution": round(hours_to_resolution, 1),
                "score": score,
            })

        except (TypeError, ValueError, KeyError) as e:
            continue

    # Sort by score descending, take top N
    eligible.sort(key=lambda x: x["score"], reverse=True)
    selected = eligible[:max_markets]

    logger.info(f"Market selector: {len(markets)} fetched, {len(eligible)} eligible, {len(selected)} selected")
    return selected


def _fetch_open_markets(min_liquidity: float) -> list[dict]:
    """Fetch open markets from Gamma API with pagination."""
    all_markets = []
    offset = 0
    limit = 100

    while True:
        try:
            resp = requests.get(GAMMA_API, params={
                "limit": limit,
                "offset": offset,
                "active": True,
                "closed": False,
            }, timeout=15)
            resp.raise_for_status()
            batch = resp.json()
        except Exception as e:
            logger.error(f"Gamma API fetch error at offset {offset}: {e}")
            break

        if not batch:
            break

        all_markets.extend(batch)
        offset += limit
        time.sleep(SLEEP_BETWEEN_REQUESTS)

        # Safety cap
        if offset > 1000:
            break

    return all_markets


def _estimate_spread_bps(market: dict) -> float:
    """Estimate bid-ask spread from market data. Returns bps."""
    liquidity = float(market.get("liquidityClob", 0) or market.get("liquidity", 0) or 0)

    # Rough spread estimation based on liquidity tiers
    if liquidity > 50000:
        return 30
    elif liquidity > 20000:
        return 60
    elif liquidity > 10000:
        return 100
    elif liquidity > 5000:
        return 150
    elif liquidity > 1500:
        return 200
    else:
        return 300
