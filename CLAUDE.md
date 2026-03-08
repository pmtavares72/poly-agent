# PolyAgent — Architecture & Developer Guide

## Overview

PolyAgent is a Polymarket prediction market trading bot built on the **Bond Hunter** strategy: buy YES tokens in binary markets trading at 0.95–0.995 (near-certain outcomes), hold until resolution (~48h), exit at 1.0 for small but consistent returns. Runs in paper trading mode with real market data but no real capital.

**Stack:**
- Backend: Python 3 — FastAPI + SQLite
- Frontend: TypeScript/React — Next.js 14 + SWR + Recharts
- Deployment: Bash + cron (OpenClaw Docker)
- External APIs: Polymarket Gamma API + CLOB Prices API

---

## Project Structure

```
polyagent/
├── agent.py              # Core trading engine (strategy, DB, paper + backtest)
├── api.py                # FastAPI REST server (port 8765)
├── backtest.py           # Standalone historical backtest runner
├── requirements.txt      # Python deps: fastapi, uvicorn, requests, rich, pydantic
├── start.sh              # Full orchestration: deps → DB init → API → Frontend → cron
├── stop.sh               # Kill API + frontend + remove cron
├── CLAUDE.md             # This file
├── data/                 # Persistent data (gitignored) — DB lives here locally
│   └── polyagent.db      # SQLite database (paper trading)
├── logs/                 # Runtime logs (gitignored)
│   ├── api.log
│   ├── frontend.log
│   └── agent.log
└── frontend/
    ├── next.config.mjs   # Next.js config — proxy /api/* → localhost:8765
    ├── src/
    │   ├── app/          # Pages (app router)
    │   ├── components/   # React components
    │   ├── hooks/        # SWR data-fetching hooks
    │   ├── lib/          # api.ts, auth.ts, format.ts
    │   └── types/        # TypeScript interfaces
    └── ...
```

---

## Database

### Location & Persistence

The DB path is controlled by the `POLYAGENT_DB` environment variable:

| Environment | Path | Set by |
|-------------|------|--------|
| Docker/OpenClaw | `/app/data/polyagent.db` | Default (env var not set) |
| Local (start.sh) | `$SCRIPT_DIR/data/polyagent.db` | `start.sh` exports `POLYAGENT_DB` |
| Custom | Any path | `export POLYAGENT_DB=/my/path/db` |

**In OpenClaw**, `docker-compose.yml` mounts `./data:/app/data` as a persistent volume. The DB survives container rebuilds because it lives in that volume, not in the container image.

**In agent.py:**
```python
DB_PATH = os.environ.get("POLYAGENT_DB", "/app/data/polyagent.db")

def init_db(db_path: str = DB_PATH) -> sqlite3.Connection:
```

**In api.py:**
```python
DB_PATH = os.environ.get("POLYAGENT_DB", "/app/data/polyagent.db")
```

### Schema

#### `config` (singleton, id=1)
All bot strategy parameters, editable via API and frontend Settings.

```sql
id                       INTEGER PRIMARY KEY DEFAULT 1
initial_capital          REAL    DEFAULT 500.0
min_probability          REAL    DEFAULT 0.95
max_probability          REAL    DEFAULT 0.995
min_profit_net           REAL    DEFAULT 0.015   -- 1.5% min net profit
max_hours_to_close       REAL    DEFAULT 48.0
min_liquidity_usdc       REAL    DEFAULT 500.0
kelly_fraction           REAL    DEFAULT 0.25
max_position_pct         REAL    DEFAULT 0.15    -- max 15% capital per trade
max_capital_deployed_pct REAL    DEFAULT 0.50    -- max 50% total deployed
fee_rate                 REAL    DEFAULT 0.005
scan_interval_min        INTEGER DEFAULT 15
updated_at               TEXT
```

#### `bot_status` (singleton, id=1)
```sql
id              INTEGER PRIMARY KEY DEFAULT 1
enabled         INTEGER DEFAULT 0    -- 0=stopped, 1=active
pid             INTEGER              -- PID of running scan process
last_scan_at    TEXT
next_scan_at    TEXT
last_error      TEXT
scan_count      INTEGER DEFAULT 0
```

