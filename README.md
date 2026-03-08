# PolyAgent

Sistema de paper trading automatizado sobre mercados de predicción de Polymarket.

Detecta mercados donde el token YES cotiza entre 0.95–0.995 con menos de 48h hasta el cierre (estrategia "Bond Hunter"), registra señales en SQLite, resuelve los resultados cuando el mercado cierra y expone todo vía API REST para una app Next.js de monitorización en tiempo real.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Server                          │
│                                                                 │
│   cron (*/15 * * * *)                                           │
│       └─> python agent.py --mode paper                          │
│               │                                                 │
│               ├─> Resuelve señales anteriores pendientes        │
│               ├─> Escanea mercados abiertos en Polymarket       │
│               ├─> Detecta señales Bond Hunter                   │
│               └─> Escribe en polyagent.db (SQLite)              │
│                            │                                    │
│   uvicorn api:app :8765    │                                    │
│       └─> Lee polyagent.db ┘                                    │
│       └─> Expone REST API                                       │
│       └─> Controla el bot (enable/disable/scan-now)             │
│                                                                 │
│   next start :3000                                              │
│       └─> Consume http://localhost:8765                         │
│       └─> Dashboard en tiempo real (SWR, refresh 30s)          │
│       └─> Control del bot desde la UI                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Componentes

| Fichero / Carpeta | Qué es | Tecnología |
|---|---|---|
| `agent.py` | Runner del bot — one-shot, lo lanza el cron | Python |
| `api.py` | REST API que expone la BD y controla el bot | FastAPI + uvicorn |
| `polyagent.db` | Base de datos SQLite — señales, config, estado | SQLite |
| `frontend/` | App de monitorización | Next.js 14 + TypeScript |
| `start.sh` | Arranca todo: API + frontend + cron | Bash |
| `stop.sh` | Para todo y elimina el cron | Bash |
| `markets_cache.json` | Cache de mercados descargados (TTL 1h) | JSON |

### Flujo de datos

```
Polymarket API (pública, sin auth)
    ├─ gamma-api.polymarket.com/markets     → metadatos de mercados
    └─ clob.polymarket.com/prices-history   → precios históricos

agent.py (cada 15 min)
    ├─ Lee config de polyagent.db (tabla config)
    ├─ Verifica bot_status.enabled — si es 0, termina sin hacer nada
    ├─ resolve_pending_signals() — cierra señales expiradas
    ├─ fetch_open_markets() — descarga mercados activos de Polymarket
    ├─ Aplica filtros: binario, liquidez, anti-wash, probabilidad
    ├─ Si pasa filtros → INSERT en signals (status='open')
    └─ Actualiza bot_status (last_scan_at, scan_count, pid)

api.py (siempre corriendo)
    ├─ GET  /stats           → KPIs globales + estado del bot
    ├─ GET  /signals         → lista de señales (paginada)
    ├─ GET  /config          → configuración actual del bot
    ├─ POST /config          → guardar nueva configuración
    ├─ POST /bot/enable      → activa el bot (enabled=1)
    ├─ POST /bot/disable     → para el bot (enabled=0)
    └─ POST /bot/scan-now    → lanza agent.py en background ahora mismo

frontend (Next.js)
    ├─ /login      → autenticación local (admin@polyagent.io / admin)
    ├─ /dashboard  → KPIs, gráfico PnL, señales activas, tabla, BotControl
    └─ /strategies → configuración Bond Hunter (guarda en BD vía POST /config)
```

---

## Tablas SQLite

### `config` — configuración del bot (1 sola fila)

| Campo | Default | Descripción |
|---|---|---|
| `initial_capital` | 500.0 | Capital de referencia en USDC |
| `min_probability` | 0.95 | Precio mínimo YES para entrar |
| `max_probability` | 0.995 | Precio máximo YES (evita mercados ya resueltos) |
| `min_profit_net` | 0.015 | Beneficio neto mínimo tras fees (1.5%) |
| `max_hours_to_close` | 48.0 | Horas máximas hasta cierre del mercado |
| `min_liquidity_usdc` | 500.0 | Liquidez mínima del mercado en USDC |
| `kelly_fraction` | 0.25 | Fracción Kelly conservadora para sizing |
| `max_position_pct` | 0.15 | Máximo 15% del capital por señal |
| `fee_rate` | 0.005 | Fee estimado del protocolo (0.5%) |
| `scan_interval_min` | 15 | Intervalo del cron (informativo) |

### `bot_status` — estado en tiempo real (1 sola fila)

| Campo | Descripción |
|---|---|
| `enabled` | 0=parado, 1=activo |
| `pid` | PID del último proceso agent.py |
| `last_scan_at` | Timestamp del último scan |
| `scan_count` | Número total de scans ejecutados |
| `last_error` | Último error si hubo fallo |

### `signals` — señales paper trading

