# PolyAgent — Architecture & Developer Guide

## Overview

PolyAgent is a Polymarket prediction market trading bot with a **multi-strategy architecture**. Each strategy runs independently with its own capital, config, signals table, and enable/disable control. Runs in paper trading mode with real market data but no real capital.

**Strategies:**
- **Bond Hunter** (cron, every 15 min) — Buys YES tokens at 0.95–0.995 in near-certain markets, holds until resolution (~48h), exits at 1.0 for small consistent returns.
- **IFNL-Lite** (continuous, WebSocket) — Detects divergence between informed trade flow and price movement. Uses offline wallet profiling + real-time microstructure. Holds 5–20 minutes.

**Stack:**
- Backend: Python 3 — FastAPI + SQLite
- Frontend: TypeScript/React — Next.js 14 + SWR + Recharts
- Deployment: Bash + cron (OpenClaw Docker)
- External APIs: Polymarket Gamma API + CLOB Prices API + Data API + WebSocket

---

## Project Structure

```
polyagent/
├── agent.py              # DB init, strategy dispatch, CLI, backtest
├── api.py                # FastAPI REST server (port 8765)
├── backtest.py           # Standalone historical backtest runner
├── migrations.sql        # All DB schema changes for OpenClaw deployment
├── requirements.txt      # Python deps
├── start.sh              # Full orchestration: deps → DB init → API → Frontend → cron
├── stop.sh               # Kill API + frontend + remove cron
├── CLAUDE.md             # This file
├── strategies/
│   ├── __init__.py       # Strategy registry (STRATEGY_REGISTRY dict)
│   ├── base.py           # BaseStrategy ABC
│   ├── bond_hunter.py    # Bond Hunter implementation
│   └── ifnl_lite/
│       ├── __init__.py       # IfnlLiteStrategy class
│       ├── ws_client.py      # WebSocket client (order book, trades)
│       ├── data_api.py       # REST poller for wallet-attributed trades
│       ├── market_selector.py # Market universe filtering
│       ├── microstructure.py  # Book imbalance, absorption, drift
│       ├── signal_engine.py   # IFS computation, divergence detection
│       ├── execution.py       # Paper trading position management
│       ├── wallet_profiler.py # Offline wallet scoring (daily)
│       └── ifnl_runner.py     # Continuous process runner
├── data/                 # Persistent data (gitignored)
│   └── polyagent.db
├── logs/                 # Runtime logs (gitignored)
│   ├── ifnl_lite_status.json  # Live engine metrics (written by runner every 10s)
│   └── ifnl_lite.pid          # Runner PID (written by API on enable)
└── frontend/
    ├── next.config.mjs   # Next.js config — proxy /api/* → localhost:8765
    ├── src/
    │   ├── app/          # Pages (app router)
    │   ├── components/
    │   │   ├── dashboard/   # KpiGrid, PnlChart, BotControl, etc.
    │   │   ├── layout/      # AppShell, Sidebar
    │   │   └── strategies/  # BondHunterCard, IfnlLiteCard
    │   ├── hooks/        # SWR hooks (useStats, useStrategies, etc.)
    │   ├── lib/          # api.ts, auth.ts, format.ts
    │   └── types/        # TypeScript interfaces
    └── ...
```

---

## Multi-Strategy Architecture

### Strategy Base Class (`strategies/base.py`)

```python
class BaseStrategy(ABC):
    slug: str       # 'bond_hunter', 'ifnl_lite'
    name: str       # Display name
    strategy_type: str  # 'cron' | 'continuous'

    def init_tables(self, conn): ...
    def run(self, conn, config): ...
    def resolve_signals(self, conn) -> int: ...
    def get_signals(self, conn, status, limit, offset) -> dict: ...
    def get_stats(self, conn) -> dict: ...
    def default_config(self) -> dict: ...
```

### Strategy Registry (`strategies/__init__.py`)

```python
STRATEGY_REGISTRY = {
    'bond_hunter': BondHunterStrategy,
    'ifnl_lite': IfnlLiteStrategy,
}
```

### Per-Strategy Config

Each strategy stores its config as JSON in `strategies.config_json`. Default config is defined by `strategy.default_config()`. Config is merged with defaults on load.