#### `signals` (paper trading, one row per detected opportunity)
```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
detected_at     TEXT NOT NULL
token_id        TEXT NOT NULL        -- Polymarket CLOB token ID
question        TEXT
market_url      TEXT
closes_at       TEXT
hours_to_close  REAL
entry_price     REAL                 -- current price when detected
ask_price       REAL                 -- entry + spread/2
spread_entry_pct REAL
net_profit_pct  REAL                 -- (1 - ask) - fee_rate
position_usdc   REAL                 -- capital allocated (Kelly-sized)
shares          REAL                 -- tokens = position / ask
protocol_fee    REAL
breakeven_price REAL                 -- ask + fee_rate
liquidity       REAL
volume_24h      REAL
wash_score      TEXT
outcome         TEXT                 -- NULL (open) | 'YES' | 'NO'
resolved_at     TEXT
pnl_usdc        REAL
pnl_pct         REAL
status          TEXT DEFAULT 'open'  -- open | resolved | expired
```

#### `scan_log` (one row per cron execution)
```sql
id               INTEGER PRIMARY KEY AUTOINCREMENT
started_at       TEXT NOT NULL
finished_at      TEXT
duration_sec     REAL
markets_fetched  INTEGER DEFAULT 0
markets_checked  INTEGER DEFAULT 0   -- passed passes_basic_filters()
signals_found    INTEGER DEFAULT 0   -- new signals inserted
signals_resolved INTEGER DEFAULT 0
skipped_wash     INTEGER DEFAULT 0
skipped_spread   INTEGER DEFAULT 0
skipped_no_data  INTEGER DEFAULT 0
skipped_price    INTEGER DEFAULT 0
error            TEXT
mode             TEXT DEFAULT 'paper'
```

#### `runs` + `trades` (backtest only)
Separate tables for historical backtest results. `trades` rows have `run_id` FK to `runs`. Not used by paper trading.

### DB Migrations

`init_db()` runs `ALTER TABLE ... ADD COLUMN` for new columns after table creation. This lets the DB survive deploys without losing data:

```python
migrations = [
    ("config", "max_capital_deployed_pct", "REAL DEFAULT 0.50"),
]
for table, column, definition in migrations:
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError:
        pass  # column already exists
```

**Rule:** every new DB column must be added here too.

---

## Backend: agent.py

### Key Constants
```python
GAMMA_API    = "https://gamma-api.polymarket.com/markets"
CLOB_PRICES  = "https://clob.polymarket.com/prices-history"
SLEEP_BETWEEN_REQUESTS = 0.1  # rate limiting
```

### Core Functions

#### `passes_basic_filters(m, min_liquidity, require_resolved=True)`
- Checks: binary market (2 outcomes), volume ≥ 1000, liquidity ≥ min_liquidity, has CLOB token IDs
- `require_resolved=True` (backtest): `outcomePrices` must be `[1.0, 0.0]` or `[0.0, 1.0]`
- `require_resolved=False` (paper): accepts any valid price (e.g. `["0.87", "0.13"]`)
- Returns: `(ok: bool, token_id_yes: str, outcome_winner: str|None)`

> **Critical bug fixed**: paper trading was using `require_resolved=True`, rejecting ALL open markets
> as "disputed_resolution". Now paper passes `require_resolved=False`.

#### `compute_wash_score(m)` → `(is_wash: bool, reason: str)`
Detects suspicious volume patterns:
- `vol_24h / vol_total > 0.85` (and market > 24h old)
- `vol_24h > 1000` AND few traders
- `vol_24h > liquidity * 50`

#### `kelly_size(capital, entry_price, ask_price, kelly_fraction, max_pct)`
```python
b = (1.0 - ask_price) / ask_price   # odds ratio
kelly_f = max(0, (b * p - q) / b)   # raw Kelly
position = capital * kelly_fraction * kelly_f
position = min(position, capital * max_pct)
position = max(position, 5.0)        # minimum $5
```

