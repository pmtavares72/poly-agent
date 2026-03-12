"""
CLOB Client Wrapper
====================
Wraps py-clob-client for Polymarket real trading.
Handles initialization, API credentials, order placement, and balance checks.

Credential resolution order:
1. Database (credentials table — saved from Settings page)
2. Environment variables (.env file or OpenClaw secrets)
"""

import os
import sqlite3
import logging

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import OrderArgs, OrderType, ApiCreds
from py_clob_client.order_builder.constants import BUY, SELL

logger = logging.getLogger(__name__)

# Singleton client instance
_client: ClobClient | None = None


def _load_creds_from_db() -> dict:
    """Load credentials from DB. Returns empty dict if unavailable."""
    db_path = os.environ.get("POLYAGENT_DB", "/app/data/polyagent.db")
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM credentials WHERE id=1")
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else {}
    except Exception:
        return {}


def get_clob_client() -> ClobClient:
    """
    Returns a configured ClobClient singleton.
    Reads credentials from DB first, falls back to environment variables.
    Auto-derives API credentials if not provided.
    """
    global _client
    if _client is not None:
        return _client

    # Try DB first, then env vars
    db_creds = _load_creds_from_db()

    private_key = db_creds.get("private_key") or os.environ.get("POLYMARKET_PRIVATE_KEY", "")
    if not private_key:
        raise RuntimeError(
            "POLYMARKET_PRIVATE_KEY not set. "
            "Configure it in Settings or add it to .env"
        )

    host = os.environ.get("POLYMARKET_CLOB_HOST", "https://clob.polymarket.com")
    chain_id = int(os.environ.get("POLYMARKET_CHAIN_ID", "137"))
    signature_type = int(
        db_creds.get("signature_type") or os.environ.get("POLYMARKET_SIGNATURE_TYPE", "1")
    )
    funder = db_creds.get("funder_address") or os.environ.get("POLYMARKET_FUNDER_ADDRESS", "")

    if not funder:
        raise RuntimeError(
            "POLYMARKET_FUNDER_ADDRESS not set. "
            "Configure it in Settings or add it to .env"
        )

    # Ensure 0x prefix for py-clob-client
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    client = ClobClient(
        host,
        key=private_key,
        chain_id=chain_id,
        signature_type=signature_type,
        funder=funder,
    )

    # Set API credentials (DB > env > auto-derive)
    api_key = db_creds.get("api_key") or os.environ.get("POLYMARKET_API_KEY", "")
    api_secret = db_creds.get("api_secret") or os.environ.get("POLYMARKET_API_SECRET", "")
    api_passphrase = db_creds.get("api_passphrase") or os.environ.get("POLYMARKET_API_PASSPHRASE", "")

    if api_key and api_secret and api_passphrase:
        client.set_api_creds(ApiCreds(
            api_key=api_key,
            api_secret=api_secret,
            api_passphrase=api_passphrase,
        ))
        logger.info("CLOB client initialized with stored API credentials")
    else:
        creds = client.create_or_derive_api_creds()
        client.set_api_creds(creds)
        logger.info("CLOB client initialized — API credentials auto-derived")

    _client = client
    return _client


def place_limit_order(token_id: str, price: float, size: float) -> dict:
    """
    Place a GTC limit BUY order for YES tokens.

    Args:
        token_id: The YES outcome token ID
        price: Limit price (e.g. 0.96)
        size: Number of tokens to buy

    Returns:
        dict with order response from CLOB (includes 'orderID' on success)

    Raises:
        RuntimeError on order failure
    """
    client = get_clob_client()

    order_args = OrderArgs(
        token_id=token_id,
        price=price,
        size=size,
        side=BUY,
    )

    signed_order = client.create_order(order_args)
    response = client.post_order(signed_order, OrderType.GTC)

    if not response:
        raise RuntimeError(f"Empty response from CLOB for order on {token_id}")

    # py-clob-client returns different response formats — normalize
    if isinstance(response, dict):
        if response.get("errorMsg"):
            raise RuntimeError(f"Order rejected: {response['errorMsg']}")
        return response

    # If response is a string (order ID), wrap it
    return {"orderID": str(response), "success": True}


def sell_position(token_id: str, size: float, price: float = 0.99) -> dict:
    """
    Sell YES tokens to cash out a winning position.
    Used for auto-redeem: after market resolves YES, sell at ~0.99 to recover USDC.

    Args:
        token_id: The YES outcome token ID
        size: Number of tokens to sell
        price: Sell price (default 0.99 — fills instantly post-resolution)

    Returns:
        dict with order response

    Raises:
        RuntimeError on failure
    """
    client = get_clob_client()

    order_args = OrderArgs(
        token_id=token_id,
        price=price,
        size=size,
        side=SELL,
    )

    signed_order = client.create_order(order_args)
    response = client.post_order(signed_order, OrderType.GTC)

    if not response:
        raise RuntimeError(f"Empty response from CLOB for sell on {token_id}")

    if isinstance(response, dict):
        if response.get("errorMsg"):
            raise RuntimeError(f"Sell rejected: {response['errorMsg']}")
        return response

    return {"orderID": str(response), "success": True}


def cancel_order(order_id: str) -> dict:
    """Cancel a single order by ID."""
    client = get_clob_client()
    return client.cancel(order_id)


def cancel_all_orders() -> dict:
    """Cancel all open orders."""
    client = get_clob_client()
    return client.cancel_all()


def get_order(order_id: str) -> dict | None:
    """Get order details by ID. Returns None if not found."""
    client = get_clob_client()
    try:
        return client.get_order(order_id)
    except Exception:
        return None
