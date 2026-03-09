# PolyAgent

Sistema de paper trading automatizado sobre mercados de predicción de Polymarket con arquitectura multi-estrategia.

---

## Estrategias

### Bond Hunter (cron)
Compra tokens YES en mercados binarios que cotizan entre 0.95–0.995 (eventos casi seguros), espera resolución (~48h) y cobra $1.00 por token. Ejecuta un scan cada 15 minutos vía cron.

### IFNL-Lite (continuous)
Detecta divergencia entre el flujo de trading informado y el movimiento de precio usando datos en tiempo real de WebSocket + perfilado de wallets offline. Posiciones de 5–20 minutos. Proceso persistente en background.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                          OpenClaw Server                             │
│                                                                      │
│   cron (*/15 * * * *)                                                │
│       └─> python agent.py --mode paper                               │
│               ├─> Resuelve señales anteriores pendientes             │
│               ├─> Escanea mercados abiertos en Polymarket            │
│               ├─> Detecta señales Bond Hunter                        │
│               └─> Escribe en polyagent.db (SQLite)                   │
│                            │                                         │
│   ifnl_runner.py (proceso persistente, solo si enabled)              │
│       ├─> WebSocket: book/trades en tiempo real                      │
│       ├─> REST poller: trades con wallet IDs (~15s)                  │
│       ├─> Signal engine: divergencia IFS vs precio                   │
│       └─> Execution: paper positions con TP/SL/time stops            │
│                            │                                         │
│   uvicorn api:app :8765    │                                         │
│       ├─> Lee polyagent.db ┘                                         │
│       ├─> Expone REST API                                            │
│       ├─> Controla Bond Hunter (enable/disable/scan-now)             │
│       └─> Controla IFNL-Lite (enable → spawn, disable → kill)       │
│                                                                      │
│   next start :3000                                                   │
│       ├─> Proxy /api/* → localhost:8765                               │
│       ├─> Dashboard con tabs por estrategia                          │
│       └─> Start/Stop para cada estrategia independiente              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# Arrancar todo
bash start.sh

# Parar todo
bash stop.sh
```

### `start.sh` ejecuta 6 pasos:

1. Instala dependencias Python (`requirements.txt`)
2. Inicializa la BD (crea tablas + migraciones)
3. Arranca API FastAPI en puerto 8765
4. Build + arranque de Next.js frontend en puerto 3000
5. Configura cron job para Bond Hunter (cada 15 min)
6. Auto-arranca IFNL-Lite runner si `enabled=1` en la BD

### Login

```
http://TU_IP:3000
Email: admin@polyagent.io
Password: admin
```

---

## Estructura del Proyecto

```
polyagent/
├── agent.py              # Core trading engine (strategy dispatch, DB init)
├── api.py                # FastAPI REST server (port 8765)
├── backtest.py           # Backtest runner histórico
├── migrations.sql        # TODAS las migraciones de BD (para OpenClaw)
├── requirements.txt      # Deps: fastapi, uvicorn, requests, websockets, aiohttp
├── start.sh              # Arranque completo (6 pasos)
├── stop.sh               # Parada de todos los procesos + cron
├── strategies/
│   ├── __init__.py       # Strategy registry (STRATEGY_REGISTRY)
│   ├── base.py           # BaseStrategy ABC
│   ├── bond_hunter.py    # Bond Hunter (cron, cada 15 min)
│   └── ifnl_lite/
│       ├── __init__.py       # IfnlLiteStrategy class
│       ├── ifnl_runner.py    # Async runner (main loop)
│       ├── ws_client.py      # WebSocket (book/trades real-time)
│       ├── data_api.py       # REST poller (wallet-attributed trades)
│       ├── market_selector.py # Filtro de mercados elegibles
│       ├── microstructure.py  # Book imbalance, absorption, trade flow
│       ├── signal_engine.py   # IFS computation, divergencia
│       ├── execution.py       # Paper positions + exit rules
│       └── wallet_profiler.py # Scoring offline de wallets (diario)
├── data/                 # Datos persistentes (gitignored, volumen Docker)
│   └── polyagent.db
├── logs/                 # Logs de runtime (gitignored)
│   ├── api.log
│   ├── frontend.log
│   ├── agent.log
│   ├── ifnl_lite.log
│   ├── ifnl_lite.pid
│   └── ifnl_lite_status.json   # Métricas live del runner (cada 10s)
└── frontend/
    ├── next.config.mjs   # Proxy /api/* → localhost:8765
    └── src/
        ├── app/          # Pages (Next.js app router)
        ├── components/   # React components
        ├── hooks/        # SWR hooks
        ├── lib/          # api.ts, auth.ts, format.ts
        └── types/        # TypeScript interfaces
```

---

## Base de Datos

### Ubicación

| Entorno | Path | Configurado por |
|---------|------|-----------------|
| Docker/OpenClaw | `/app/data/polyagent.db` | Default (volumen montado) |
| Local | `./data/polyagent.db` | `start.sh` exporta `POLYAGENT_DB` |

### Migraciones

**IMPORTANTE:** Todos los cambios de esquema están en `migrations.sql`. Este fichero es idempotente (seguro ejecutar múltiples veces).

```bash
# Inicializar tablas base
python3 agent.py --mode paper --force

# Aplicar migraciones (strategies, IFNL tables, seed data)
sqlite3 data/polyagent.db < migrations.sql
```

`start.sh` ejecuta ambos comandos automáticamente. Para OpenClaw, asegurarse de que `migrations.sql` se ejecuta después de `init_db()`.

### Tablas

| Tabla | Descripción |
|-------|-------------|
| `config` | Parámetros Bond Hunter (singleton, id=1) |
| `bot_status` | Estado del bot Bond Hunter (singleton, id=1) |
| `signals` | Señales paper trading de Bond Hunter |
| `scan_log` | Historial de scans de Bond Hunter |
| `strategies` | **Registry de estrategias** (slug, type, enabled, config_json) |
| `ifnl_signals` | Señales paper trading de IFNL-Lite |
| `ifnl_wallet_profiles` | Scores pre-computados de wallets |
| `ifnl_wallet_trades` | Datos raw de trades para profiling |
| `runs` / `trades` | Resultados de backtest |

---

## API Endpoints

### Multi-Strategy (nuevos)

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/strategies` | Lista todas las estrategias |
| GET | `/strategies/{slug}` | Detalle de estrategia + config con defaults |
| POST | `/strategies/{slug}/config` | Actualizar config de estrategia |
| POST | `/strategies/{slug}/enable` | Activar estrategia (lanza runner si continuous) |
| POST | `/strategies/{slug}/disable` | Desactivar (para runner si continuous) |
| POST | `/strategies/{slug}/scan-now` | Scan inmediato (solo cron strategies) |
| GET | `/strategies/{slug}/signals` | Señales de la estrategia |
| GET | `/strategies/{slug}/signals/open` | Señales abiertas |
| GET | `/strategies/{slug}/stats` | Stats específicos |
| GET | `/strategies/{slug}/activity` | Métricas live del engine (lee status file) |

### Legacy Bond Hunter

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/config` | Config Bond Hunter |
| POST | `/config` | Update config |
| GET | `/bot` | Estado del bot |
| POST | `/bot/enable` / `/bot/disable` | Control del bot |
| POST | `/bot/scan-now` | Scan inmediato |
| GET | `/signals` | Señales (params: status, limit, offset) |
| GET | `/stats` | KPIs agregados |

---

## Gestión de Procesos

### Bond Hunter (cron)

- **Tipo:** cron (cada 15 min)
- **Mecanismo:** `crontab` ejecuta `python3 agent.py --mode paper`
- **Control:** Enable/disable desde dashboard o API. El cron siempre corre pero respeta el flag `enabled` en `bot_status`
- **Sin estado en memoria** — cada ejecución es independiente

### IFNL-Lite (continuous)

- **Tipo:** proceso persistente en background
- **Mecanismo:** `python3 -m strategies.ifnl_lite.ifnl_runner --db <path>`
- **Start:** `POST /strategies/ifnl_lite/enable` → API spawns subprocess
- **Stop:** `POST /strategies/ifnl_lite/disable` → API envía SIGTERM
- **PID:** Guardado en `logs/ifnl_lite.pid` por la API
- **Auto-start en boot:** `start.sh` paso 6 comprueba `enabled=1` en BD y lanza el runner
- **Stop en shutdown:** `stop.sh` mata el runner vía PID file + `pkill -f ifnl_runner`

### Flujo en OpenClaw (restart del container)

Cuando el container se reinicia:

1. `start.sh` ejecuta como entrypoint
2. Paso 2: BD ya existe en el volumen montado (`./data:/app/data`) — solo aplica migraciones nuevas
3. Paso 6: Detecta si IFNL-Lite tiene `enabled=1` en BD y auto-lanza el runner
4. **No requiere acción del usuario** — el runner se reanuda automáticamente

Cuando el usuario pulsa "Start Strategy" en el dashboard:

1. Frontend llama `POST /strategies/ifnl_lite/enable`
2. API pone `enabled=1` en BD y spawn subprocess `ifnl_runner`
3. Runner conecta al WebSocket de Polymarket, selecciona mercados, empieza a monitorizar
4. PID guardado en `logs/ifnl_lite.pid`
5. Si el container reinicia después, paso 6 de `start.sh` ve `enabled=1` y re-lanza

---

## Config Defaults de Estrategias

Los configs se guardan como JSON en `strategies.config_json`. La API los devuelve con defaults del código Python:

```python
defaults = strategy_instance.default_config()  # definidos en Python
stored = json.loads(row["config_json"])          # guardados en BD
config = {**defaults, **stored}                  # stored overrides defaults
```

Esto significa:
- Una estrategia nueva con `config_json='{}'` devuelve todos los defaults
- El usuario solo guarda valores que quiere cambiar
- Los defaults viven en el código Python, **no en la BD** — no se necesita migración para cambiar defaults

---

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `POLYAGENT_DB` | `/app/data/polyagent.db` | Path de la BD SQLite |
| `POLYAGENT_DATA_DIR` | `./data` | Directorio de datos |
| `API_URL` | `http://localhost:8765` | URL del backend para proxy Next.js |

---

## Estrategia Bond Hunter — Detalle

### Concepto

Compra tokens YES en mercados donde el precio es > 0.95 (> 95% probabilidad). Cuando el mercado resuelve YES (como se espera), cobra $1.00 por token. Ganancia típica: 1.5%–5% en 1–48 horas.

### Filtros

1. **Binario** — solo mercados YES/NO
2. **Rango de precio** — 0.95 ≤ precio ≤ 0.995
3. **Tiempo al cierre** — entre 1h y 48h
4. **Liquidez** — mínimo $500
5. **Anti-wash trading** — descarta volumen artificial
6. **Profit neto** — beneficio tras fees > 1.5%

### Position Sizing (Kelly fraccionado)

```
position = min(kelly_f * capital * kelly_fraction, capital * max_position_pct)
```

Con `kelly_fraction=0.25` y `max_position_pct=0.15`, nunca más del 15% del capital por señal.

---

## Estrategia IFNL-Lite — Detalle

### Concepto

Detecta cuando wallets "informados" (con historial de trading rentable) compran en una dirección pero el precio no se mueve. Esta divergencia entre flujo informado y precio sugiere que el precio va a corregirse.

### Componentes

1. **WebSocket Client** — Recibe book updates y trades en tiempo real de Polymarket
2. **Data API Poller** — Cada ~15s consulta trades recientes con `proxyWallet` para identificar wallets
3. **Market Selector** — Cada 5 min selecciona los top 10 mercados por volumen × liquidez
4. **Microstructure Engine** — Calcula book_imbalance, trade_imbalance, absorption, mid_drift
5. **Signal Engine** — Computa IFS (Informed Flow Score), detecta divergencia, genera señales
6. **Execution Manager** — Paper positions con TP (80% expected move), SL (22 bps), time stop (20 min)
7. **Wallet Profiler** — Offline (diario): computa markout P&L a 5m/30m/2h para cada wallet

### Señal: Condiciones

```
divergence > 18 bps
AND book_imbalance confirma dirección (> 0.15)
AND absorption es alta (liquidity pasiva absorbe flujo informado)
AND al menos 2 wallets informados activos (informed_score >= 0.65)
```

### Exit Rules

- **Take Profit:** mid moved ≥ 80% of expected_move
- **Hard Stop:** mid moved contra > 22 bps
- **Time Stop:** > 20 min holding (o < 6 bps progress después de 5 min)
- **Invalidation:** book flip o flow decay (sin trades informados 90s)
- **Cooldown:** 10 min per market tras stop/invalidation

---

## Monitorización en Tiempo Real

### Engine Activity Panel

Cuando IFNL-Lite está activo, el dashboard muestra un panel **Engine Activity** con métricas live:

- **Process:** Running / Offline
- **Uptime:** tiempo desde arranque
- **WebSocket:** estado de conexión
- **Markets:** número de mercados monitorizados + nombres
- **Book States:** estados de libro de órdenes activos
- **Trades Captured:** trades procesados desde el data poller
- **Wallets Seen:** wallets únicos identificados
- **Flow Entries:** entradas en el acumulador de flujo
- **Signals Generated:** señales producidas

### Cómo funciona

1. El runner escribe `logs/ifnl_lite_status.json` cada 10 segundos con todas las métricas
2. La API lee ese fichero en `GET /strategies/ifnl_lite/activity`
3. Si el fichero tiene >60s sin actualizarse, la API marca `possibly_stale: true`
4. El frontend (`IfnlActivityPanel`) poll cada 10s vía SWR y muestra indicador "● LIVE" (verde) o "○ OFFLINE" (gris)

### Verificar que IFNL funciona

```bash
# Verificar que el runner está corriendo
cat logs/ifnl_lite.pid && ps -p $(cat logs/ifnl_lite.pid)

# Ver métricas live
cat logs/ifnl_lite_status.json | python3 -m json.tool

# Ver logs del runner
tail -f logs/ifnl_lite.log

# Verificar desde la API
curl http://localhost:8765/strategies/ifnl_lite/activity | python3 -m json.tool
```

---

## Comandos Útiles

```bash
# Scan manual Bond Hunter
export POLYAGENT_DB=./data/polyagent.db
python3 agent.py --mode paper --force

# Backtest
python3 agent.py --mode backtest --days 60 --capital 500

# IFNL runner manual
python3 -m strategies.ifnl_lite.ifnl_runner --db data/polyagent.db

# Wallet profiler (diario)
python3 -m strategies.ifnl_lite.wallet_profiler --db data/polyagent.db

# Check API
curl http://localhost:8765/strategies | python3 -m json.tool

# Logs
tail -f logs/api.log
tail -f logs/agent.log
tail -f logs/ifnl_lite.log
```

---

## Notas para OpenClaw

1. **Ejecutar `bash start.sh`** una vez — inicializa todo automáticamente
2. **`migrations.sql`** contiene TODOS los cambios de esquema. Si la BD ya existe, `start.sh` aplica migraciones. Si se necesita aplicar manualmente: `sqlite3 data/polyagent.db < migrations.sql`
3. **La BD persiste** en el volumen montado `./data:/app/data` — sobrevive rebuilds del container
4. **Bond Hunter** se gestiona solo vía cron — no necesita intervención
5. **IFNL-Lite** se auto-arranca si estaba enabled antes del restart — paso 6 de `start.sh` lo detecta
6. **Control desde la UI** — Start/Stop de cada estrategia desde el dashboard
7. **Dependencias nuevas:** `websockets` y `aiohttp` (en `requirements.txt`) son necesarias para IFNL-Lite
8. **No hay auth en la API** — CORS abierto, credenciales hardcodeadas en el frontend
