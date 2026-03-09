"""
Strategy Registry
=================
Maps strategy slugs to their implementation classes.
"""

from strategies.bond_hunter import BondHunterStrategy
from strategies.ifnl_lite import IfnlLiteStrategy

STRATEGY_REGISTRY = {
    'bond_hunter': BondHunterStrategy,
    'ifnl_lite': IfnlLiteStrategy,
}


def get_strategy(slug: str):
    """Returns a strategy instance by slug, or None if not found."""
    cls = STRATEGY_REGISTRY.get(slug)
    return cls() if cls else None


def all_strategies():
    """Returns dict of slug -> strategy instance."""
    return {slug: cls() for slug, cls in STRATEGY_REGISTRY.items()}