#### `estimate_spread(liquidity)` → spread fraction
- liq > 5000 → 0.5% · liq > 1000 → 1.0% · else → 2.0%

#### `resolve_pending_signals(conn)` → int (count resolved)
For each `open` signal past `closes_at`, queries Gamma API for final outcome, calculates PnL, updates status.

### Paper Trading Flow (`run_paper`)

```
1. resolve_pending_signals()           — close expired positions
2. Query open capital:
   committed = SUM(position_usdc) WHERE status='open'
   available = (capital * max_capital_deployed_pct) - committed
   → if available < $5, skip scan entirely
3. fetch_open_markets(min_liquidity)
4. For each market:
   a. passes_basic_filters(..., require_resolved=False)
   b. compute_wash_score()
   c. Check closes_at within max_hours
   d. fetch_price_series() — last 10 min CLOB prices
   e. current_price in [min_prob, max_prob]?
   f. Signal exists for token_id? → skip
   g. available_capital < $5? → break
   h. estimate_spread() → ask_price
   i. net_profit_pct >= min_profit_net?
   j. kelly_size(available_capital, ...)  → deduct from available
   k. INSERT INTO signals
5. UPDATE scan_log (all counters + duration)
6. UPDATE bot_status (last_scan_at, scan_count)
```

### CLI Arguments
```
--mode {backtest|paper}   (default: backtest)
--force                   bypass bot enabled check
--capital FLOAT
--days INT
--min-prob FLOAT
--max-prob FLOAT
--min-profit FLOAT
--max-hours FLOAT
--min-liq FLOAT
--fee-rate FLOAT
```

---

## Backend: api.py

FastAPI on port 8765. CORS: `allow_origins=["*"]`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | DB path + timestamp |
| GET | `/config` | Current strategy config |
| POST | `/config` | Update config fields (partial update) |
| GET | `/bot` | Bot status + pid_alive |
| POST | `/bot/enable` | Enable bot |
| POST | `/bot/disable` | Disable bot |
| POST | `/bot/scan-now` | Trigger immediate scan (subprocess) |
| GET | `/signals` | All signals (params: status, limit, offset) |
| GET | `/signals/open` | Open signals only |
| GET | `/signals/resolved` | Resolved signals only |
| GET | `/signals/{id}` | Single signal |
| GET | `/stats` | Aggregated PnL, win rate, chart series |
| GET | `/scan-logs` | Scan execution history (param: limit) |
| GET | `/runs` | Backtest run list |
| GET | `/runs/{id}` | Single run |
| GET | `/runs/{id}/trades` | Trades for a run |

### `pid_alive` detection
Uses `ps -o stat= -p {pid}` and checks for `Z` (zombie). `os.kill(pid, 0)` alone was insufficient — zombie processes don't raise an error but are dead.

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

```typescript
// lib/api.ts
const BASE = '/api'   // relative — works on any device/IP
```

**Why this matters:** `NEXT_PUBLIC_API_URL=http://localhost:8765` compiled into JS means mobile browsers call their own localhost (the phone), not the server. The proxy runs server-side, so mobile/Safari never touch port 8765 directly.

### Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | page.tsx | Redirect to `/login` |
| `/login` | login/page.tsx | Hardcoded: `admin@polyagent.io` / `admin` |
| `/dashboard` | dashboard/page.tsx | KPIs, PnL chart, signals, bot control |
| `/strategies` | strategies/page.tsx | Bond Hunter config card |
| `/logs` | logs/page.tsx | Scan execution history |

### Key Components

- **`BotControl`** — Start/stop bot, Scan Now button. `disabled={actionLoading}` only (not `scanning` — was a bug)
- **`KpiGrid`** / **`KpiCard`** — 4 KPI cards (Capital, PnL, Win Rate, Active Signals)
- **`PnlChart`** — Recharts area chart, cumulative PnL
- **`BondHunterCard`** — Editable strategy params grid, Save button
- **`AppShell`** — Layout wrapper: auth check, sidebar, topbar
- **`Sidebar`** — Nav: Dashboard, Strategies, Logs
- **`TickerTape`** — Quick stats banner