| Campo | Descripción |
|---|---|
| `status` | `open` / `resolved` / `expired` |
| `outcome` | `YES` / `NO` / NULL (pending) |
| `question` | Pregunta del mercado |
| `entry_price` | Precio YES en el momento de detección |
| `position_usdc` | Tamaño de la posición en USDC |
| `net_profit_pct` | Beneficio neto esperado % |
| `pnl_usdc` | PnL real tras resolución |
| `closes_at` | Fecha de cierre del mercado |

---

## Instalación en OpenClaw

### Requisitos

- Python 3.10+
- Node.js 18+
- npm
- Acceso a internet (Polymarket APIs son públicas, sin auth)

### Primer arranque

```bash
# 1. Clonar / subir el proyecto al servidor
cd /ruta/al/proyecto

# 2. Arrancar todo de una vez
bash start.sh
```

`start.sh` hace automáticamente:
1. Detecta `python3` o `python` automáticamente
2. Instala dependencias Python (`python3 -m pip install -r requirements.txt`)
3. Inicializa la BD SQLite (`polyagent.db`) con la configuración por defecto
4. Arranca la API FastAPI en puerto 8765
5. Hace el build de Next.js y lo arranca en puerto 3000
6. Configura el cron `*/15 * * * *` para el bot

### Acceder a la app

```
http://TU_IP_SERVIDOR:3000
```

Login: `admin@polyagent.io` / `admin`

### Parar todo

```bash
bash stop.sh
```

---

## Uso de la app

### Navegación de la app

| Sidebar | Página |
|---|---|
| Dashboard | KPIs, gráfico PnL, control del bot, señales activas, historial |
| Strategies | Parámetros editables del Bond Hunter |
| Signals | Sección de señales en el dashboard |
| Trade History | Historial en el dashboard |
| Settings | Alias de Strategies — misma página de configuración |

---

### 1. Configurar el bot (Strategies / Settings)

Antes de arrancar el bot, ve a **Strategies** (o **Settings**) y ajusta:

- **INITIAL_CAPITAL** — cuánto USDC quieres usar como referencia (no es dinero real, es paper trading)
- **MIN_PROBABILITY / MAX_PROBABILITY** — rango de precio YES para entrar (por defecto 0.95–0.995)
- **MAX_HOURS_TO_CLOSE** — solo mercados que cierran en menos de N horas (por defecto 48h)
- Resto de parámetros son más avanzados — los defaults son razonables para empezar

Pulsa **Save & Apply**. Los cambios se guardan en la BD y se aplican en el próximo scan.

### 2. Arrancar el bot (Dashboard page)

En el panel **Bond Hunter** del dashboard:

- **▶ Start Bot** — activa el bot (el cron podrá ejecutar scans)
- **▶ Scan Now** — lanza un scan inmediato sin esperar al cron
- **⏹ Stop Bot** — pausa el bot (el cron seguirá corriendo pero no hará nada)

El panel muestra en tiempo real:
- Estado: `ACTIVE` / `STOPPED` / `SCANNING`
- Último scan: hace cuánto fue
- Número total de scans ejecutados
- Último error (si hubo alguno)

### 3. Monitorizar (Dashboard page)

El dashboard se refresca automáticamente cada 30 segundos y muestra:

- **KPIs** — Capital total, PnL acumulado, Win Rate, Señales activas
- **Gráfico PnL** — evolución acumulada desde el inicio
- **Señales activas** — mercados con posición abierta, tiempo hasta cierre
- **Historial reciente** — todas las señales con resultado y PnL

---

## Estrategia Bond Hunter

### Concepto

Polymarket es un mercado de predicción donde puedes comprar tokens YES/NO sobre eventos futuros. Cuando el mercado resuelve, el token ganador vale exactamente $1.00 y el perdedor $0.00.

La estrategia Bond Hunter busca mercados donde:
- El token YES cotiza entre $0.95 y $0.995 (el mercado cree que hay >95% de probabilidad de YES)
- El mercado cierra en menos de 48 horas
- Hay liquidez suficiente

Si compras YES a $0.965 y el mercado resuelve YES (como se espera), cobras $1.00 → ganancia de $0.035 por token (~3.6%). Es como un bono a corto plazo de muy alta probabilidad.

### Filtros aplicados

1. **Binario** — solo mercados YES/NO
2. **Rango de precio** — 0.95 ≤ precio ≤ 0.995
3. **Tiempo al cierre** — entre 1h y 48h (evita entrar en la última hora)
4. **Liquidez** — mínimo $500 en el pool
5. **Anti-wash trading** — descarta mercados con volumen artificial
6. **Profit neto** — beneficio tras fees debe ser > 1.5%

### Sizing (Kelly fraccionado)

```
kelly_size = (prob_yes - (1 - prob_yes) / odds) * kelly_fraction
position = min(kelly_size * capital, max_position_pct * capital)
```

