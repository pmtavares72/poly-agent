"""
IFNL-Lite Continuous Runner
=============================
Main process loop for the IFNL-Lite strategy. Connects WebSocket, starts
Data API poller, runs market selection, signal generation, and position management.

Started/stopped via API (/strategies/ifnl_lite/enable or /strategies/ifnl_lite/disable).
"""

import asyncio
import json
import logging
import os
import sqlite3
import signal
import sys
import time

from strategies.ifnl_lite.ws_client import WsClient
from strategies.ifnl_lite.data_api import DataApiClient
from strategies.ifnl_lite.market_selector import select_markets
from strategies.ifnl_lite.microstructure import MicrostructureEngine
from strategies.ifnl_lite.signal_engine import SignalEngine
from strategies.ifnl_lite.execution import ExecutionManager

logger = logging.getLogger(__name__)

DB_PATH = os.environ.get("POLYAGENT_DB", "data/polyagent.db")
MARKET_REFRESH_INTERVAL = 300  # 5 minutes


class IfnlRunner:
    """Orchestrates all IFNL-Lite components in a single async event loop."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._running = False
        self._config: dict = {}
        self._capital: float = 0.0
        self._started_at: float = 0.0
        self._markets_monitored: int = 0
        self._market_names: list[str] = []
        self._trades_captured: int = 0
        self._wallets_seen: set[str] = set()
        self._signals_generated: int = 0
        self._last_market_refresh: float = 0.0
        self._ws_connected: bool = False
        self._status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "logs", "ifnl_lite_status.json")

        # Components
        self.ws_client = WsClient()
        self.data_api = DataApiClient()
        self.micro_engine = MicrostructureEngine()
        self.signal_engine: SignalEngine | None = None
        self.execution: ExecutionManager | None = None

    def _load_config(self):
        """Load strategy config and capital from DB."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT config_json, capital FROM strategies WHERE slug='ifnl_lite'")
        row = cur.fetchone()
        conn.close()

        if row:
            try:
                self._config = json.loads(row["config_json"] or "{}")
            except json.JSONDecodeError:
                self._config = {}
            self._capital = float(row["capital"] or 0)

        # Merge with defaults
        from strategies.ifnl_lite import IfnlLiteStrategy
        defaults = IfnlLiteStrategy().default_config()
        for k, v in defaults.items():
            if k not in self._config:
                self._config[k] = v

    def _write_status(self):
        """Write live status to JSON file for the API to read."""
        try:
            status = {
                "running": self._running,
                "started_at": self._started_at,
                "uptime_seconds": int(time.time() - self._started_at) if self._started_at else 0,
                "ws_connected": self._ws_connected,
                "markets_monitored": self._markets_monitored,
                "market_names": self._market_names[:10],
                "trades_captured": self._trades_captured,
                "unique_wallets_seen": len(self._wallets_seen),
                "signals_generated": self._signals_generated,
                "last_market_refresh": self._last_market_refresh,
                "last_status_update": time.time(),
                "capital": self._capital,
            }
            # Gather flow accumulator stats
            if self.signal_engine:
                total_flows = sum(
                    len(acc.flows) for acc in self.signal_engine.flow_accumulators.values()
                )
                status["active_flow_entries"] = total_flows
            # Micro engine stats
            status["book_states"] = len(self.micro_engine.states) if hasattr(self.micro_engine, 'states') else 0

            os.makedirs(os.path.dirname(self._status_file), exist_ok=True)
            with open(self._status_file, "w") as f:
                json.dump(status, f)
        except Exception as e:
            logger.debug(f"Failed to write status file: {e}")

    def _on_data_trades(self, market_id: str, trades: list):
        """Callback wrapper for data API trades — counts and forwards."""
        self._trades_captured += len(trades)
        for t in trades:
            if hasattr(t, 'proxy_wallet') and t.proxy_wallet:
                self._wallets_seen.add(t.proxy_wallet)
        if self.signal_engine:
            self.signal_engine.process_wallet_trades(market_id, trades)

    async def run(self):
        """Main entry point — starts all components and runs until stopped."""
        self._running = True
        self._started_at = time.time()
        self._tasks: list[asyncio.Task] = []
        self._load_config()

        logger.info(f"IFNL-Lite starting with capital=${self._capital:.2f}")

        # Initialize signal engine and execution manager
        self.signal_engine = SignalEngine(self._config, self.micro_engine, self.db_path)
        self.execution = ExecutionManager(self._config, self.db_path, self.micro_engine, self.signal_engine)

        # Wire up WebSocket callbacks to microstructure engine
        self.ws_client.on_book_update(
            lambda token_id, book: self.micro_engine.on_book_update(token_id, book)
        )
        self.ws_client.on_trade(
            lambda token_id, price, side: self.micro_engine.on_trade(token_id, price, side)
        )

        # Wire up Data API callbacks — goes through our counting wrapper
        self.data_api.on_trades(self._on_data_trades)

        # Run all tasks concurrently
        self._tasks = [
            asyncio.create_task(self._market_selection_loop()),
            asyncio.create_task(self.ws_client.run()),
            asyncio.create_task(self.data_api.start()),
            asyncio.create_task(self._signal_loop()),
            asyncio.create_task(self._exit_check_loop()),
            asyncio.create_task(self._status_loop()),
        ]
        try:
            await asyncio.gather(*self._tasks)
        except asyncio.CancelledError:
            logger.info("IFNL-Lite runner cancelled")
        finally:
            await self._cleanup()

    async def stop(self):
        """Signal all tasks to stop and cancel them."""
        self._running = False
        # Cancel all running tasks so gather() exits
        for t in getattr(self, '_tasks', []):
            if not t.done():
                t.cancel()

    async def _cleanup(self):
        """Clean up resources after tasks finish."""
        self._running = False
        try:
            await self.ws_client.stop()
        except Exception:
            pass
        try:
            await self.data_api.stop()
        except Exception:
            pass
        # Write final stopped status
        try:
            status = {"running": False, "stopped_at": time.time()}
            with open(self._status_file, "w") as f:
                json.dump(status, f)
        except Exception:
            pass
        logger.info("IFNL-Lite stopped")

    async def _market_selection_loop(self):
        """Periodically refresh market universe."""
        while self._running:
            try:
                self._load_config()  # Refresh config each cycle
                markets = await asyncio.get_event_loop().run_in_executor(
                    None, select_markets, self._config
                )

                if markets:
                    token_ids = [m["token_id"] for m in markets]
                    self.signal_engine.set_market_info(markets)

                    # Update WebSocket subscriptions
                    await self.ws_client.subscribe(token_ids)

                    # Update Data API monitoring
                    self.data_api.set_markets(set(token_ids))

                    # Track for status
                    self._markets_monitored = len(markets)
                    self._market_names = [m.get("question", m["token_id"][:16]) for m in markets]
                    self._last_market_refresh = time.time()
                    self._ws_connected = True

                    logger.info(f"Monitoring {len(markets)} markets")
                    self._write_status()

            except Exception as e:
                logger.error(f"Market selection error: {e}")

            await asyncio.sleep(MARKET_REFRESH_INTERVAL)

    async def _status_loop(self):
        """Write status file every 10 seconds."""
        while self._running:
            self._write_status()
            await asyncio.sleep(10)

    async def _signal_loop(self):
        """Check for new signals every 5 seconds."""
        # Wait for initial market selection and some data accumulation
        await asyncio.sleep(30)

        while self._running:
            try:
                signals = self.signal_engine.check_signals()
                for sig in signals:
                    if self._capital > 0:
                        self.execution.execute_signal(sig, self._capital)
                        self._signals_generated += 1
            except Exception as e:
                logger.error(f"Signal generation error: {e}")

            await asyncio.sleep(5)

    async def _exit_check_loop(self):
        """Check exits every 3 seconds."""
        await asyncio.sleep(30)

        while self._running:
            try:
                exits = self.execution.check_exits()
                for ex in exits:
                    logger.info(
                        f"Exit: signal #{ex['signal_id']} reason={ex['reason']} "
                        f"pnl=${ex['pnl_usdc']:+.2f}"
                    )
            except Exception as e:
                logger.error(f"Exit check error: {e}")

            await asyncio.sleep(3)


def main():
    """CLI entry point for IFNL-Lite runner."""
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("logs/ifnl_lite.log", mode="a"),
        ]
    )

    parser = argparse.ArgumentParser(description="IFNL-Lite Runner")
    parser.add_argument("--db", default=os.environ.get("POLYAGENT_DB", "data/polyagent.db"))
    args = parser.parse_args()

    runner = IfnlRunner(db_path=args.db)

    # Handle graceful shutdown via asyncio-native signal handling
    loop = asyncio.new_event_loop()

    async def run_with_signals():
        # Add signal handlers inside the running loop so they work properly
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(runner.stop()))
        await runner.run()

    try:
        loop.run_until_complete(run_with_signals())
    except KeyboardInterrupt:
        loop.run_until_complete(runner._cleanup())
    finally:
        loop.close()


if __name__ == "__main__":
    main()