### Hooks (all SWR-based)

```typescript
useStats()          // 30s refresh → /stats
useSignals(params)  // 30s refresh → /signals
useOpenSignals()    // 30s refresh → /signals/open
useBot()            // 5s refresh  → /bot
useConfig()         // → /config + saveConfig()
useAuth()           // localStorage auth check
```

### Auth
Hardcoded in `lib/auth.ts`: `admin@polyagent.io` / `admin`. State stored in localStorage under `polyagent_auth`. No backend auth — API is open.

### Typography
- `var(--mono)` → DM Mono (data, labels, numbers, technical text)
- `var(--sans)` → Syne (headings, buttons)
- Logs page: all `var(--mono)` (Syne bold was too aggressive for dense data)

---

## Deployment

### start.sh flow
1. Install Python deps (`pip install -r requirements.txt`)
2. Init DB: `python3 agent.py --mode paper --force`
3. Start API: `uvicorn api:app --host 0.0.0.0 --port 8765` (background)
4. Detect server IP (for display only, not for API config)
5. `npm install && npm run build && npm start --port 3000` (background)
6. Add cron: `*/15 * * * * python3 agent.py --mode paper`

### Environment variables

```bash
POLYAGENT_DB=/app/data/polyagent.db    # DB path — set by OpenClaw Docker
POLYAGENT_DATA_DIR=/data               # Data dir — start.sh uses this to set POLYAGENT_DB
API_URL=http://localhost:8765          # Backend URL for Next.js proxy (optional)
```

### OpenClaw Docker notes
- `./data:/app/data` volume → DB survives rebuilds
- `POLYAGENT_DB` not set → agent.py + api.py default to `/app/data/polyagent.db`
- `start.sh` is the entrypoint — runs all services + cron

---

## Known Bugs Fixed

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Scan Now disabled after first click | `pid_alive` returned true for zombie process | Detect zombie via `ps -o stat=` checking for `Z` |
| No data on mobile / Safari | `NEXT_PUBLIC_API_URL=localhost` compiled into JS bundle | Next.js proxy: all calls via `/api/*` rewrite |
| Paper trading finds 0 signals | `passes_basic_filters` required `outcomePrices=[1,0]` — valid only for resolved markets | Added `require_resolved=False` for paper mode |
| Settings → wrong page | `href: '/dashboard'` hardcoded | Fixed to `/strategies` |
| `frontend/src/app/logs/` gitignored | `.gitignore` had `logs/` (matches any subdir) | Changed to `/logs/` (root only) |
| DB reset on Docker rebuild | DB stored in `/app/` (container layer) | Moved to `/app/data/` (mounted volume) |

---

## Adding a New Config Parameter

1. **`agent.py`** — Add column to `CREATE TABLE config` schema + add migration in `init_db()`:
   ```python
   migrations = [
       ...,
       ("config", "new_param", "REAL DEFAULT 0.5"),
   ]
   ```
2. **`agent.py`** — Read it in `load_config_from_db()`:
   ```python
   "new_param": cfg.get("new_param", 0.5),
   ```
3. **`api.py`** — Add to `ConfigUpdate` model:
   ```python
   new_param: Optional[float] = None
   ```
4. **`frontend/src/types/index.ts`** — Add to `BotConfig` interface
5. **`frontend/src/components/strategies/BondHunterCard.tsx`** — Add to `PARAM_META` array

---

## Useful Commands

```bash
# Run a manual paper scan (local)
export POLYAGENT_DB=./data/polyagent.db
python3 agent.py --mode paper --force

# Run backtest
python3 agent.py --mode backtest --days 60 --capital 500

# Check API
curl http://localhost:8765/stats | python3 -m json.tool

# Check logs
tail -f logs/agent.log
tail -f logs/api.log

# Restart everything
bash stop.sh && bash start.sh
```