### Strategy Types

- **cron** — Runs on schedule via `agent.py --strategy <slug>`. Bond Hunter runs every 15 min.
- **continuous** — Runs as a persistent process. IFNL-Lite uses `ifnl_runner.py` with WebSocket + polling loop.

---

## Database

### Location & Persistence

Controlled by `POLYAGENT_DB` environment variable:

| Environment | Path | Set by |
|-------------|------|--------|
| Docker/OpenClaw | `/app/data/polyagent.db` | Default |
| Local (start.sh) | `$SCRIPT_DIR/data/polyagent.db` | `start.sh` |
| Custom | Any path | `export POLYAGENT_DB=/my/path/db` |

### Schema

#### `strategies` (one row per strategy)
```sql
slug        TEXT PRIMARY KEY       -- 'bond_hunter', 'ifnl_lite'
name        TEXT NOT NULL
type        TEXT NOT NULL           -- 'cron' | 'continuous'
enabled     INTEGER DEFAULT 0
capital     REAL DEFAULT 0
config_json TEXT DEFAULT '{}'       -- strategy-specific params as JSON
created_at  TEXT
updated_at  TEXT
```

#### `config` (singleton, id=1) — Bond Hunter legacy config
```sql
id                       INTEGER PRIMARY KEY DEFAULT 1
initial_capital          REAL    DEFAULT 500.0
min_probability          REAL    DEFAULT 0.95
max_probability          REAL    DEFAULT 0.995
min_profit_net           REAL    DEFAULT 0.015
max_hours_to_close       REAL    DEFAULT 48.0
min_liquidity_usdc       REAL    DEFAULT 500.0
kelly_fraction           REAL    DEFAULT 0.25
max_position_pct         REAL    DEFAULT 0.15
max_capital_deployed_pct REAL    DEFAULT 0.50
fee_rate                 REAL    DEFAULT 0.005
scan_interval_min        INTEGER DEFAULT 15
updated_at               TEXT
```

#### `signals` (Bond Hunter paper + live trading)
```sql
id, detected_at, token_id, question, market_url, closes_at, hours_to_close,
entry_price, ask_price, spread_entry_pct, net_profit_pct, position_usdc,
shares, protocol_fee, breakeven_price, liquidity, volume_24h, wash_score,
outcome, resolved_at, pnl_usdc, pnl_pct, status,
-- Risk management (Migration 006)
stop_loss_price, highest_price_seen, trailing_stop_price,
exit_reason, current_price, last_price_check,
-- Live trading (Migration 004)
mode, order_id
```

#### `ifnl_signals` (IFNL-Lite signals)
```sql
id, detected_at, token_id, question, market_url, direction, signal_strength,
entry_mid, entry_price, exit_price, position_usdc, informed_flow, divergence,
book_imbalance, tp_target, sl_target, time_limit_min, resolved_at,
pnl_usdc, pnl_pct, exit_reason, status
```

#### `ifnl_wallet_profiles` (pre-computed wallet scores)
```sql
proxy_wallet (PK), total_trades, n_markets, avg_trade_size,
pnl_markout_5m, pnl_markout_30m, pnl_markout_2h,
informed_score, noise_score, reliability, last_updated
```

#### `ifnl_wallet_trades` (historical trades for profiling)
```sql
id, proxy_wallet, market_id, timestamp, side, price, size_usd,
mid_at_trade, mid_5m_after, mid_30m_after, mid_2h_after
```

#### `bot_status` (singleton, id=1)
```sql
id, enabled, pid, last_scan_at, next_scan_at, last_error, scan_count,
trading_mode TEXT DEFAULT 'paper'  -- Migration 007: UI-controlled paper/live
```

#### `scan_log`, `runs`, `trades`
Unchanged from original schema.

### DB Migrations