Con `kelly_fraction=0.25` y `max_position_pct=0.15`, nunca se arriesga más del 15% del capital en una sola señal.

### Limitaciones importantes

- Es **paper trading** — no ejecuta órdenes reales en Polymarket
- El spread real en el momento de entrada puede ser mayor al estimado
- No modela slippage ni impacto de mercado
- Los mercados de alta probabilidad tienen liquidez limitada en la práctica
- Un evento inesperado (black swan) puede hacer que un mercado "seguro" resuelva NO

---

## Configuración avanzada

### Cambiar el intervalo del cron

Por defecto el bot escanea cada 15 minutos. Para cambiarlo:

```bash
# Editar el cron manualmente
crontab -e

# Cambiar */15 por el intervalo deseado, por ejemplo cada 5 minutos:
# */5 * * * * cd /ruta && python agent.py --mode paper >> logs/agent.log 2>&1
```

### Ver logs en tiempo real

```bash
# Log del bot (cada vez que corre el cron)
tail -f logs/agent.log

# Log de la API
tail -f logs/api.log

# Log del frontend
tail -f logs/frontend.log
```

### Ejecutar el bot manualmente

```bash
# Scan normal (respeta el flag enabled)
python agent.py --mode paper

# Forzar scan aunque el bot esté parado
python agent.py --mode paper --force

# Backtest histórico (no afecta al paper trading)
python agent.py --mode backtest --days 30 --capital 500
```

### Cambiar credenciales de la app

Editar `frontend/src/lib/auth.ts`:

```typescript
// Línea con las credenciales hardcodeadas
if (email === 'admin@polyagent.io' && password === 'admin') {
```

Cambia el email y password por los que quieras. Luego reconstruir:

```bash
cd frontend && npm run build && npm start
```

### API disponible para integraciones externas

La API en `:8765` es pública (CORS abierto). Puedes consultarla desde cualquier sitio:

```bash
# Estado del sistema
curl http://TU_IP:8765/stats

# Señales abiertas
curl http://TU_IP:8765/signals/open

# Configuración actual
curl http://TU_IP:8765/config

# Activar el bot remotamente
curl -X POST http://TU_IP:8765/bot/enable

# Lanzar scan inmediato
curl -X POST http://TU_IP:8765/bot/scan-now

# Documentación interactiva
# Abrir en navegador: http://TU_IP:8765/docs
```

---

## Estructura de ficheros

```
polyagent/
├── agent.py              ← Runner del bot (one-shot, lo lanza el cron)
├── api.py                ← FastAPI REST API
├── requirements.txt      ← Dependencias Python
├── start.sh              ← Arranca todo (API + frontend + cron)
├── stop.sh               ← Para todo
├── mockup.html           ← Mockups del diseño (referencia visual)
├── polyagent.db          ← SQLite (se crea al primer arranque)
├── markets_cache.json    ← Cache de mercados (se crea automáticamente, TTL 1h)
├── logs/                 ← Logs de todos los procesos (se crea al arrancar)
│   ├── api.log
│   ├── frontend.log
│   └── agent.log
└── frontend/             ← App Next.js
    ├── package.json
    ├── .env.local        ← NEXT_PUBLIC_API_URL=http://localhost:8765
    └── src/
        ├── app/
        │   ├── login/        ← Pantalla de login
        │   ├── dashboard/    ← Dashboard principal
        │   └── strategies/   ← Configuración Bond Hunter
        ├── components/
        │   ├── layout/       ← AppShell, Sidebar, Topbar, TickerTape
        │   ├── dashboard/    ← KpiCard, PnlChart, BotControl, SignalCard, Table
        │   └── strategies/   ← BondHunterCard con parámetros editables
        ├── hooks/            ← useStats, useSignals, useConfig, useBot (SWR)
        ├── lib/              ← api.ts, auth.ts, format.ts
        └── types/            ← Interfaces TypeScript
```

---

## Notas para el agente OpenClaw

Si se configura como agente autónomo, OpenClaw solo necesita:

1. **Ejecutar `bash start.sh`** una vez para inicializar todo
2. **Monitorizar que los procesos siguen vivos** — si la API o el frontend caen, relanzarlos
3. **El cron se gestiona solo** — no hay que hacer nada más para que el bot escanee
4. **La UI controla el bot** — start/stop/scan-now se hacen desde el dashboard

El sistema está diseñado para ser completamente autónomo una vez arrancado. El cron ejecuta `agent.py` cada 15 minutos, que a su vez:
- Verifica si el bot está habilitado (flag en BD)
- Si está habilitado: resuelve señales antiguas + busca señales nuevas
- Si está parado: termina sin hacer nada (0 segundos de trabajo)

No hay estado en memoria — cada ejecución del cron es completamente independiente. Si el servidor se reinicia, basta con volver a ejecutar `bash start.sh`.
