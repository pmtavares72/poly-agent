-- PolyAgent Database Migrations
-- ================================
-- All schema changes must be recorded here for OpenClaw deployment.
-- Migrations are idempotent (safe to run multiple times).

-- ===========================================
-- Migration 001: Strategy registry table
-- Added: Multi-strategy architecture support
-- ===========================================
CREATE TABLE IF NOT EXISTS strategies (
    slug        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'cron',
    enabled     INTEGER DEFAULT 0,
    capital     REAL DEFAULT 0,
    config_json TEXT DEFAULT '{}',
    created_at  TEXT,
    updated_at  TEXT
);

-- Seed strategies
INSERT OR IGNORE INTO strategies (slug, name, type, enabled, capital, config_json, created_at)
VALUES ('bond_hunter', 'Bond Hunter', 'cron', 1, 500.0, '{}', datetime('now'));

INSERT OR IGNORE INTO strategies (slug, name, type, enabled, capital, config_json, created_at)
VALUES ('ifnl_lite', 'IFNL-Lite', 'continuous', 0, 500.0, '{}', datetime('now'));

-- ===========================================
-- Migration 002: IFNL-Lite tables
-- Added: Wallet profiling + IFNL signals
-- ===========================================
CREATE TABLE IF NOT EXISTS ifnl_wallet_profiles (
    proxy_wallet    TEXT PRIMARY KEY,
    total_trades    INTEGER DEFAULT 0,
    n_markets       INTEGER DEFAULT 0,
    avg_trade_size  REAL DEFAULT 0,
    pnl_markout_5m  REAL DEFAULT 0,
    pnl_markout_30m REAL DEFAULT 0,
    pnl_markout_2h  REAL DEFAULT 0,
    informed_score  REAL DEFAULT 0.5,
    noise_score     REAL DEFAULT 0.5,
    reliability     REAL DEFAULT 0.5,
    last_updated    TEXT
);

CREATE TABLE IF NOT EXISTS ifnl_wallet_trades (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    proxy_wallet    TEXT NOT NULL,
    market_id       TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    side            TEXT,
    price           REAL,
    size_usd        REAL,
    mid_at_trade    REAL,
    mid_5m_after    REAL,
    mid_30m_after   REAL,
    mid_2h_after    REAL
);

CREATE TABLE IF NOT EXISTS ifnl_signals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    detected_at     TEXT NOT NULL,
    token_id        TEXT NOT NULL,
    question        TEXT,
    market_url      TEXT,
    direction       TEXT,
    signal_strength REAL,
    entry_mid       REAL,
    entry_price     REAL,
    exit_price      REAL,
    position_usdc   REAL,
    informed_flow   REAL,
    divergence      REAL,
    book_imbalance  REAL,
    tp_target       REAL,
    sl_target       REAL,
    time_limit_min  INTEGER,
    resolved_at     TEXT,
    pnl_usdc        REAL,
    pnl_pct         REAL,
    exit_reason     TEXT,
    status          TEXT DEFAULT 'open'
);