**All schema changes must be recorded in `migrations.sql`** for OpenClaw deployment. This file is idempotent (uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`).

`init_db()` in `agent.py` also runs `ALTER TABLE ... ADD COLUMN` migrations for new columns on existing tables.

**Rule:** Every new table or column must appear in both `agent.py init_db()` AND `migrations.sql`.

---

## Backend: agent.py

### CLI Arguments
```
--mode {backtest|paper}   (default: backtest)
--strategy SLUG           (default: bond_hunter)
--force                   bypass bot enabled check
--capital, --days, --min-prob, --max-prob, --min-profit, --max-hours, --min-liq, --fee-rate
```

### Strategy Dispatch
```python
strategy = get_strategy(args.strategy)
strategy.run(conn, config)
```

### Bond Hunter Core Functions (in `strategies/bond_hunter.py`)
- `passes_basic_filters()`, `compute_wash_score()`, `kelly_size()`, `estimate_spread()`
- `fetch_price_series()`, `fetch_open_markets()`
- `resolve_pending_signals()`, `run_paper()`, `run_live()`
- `check_risk_exits()` — automatic stop-loss, trailing stop, time exit
- `check_order_fills()` — verify/cancel live orders
- `_fetch_current_price()`, `_calculate_exit_pnl()`, `_execute_risk_exit()`

---

## Backend: api.py

FastAPI on port 8765. CORS: `allow_origins=["*"]`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | DB path + timestamp |
| GET | `/config` | Bond Hunter config (legacy) |
| POST | `/config` | Update Bond Hunter config |
| GET | `/bot` | Bot status + pid_alive |
| POST | `/bot/enable` | Enable bot |
| POST | `/bot/disable` | Disable bot |
| POST | `/bot/scan-now` | Trigger Bond Hunter scan |
| **POST** | **`/bot/mode`** | **Switch paper/live mode** |
| GET | `/signals` | Bond Hunter signals |
| GET | `/signals/open` | Open signals |
| **GET** | **`/signals/open/live`** | **Open signals + real-time prices + P&L** |
| GET | `/signals/{id}` | Single signal |
| **POST** | **`/signals/{id}/sell`** | **Manual sell (live mode)** |
| **POST** | **`/signals/{id}/sell-paper`** | **Manual sell (paper mode)** |
| GET | `/stats` | Aggregated stats (accepts `?mode=paper\|live`) |
| GET | `/scan-logs` | Scan history |
| **GET** | **`/strategies`** | **List all strategies** |
| **GET** | **`/strategies/{slug}`** | **Strategy detail + stats** |
| **POST** | **`/strategies/{slug}/config`** | **Update strategy config** |
| **POST** | **`/strategies/{slug}/enable`** | **Enable strategy** |
| **POST** | **`/strategies/{slug}/disable`** | **Disable strategy** |
| **POST** | **`/strategies/{slug}/scan-now`** | **Trigger scan** |
| **GET** | **`/strategies/{slug}/signals`** | **Strategy signals** |
| **GET** | **`/strategies/{slug}/signals/open`** | **Open signals** |
| **GET** | **`/strategies/{slug}/stats`** | **Strategy stats** |
| **GET** | **`/strategies/{slug}/activity`** | **Live engine activity (reads status file)** |
| GET | `/runs`, `/runs/{id}`, `/runs/{id}/trades` | Backtest data |

---

## IFNL-Lite Strategy

### Architecture

```
                 ┌──────────────┐
                 │ Market       │  Every 5 min: select top N markets
                 │ Selector     │  by volume * liquidity
                 └──────┬───────┘
                        │ token_ids
            ┌───────────┼───────────┐
            ▼                       ▼
    ┌───────────────┐      ┌──────────────┐
    │ WsClient      │      │ DataApiClient │  REST poll every ~15s
    │ (WebSocket)   │      │ (trades +     │  for proxyWallet
    │ book, trades  │      │  wallet IDs)  │
    └───────┬───────┘      └──────┬────────┘
            │                      │
            ▼                      ▼
    ┌───────────────┐      ┌──────────────┐
    │ Microstructure│      │ Wallet lookup │  DB: ifnl_wallet_profiles
    │ Engine        │      │ (informed_    │
    │ (imbalance,   │      │  score)       │
    │  absorption)  │      └──────┬────────┘
    └───────┬───────┘             │
            │                     │
            └──────────┬──────────┘
                       ▼
              ┌────────────────┐
              │ Signal Engine  │  IFS + divergence detection
              │ (check every   │
              │  5 seconds)    │
              └────────┬───────┘
                       ▼
              ┌────────────────┐
              │ Execution      │  Paper fills, TP/SL/time exits
              │ Manager        │  (check every 3 seconds)
              └────────────────┘
```

### Signal Generation Logic

1. DataApiClient polls `/trades` with `proxyWallet` every ~15s
2. Each wallet is looked up in `ifnl_wallet_profiles` DB
3. Compute IFS (Informed Flow Score) per direction:
   ```
   IFS = sum(trade_size_usd * informed_score * reliability) over window
   ```
4. Expected move = K1 * normalized_IFS_30s + K2 * normalized_IFS_2m
5. Divergence = expected_move - actual_move (from WebSocket mid drift)
6. Signal if: divergence > 18 bps AND book_imbalance confirms AND absorption high AND >= 2 informed wallets

### Exit Rules
- **Take profit:** mid moved >= 80% of expected move
- **Hard stop:** mid moved against > 22 bps
- **Time stop:** > 20 min, or < 6 bps progress after 5 min
- **Invalidation:** book imbalance flips 2x, or no informed trades for 90s
- **Cooldown:** 10 min per market after stop/invalidation

### Wallet Profiler (offline, runs daily)
```bash
python3 -m strategies.ifnl_lite.wallet_profiler --db data/polyagent.db
```
Computes markout P&L at 5m/30m/2h, produces `informed_score` per wallet.

### IFNL Runner
```bash
python3 -m strategies.ifnl_lite.ifnl_runner --db data/polyagent.db
```
Starts continuous process: WsClient + DataApiClient + signal/exit loops.

### Live Activity Monitoring

The runner writes `logs/ifnl_lite_status.json` every 10 seconds with live metrics:
```json
{
  "running": true, "uptime_seconds": 300, "ws_connected": true,
  "markets_monitored": 10, "market_names": ["Will X..."],
  "trades_captured": 1200, "unique_wallets_seen": 85,
  "signals_generated": 3, "book_states": 10, "active_flow_entries": 42
}
```

The API reads this file via `GET /strategies/{slug}/activity`. If the file is >60s old, it adds `possibly_stale: true`. The frontend `IfnlActivityPanel` component polls this every 10s and shows a live metrics grid with color-coded status indicators.

---

## Frontend: Next.js

### API Proxy (critical for mobile/Safari)

All API calls go through Next.js rewrites — **never directly to port 8765**:

```js
// next.config.mjs
rewrites() {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }]
}
```

### Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | page.tsx | Redirect to `/login` |
| `/login` | login/page.tsx | Hardcoded: `admin@polyagent.io` / `admin` |
| `/dashboard` | dashboard/page.tsx | KPIs, PnL chart, signals, bot control |
| `/strategies` | strategies/page.tsx | Bond Hunter + IFNL-Lite config cards |
| `/logs` | logs/page.tsx | Scan execution history |

### Key Components

- **`BondHunterCard`** — Bond Hunter config with editable params + risk management section (stop-loss, trailing, time exit toggles/params), save button
- **`IfnlLiteCard`** — IFNL-Lite config (5 sections: market selection, signal thresholds, position sizing, exit rules, IFS params), start/stop toggle, wallet stats
- **`IfnlActivityPanel`** — Live engine metrics grid (in IfnlDashboard): trades captured, wallets seen, markets monitored, WebSocket status, book states, flow entries, signals generated. Shows "LIVE"/"OFFLINE" indicator + staleness detection.
- **`BotControl`** — Start/stop bot, Scan Now button
- **`ModeToggle`** — Paper/Live mode switch with confirmation for live mode
- **`SignalCard`** — Open signal with real-time price, P&L scenarios, Take Profit / Sell buttons
- **`KpiGrid`** / **`PnlChart`** / **`ActiveSignals`** / **`RecentSignalsTable`**
- **`AppShell`** / **`Sidebar`** / **`TickerTape`**

### Hooks (all SWR-based)

```typescript
useStats()           // 30s refresh → /stats
useSignals(params)   // 30s refresh → /signals
useOpenSignals()     // 30s refresh → /signals/open
useOpenSignalsLive() // 15s refresh → /signals/open/live (real-time prices + P&L)
useBot()             // 5s refresh  → /bot + switchMode()
useConfig()          // → /config + saveConfig()
useStrategies()      // 30s refresh → /strategies
useStrategy(slug)    // 30s refresh → /strategies/{slug}
useStrategyActivity(slug)  // 10s refresh → /strategies/{slug}/activity
useAuth()            // localStorage auth check
```

### Typography
- `var(--mono)` → DM Mono (data, labels, numbers)
- `var(--sans)` → Syne (headings, buttons)

---

## Deployment

### start.sh flow
1. Install Python deps (`pip install -r requirements.txt`)
2. Init DB: `python3 agent.py --mode paper --force` + apply `migrations.sql`
3. Start API: `uvicorn api:app --host 0.0.0.0 --port 8765` (background)
4. `npm install && npm run build && npm start --port 3000` (background)
5. Add cron: `*/15 * * * * python3 agent.py` (mode read from DB)
6. Auto-start IFNL-Lite runner if `enabled=1` in DB (PID saved to `logs/ifnl_lite.pid`)

### Environment variables

```bash
POLYAGENT_DB=/app/data/polyagent.db    # DB path
POLYAGENT_DATA_DIR=/data               # Data dir
API_URL=http://localhost:8765          # Backend URL for Next.js proxy
```

---

## Known Bugs Fixed

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Scan Now disabled after first click | `pid_alive` returned true for zombie process | Detect zombie via `ps -o stat=` checking for `Z` |
| No data on mobile / Safari | `NEXT_PUBLIC_API_URL=localhost` compiled into JS bundle | Next.js proxy: all calls via `/api/*` rewrite |
| Paper trading finds 0 signals | `passes_basic_filters` required `outcomePrices=[1,0]` | Added `require_resolved=False` for paper mode |
| `frontend/src/app/logs/` gitignored | `.gitignore` had `logs/` (matches any subdir) | Changed to `/logs/` (root only) |
| DB reset on Docker rebuild | DB stored in container layer | Moved to `/app/data/` (mounted volume) |
| Signals stay open forever | Gamma API ignores `clobTokenIds` filter | Use CLOB last-trade-price endpoint directly |

---

## Adding a New Strategy

1. Create `strategies/<slug>/` or `strategies/<slug>.py`
2. Implement `BaseStrategy` with all abstract methods
3. Register in `strategies/__init__.py` `STRATEGY_REGISTRY`
4. Add DB tables in `agent.py init_db()` AND `migrations.sql`
5. Seed strategy row: `INSERT OR IGNORE INTO strategies (...)`
6. Add frontend card component in `components/strategies/`
7. Import card in `strategies/page.tsx`

## Adding a New Config Parameter (Bond Hunter)

1. **`agent.py`** — Add column to `CREATE TABLE config` + migration
2. **`agent.py`** — Read in `load_config_from_db()`
3. **`api.py`** — Add to `ConfigUpdate` model
4. **`frontend/src/types/index.ts`** — Add to `BotConfig`
5. **`frontend/src/components/strategies/BondHunterCard.tsx`** — Add to `PARAM_META`

## Adding a New Config Parameter (IFNL-Lite)

1. **`strategies/ifnl_lite/__init__.py`** — Add to `default_config()` dict
2. **`frontend/src/components/strategies/IfnlLiteCard.tsx`** — Add to `PARAM_META`
3. Config is stored as JSON — no DB schema change needed

---

## Useful Commands

```bash
# Run a manual paper scan (Bond Hunter)
export POLYAGENT_DB=./data/polyagent.db
python3 agent.py --mode paper --force

# Run a manual scan for a specific strategy
python3 agent.py --mode paper --force --strategy bond_hunter

# Run backtest
python3 agent.py --mode backtest --days 60 --capital 500

# Start IFNL-Lite continuous runner
python3 -m strategies.ifnl_lite.ifnl_runner --db data/polyagent.db

# Run wallet profiler
python3 -m strategies.ifnl_lite.wallet_profiler --db data/polyagent.db

# Check API
curl http://localhost:8765/strategies | python3 -m json.tool

# Check logs
tail -f logs/agent.log
tail -f logs/ifnl_lite.log

# Restart everything
bash stop.sh && bash start.sh
```
