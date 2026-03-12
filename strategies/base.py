"""
Base Strategy Interface
=======================
All strategies must implement this interface.
"""

from abc import ABC, abstractmethod
import sqlite3


class BaseStrategy(ABC):
    slug: str = ""
    name: str = ""
    strategy_type: str = "cron"  # 'cron' | 'continuous'

    @abstractmethod
    def init_tables(self, conn: sqlite3.Connection):
        """Create strategy-specific DB tables."""
        ...

    @abstractmethod
    def run(self, conn: sqlite3.Connection, config: dict):
        """Execute one cycle of the strategy (scan for cron, tick for continuous)."""
        ...

    @abstractmethod
    def resolve_signals(self, conn: sqlite3.Connection) -> int:
        """Resolve pending signals. Returns count resolved."""
        ...

    @abstractmethod
    def get_signals(self, conn: sqlite3.Connection, status: str = None,
                    limit: int = 100, offset: int = 0) -> dict:
        """Return signals in {total, limit, offset, data} format."""
        ...

    @abstractmethod
    def get_stats(self, conn: sqlite3.Connection, mode: str | None = None) -> dict:
        """Return strategy-specific stats. Optional mode filter (paper/live)."""
        ...

    @abstractmethod
    def default_config(self) -> dict:
        """Return default config params for this strategy."""
        ...
