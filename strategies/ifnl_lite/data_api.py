"""
Polymarket Data API Client
===========================
Polls the Data API REST endpoint for recent trades with proxyWallet info.
This is the "delayed wallet identification loop" — bridges anonymous WebSocket
data with wallet-aware signal generation (~15s polling interval).

Endpoints:
- GET https://data-api.polymarket.com/trades?market={id} — recent trades
- GET https://data-api.polymarket.com/activity?id={wallet} — wallet activity
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import aiohttp

logger = logging.getLogger(__name__)

DATA_API_BASE = "https://data-api.polymarket.com"
POLL_INTERVAL = 15.0  # seconds between trade polls per market
RATE_LIMIT_DELAY = 0.5  # seconds between API requests


@dataclass
class WalletTrade:
    """A single trade with wallet attribution from Data API."""
    proxy_wallet: str
    market_id: str
    timestamp: str
    side: str  # 'BUY' | 'SELL'
    outcome: str  # 'Yes' | 'No'
    price: float
    size: float  # in tokens
    size_usd: float


class DataApiClient:
    """
    Polls Polymarket Data API for recent trades on monitored markets.
    Identifies which wallets are active and feeds them to the signal engine.
    """

    def __init__(self):
        self._monitored_markets: set[str] = set()
        self._running = False
        self._session: Optional[aiohttp.ClientSession] = None
        self._on_trades_callbacks: list[Callable] = []
        self._last_seen_ts: dict[str, str] = {}  # market_id -> last trade timestamp

    def on_trades(self, callback: Callable):
        """Register callback: callback(market_id, list[WalletTrade])"""
        self._on_trades_callbacks.append(callback)

    def set_markets(self, token_ids: set[str]):
        """Update the set of markets to poll."""
        self._monitored_markets = set(token_ids)

    async def start(self):
        """Start the polling loop."""
        self._running = True
        self._session = aiohttp.ClientSession()
        logger.info(f"DataApiClient started, polling {len(self._monitored_markets)} markets")

        try:
            while self._running:
                for market_id in list(self._monitored_markets):
                    if not self._running:
                        break
                    try:
                        trades = await self._fetch_recent_trades(market_id)
                        if trades:
                            for cb in self._on_trades_callbacks:
                                try:
                                    cb(market_id, trades)
                                except Exception as e:
                                    logger.error(f"Trade callback error: {e}")
                    except Exception as e:
                        logger.warning(f"Failed to fetch trades for {market_id}: {e}")
                    await asyncio.sleep(RATE_LIMIT_DELAY)

                await asyncio.sleep(POLL_INTERVAL)
        finally:
            if self._session:
                await self._session.close()
                self._session = None

    async def stop(self):
        """Stop the polling loop."""
        self._running = False
        if self._session:
            await self._session.close()
            self._session = None

    async def _fetch_recent_trades(self, market_id: str) -> list[WalletTrade]:
        """Fetch recent trades for a market from the Data API."""
        if not self._session:
            return []

        url = f"{DATA_API_BASE}/trades"
        params = {"market": market_id, "limit": 50}

        try:
            async with self._session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    logger.warning(f"Data API returned {resp.status} for {market_id}")
                    return []
                data = await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.warning(f"Data API request failed for {market_id}: {e}")
            return []

        if not isinstance(data, list):
            return []

        last_ts = self._last_seen_ts.get(market_id, "")
        new_trades = []

        for trade in data:
            ts = trade.get("timestamp", "")
            if ts <= last_ts:
                continue

            proxy_wallet = trade.get("proxyWallet") or trade.get("proxy_wallet", "")
            if not proxy_wallet:
                continue

            try:
                price = float(trade.get("price", 0))
                size = float(trade.get("size", 0))
                size_usd = price * size
            except (TypeError, ValueError):
                continue

            new_trades.append(WalletTrade(
                proxy_wallet=proxy_wallet,
                market_id=market_id,
                timestamp=ts,
                side=trade.get("side", ""),
                outcome=trade.get("outcome", ""),
                price=price,
                size=size,
                size_usd=size_usd,
            ))

        if new_trades:
            # Update last seen timestamp to newest trade
            newest_ts = max(t.timestamp for t in new_trades)
            self._last_seen_ts[market_id] = newest_ts

        return new_trades

    async def fetch_wallet_activity(self, wallet: str, limit: int = 100) -> list[dict]:
        """Fetch recent activity for a specific wallet (used by wallet profiler)."""
        if not self._session:
            self._session = aiohttp.ClientSession()

        url = f"{DATA_API_BASE}/activity"
        params = {"id": wallet, "limit": limit}

        try:
            async with self._session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return []
                return await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            return []
