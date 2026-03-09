"""
WebSocket Client for Polymarket CLOB
=====================================
Connects to Polymarket's WebSocket and maintains real-time order book state
per market. Provides book snapshots, price changes, and trade events.

WebSocket URL: wss://ws-subscriptions-clob.polymarket.com/ws/market
Channels: book, price_change, last_trade_price
"""

import asyncio
import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional

import websockets

logger = logging.getLogger(__name__)

WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"
RECONNECT_BASE_DELAY = 1.0
RECONNECT_MAX_DELAY = 60.0


@dataclass
class BookLevel:
    price: float
    size: float


@dataclass
class MarketBook:
    """Real-time order book state for a single market."""
    token_id: str
    bids: list[BookLevel] = field(default_factory=list)  # sorted desc by price
    asks: list[BookLevel] = field(default_factory=list)  # sorted asc by price
    last_trade_price: float = 0.0
    last_trade_side: str = ""
    last_update_ts: float = 0.0

    @property
    def best_bid(self) -> float:
        return self.bids[0].price if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0].price if self.asks else 1.0

    @property
    def mid(self) -> float:
        if self.bids and self.asks:
            return (self.best_bid + self.best_ask) / 2
        return self.last_trade_price

    @property
    def spread_bps(self) -> float:
        if self.bids and self.asks:
            return (self.best_ask - self.best_bid) * 10000
        return 0.0


class WsClient:
    """
    Manages WebSocket connection to Polymarket CLOB.
    Maintains per-market order book state.
    """

    def __init__(self):
        self.books: dict[str, MarketBook] = {}
        self._subscribed_tokens: set[str] = set()
        self._ws = None
        self._running = False
        self._on_trade_callbacks: list[Callable] = []
        self._on_book_update_callbacks: list[Callable] = []

    def on_trade(self, callback: Callable):
        """Register a callback for trade events: callback(token_id, price, side)"""
        self._on_trade_callbacks.append(callback)

    def on_book_update(self, callback: Callable):
        """Register a callback for book updates: callback(token_id, book)"""
        self._on_book_update_callbacks.append(callback)

    async def subscribe(self, token_ids: list[str]):
        """Subscribe to markets. Can be called while connected."""
        new_tokens = set(token_ids) - self._subscribed_tokens
        if not new_tokens:
            return

        self._subscribed_tokens.update(new_tokens)

        # Initialize books
        for tid in new_tokens:
            if tid not in self.books:
                self.books[tid] = MarketBook(token_id=tid)

        # Send subscription if connected
        if self._ws:
            for tid in new_tokens:
                await self._send_subscribe(tid)

    async def unsubscribe(self, token_ids: list[str]):
        """Unsubscribe from markets."""
        for tid in token_ids:
            self._subscribed_tokens.discard(tid)
            self.books.pop(tid, None)

    async def _send_subscribe(self, token_id: str):
        """Send subscription message for a single token."""
        if not self._ws:
            return
        for channel in ["book", "price_change", "last_trade_price"]:
            msg = json.dumps({
                "type": "subscribe",
                "channel": channel,
                "market": token_id,
            })
            try:
                await self._ws.send(msg)
            except Exception as e:
                logger.warning(f"Failed to subscribe {token_id}/{channel}: {e}")

    async def run(self):
        """Main connection loop with reconnection."""
        self._running = True
        delay = RECONNECT_BASE_DELAY

        while self._running:
            try:
                async with websockets.connect(WS_URL, ping_interval=30, ping_timeout=10) as ws:
                    self._ws = ws
                    delay = RECONNECT_BASE_DELAY
                    logger.info(f"WebSocket connected to {WS_URL}")

                    # Re-subscribe to all tokens
                    for tid in self._subscribed_tokens:
                        await self._send_subscribe(tid)

                    # Process messages
                    async for raw_msg in ws:
                        try:
                            msg = json.loads(raw_msg)
                            await self._handle_message(msg)
                        except json.JSONDecodeError:
                            continue

            except (websockets.ConnectionClosed, ConnectionError, OSError) as e:
                logger.warning(f"WebSocket disconnected: {e}. Reconnecting in {delay:.1f}s...")
                self._ws = None
                await asyncio.sleep(delay)
                delay = min(delay * 2, RECONNECT_MAX_DELAY)

            except Exception as e:
                logger.error(f"WebSocket error: {e}. Reconnecting in {delay:.1f}s...")
                self._ws = None
                await asyncio.sleep(delay)
                delay = min(delay * 2, RECONNECT_MAX_DELAY)

    async def stop(self):
        """Stop the WebSocket connection."""
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None

    async def _handle_message(self, msg: dict):
        """Route incoming WebSocket message to appropriate handler."""
        channel = msg.get("channel", "")
        market = msg.get("market", "")

        if market not in self.books:
            return

        book = self.books[market]
        now = time.time()

        if channel == "book":
            # Full or partial book update
            data = msg.get("data", {})
            if "bids" in data:
                book.bids = [BookLevel(float(b["price"]), float(b["size"]))
                             for b in data["bids"] if float(b.get("size", 0)) > 0]
                book.bids.sort(key=lambda x: x.price, reverse=True)
            if "asks" in data:
                book.asks = [BookLevel(float(a["price"]), float(a["size"]))
                             for a in data["asks"] if float(a.get("size", 0)) > 0]
                book.asks.sort(key=lambda x: x.price)
            book.last_update_ts = now

            for cb in self._on_book_update_callbacks:
                try:
                    cb(market, book)
                except Exception as e:
                    logger.error(f"Book update callback error: {e}")

        elif channel == "last_trade_price":
            data = msg.get("data", {})
            try:
                price = float(data.get("price", 0))
                side = data.get("side", "")
                book.last_trade_price = price
                book.last_trade_side = side
                book.last_update_ts = now

                for cb in self._on_trade_callbacks:
                    try:
                        cb(market, price, side)
                    except Exception as e:
                        logger.error(f"Trade callback error: {e}")
            except (TypeError, ValueError):
                pass

        elif channel == "price_change":
            data = msg.get("data", {})
            try:
                price = float(data.get("price", 0))
                book.last_trade_price = price
                book.last_update_ts = now
            except (TypeError, ValueError):
                pass
