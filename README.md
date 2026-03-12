# PolyAgent

Bot de trading automatizado para mercados de predicción de Polymarket. Arquitectura multi-estrategia con soporte para **paper trading** (simulado) y **live trading** (órdenes reales con dinero real).

---

## Tabla de Contenidos

1. [Overview](#overview)
2. [Estrategias](#estrategias)
3. [Quick Start (Paper Mode)](#quick-start-paper-mode)
4. [Configuración de Trading Real (LIVE)](#configuración-de-trading-real-live)
   - [Requisitos Previos](#requisitos-previos)
   - [Paso 1: Exportar tu Private Key de Polymarket](#paso-1-exportar-tu-private-key-de-polymarket)
   - [Paso 2: Encontrar tu Proxy Wallet (Funder Address)](#paso-2-encontrar-tu-proxy-wallet-funder-address)
   - [Paso 3: Determinar tu Signature Type](#paso-3-determinar-tu-signature-type)
   - [Paso 4: Configurar Variables de Entorno](#paso-4-configurar-variables-de-entorno)
   - [Paso 5: Aprobar Token Allowances (Solo MetaMask/EOA)](#paso-5-aprobar-token-allowances-solo-metamaskeoa)
   - [Paso 6: Generar API Credentials](#paso-6-generar-api-credentials)
   - [Paso 7: Verificar Configuración](#paso-7-verificar-configuración)
   - [Paso 8: Arrancar en Modo Live](#paso-8-arrancar-en-modo-live)
5. [Variables de Entorno — Referencia Completa](#variables-de-entorno--referencia-completa)
6. [Safety Rails (Protecciones)](#safety-rails-protecciones)
7. [Cómo Funciona el Trading Real (Bond Hunter)](#cómo-funciona-el-trading-real-bond-hunter)
8. [Arquitectura del Proyecto](#arquitectura-del-proyecto)
9. [Base de Datos](#base-de-datos)
10. [API Endpoints](#api-endpoints)
11. [Dashboard](#dashboard)
12. [Despliegue en OpenClaw](#despliegue-en-openclaw)
13. [Troubleshooting](#troubleshooting)
14. [Comandos Útiles](#comandos-útiles)
15. [Seguridad](#seguridad)

---

## Overview

| Característica | Paper Mode | Live Mode |
|---------------|-----------|-----------|
| Datos de mercado | Reales (Gamma API, CLOB, WebSocket) | Reales |
| Ejecución de órdenes | Fills simulados | Órdenes limit reales via `py-clob-client` |
| Capital en riesgo | $0 | Tu cantidad configurada |
| Dashboard | Stats completos | Stats completos + order IDs reales |
| Resolución de exits | Sintética (al resolver mercado) | Tokens se redimen automáticamente a $1.00 |

**El modo por defecto es `paper`.** Activa `live` desde el toggle en el dashboard o en el `.env`.

---

## Estrategias

### Bond Hunter (Recomendada para Live)

- **Tipo:** Cron (se ejecuta cada 15 minutos)
- **Lógica:** Compra tokens YES en mercados que cotizan entre $0.92–$0.995 (eventos casi seguros). Espera a que el mercado resuelva YES y cobra $1.00 por token.
- **Edge:** Retornos pequeños pero consistentes (2.5%–8% por trade) con win rate >95%.
- **Riesgo:** Se pierde toda la posición si el mercado resuelve NO. La protección viene de filtros estrictos de selección.
- **Capital asignado:** $500 (configurable)

### IFNL-Lite (Solo Paper por ahora)

- **Tipo:** Continuo (WebSocket + polling)
- **Lógica:** Detecta divergencia entre flujo de trading informado y precio. Posiciones de 5–20 minutos.
- **Estado:** Solo paper trading. La ejecución live requiere órdenes sub-segundo que añaden complejidad significativa.

---

## Quick Start (Paper Mode)

```bash
git clone <repo-url> polyagent
cd polyagent
bash start.sh
```

Esto arranca la API (puerto 8765), frontend (puerto 3000), y cron de Bond Hunter.

Abre `http://localhost:3000` → login con `admin@polyagent.io` / `admin`.

---

## Configuración de Trading Real (LIVE)

### Requisitos Previos

- **Python 3.9+** instalado
- **Node.js 18+** instalado
- **Cuenta de Polymarket con saldo USDC** (tu dinero real)
- **`py-clob-client`** (se instala automáticamente con `requirements.txt`)
- **Tokens POL** en tu wallet para gas fees (solo si usas MetaMask/EOA — ver Paso 5)

### Paso 1: Exportar tu Private Key de Polymarket

Tu private key es lo que firma las órdenes en tu nombre. **NUNCA la compartas con nadie.**

#### Si te logueas con EMAIL (Magic Link) — lo más común:

1. Ve a [polymarket.com](https://polymarket.com)
2. Click en tu **icono de perfil** (arriba a la derecha)
3. Click en **Settings**
4. Busca **"Export Private Key"** y haz click
5. Recibirás un email con un Magic Link — haz click para autenticarte
6. La página muestra una caja borrosa — click en **"Reveal Private Key"**
7. Copia el string hexadecimal de 64 caracteres (empieza con `0x`)
8. **Quita el prefijo `0x`** — solo necesitas los 64 caracteres hex

Ejemplo: si la key es `0xabcdef1234...`, guarda solo `abcdef1234...`

#### Si te logueas con MetaMask:

Tu private key es la de tu cuenta de MetaMask:

1. Abre MetaMask → click en los tres puntos → **Account Details**
2. Click en **"Export Private Key"**
3. Introduce tu contraseña de MetaMask
4. Copia la key (sin prefijo `0x`)

### Paso 2: Encontrar tu Proxy Wallet (Funder Address)

El **funder address** es tu proxy wallet de Polymarket — es donde están tus USDC y tus posiciones.

**Opción A — Automático (recomendado):** El sistema lo deriva automáticamente de tu private key usando CREATE2. Solo tienes que pegar tu private key en la página Settings del dashboard y el funder address aparece solo.

**Opción B — Manual:**
1. Ve a [polymarket.com](https://polymarket.com)
2. Click en tu **icono de perfil** (arriba a la derecha)
3. Ve a **Settings**
4. Tu **wallet address** está mostrada ahí — este es tu proxy/funder address
5. Tiene este formato: `0x1234567890abcdef1234567890abcdef12345678`

**Importante:** Esta NO es tu dirección de MetaMask (si usas MetaMask). Es un contrato proxy específico de Polymarket desplegado en Polygon. Cuando Polymarket muestra tu "Portfolio" y balance, está leyendo este proxy wallet.

### Paso 3: Determinar tu Signature Type

| Cómo te logueas en Polymarket | Signature Type | Valor |
|-------------------------------|---------------|-------|
| **Email / Google (Magic Link)** | POLY_PROXY | `1` |
| **MetaMask / hardware wallet** | EOA | `0` |
| **Gnosis Safe multisig** | GNOSIS_SAFE | `2` |

**La mayoría de usuarios se loguean con email → usa `1`.**

### Paso 4: Configurar Credenciales

**Opción A — Dashboard Settings (recomendado):**

1. Arranca el bot: `bash start.sh`
2. Abre `http://localhost:3000` → Login → ve a **Settings** (menú lateral)
3. Pega tu private key y selecciona tu tipo de wallet
4. Click **"Save & Derive"** → auto-genera funder address + API credentials
5. Click **"Test Connection"** para verificar

**Opción B — Variables de entorno (.env):**

```bash
cp .env.example .env
nano .env
```

```env
POLYAGENT_MODE=live
POLYMARKET_PRIVATE_KEY=abcdef1234...  # 64 hex chars, SIN 0x
POLYMARKET_FUNDER_ADDRESS=0x1234...   # Proxy wallet (o dejar vacío si usas Settings)
POLYMARKET_SIGNATURE_TYPE=1           # 1=email, 0=MetaMask, 2=Gnosis
POLYAGENT_LIVE_CAPITAL=500.00
```

**Opción C — OpenClaw Secrets** (ver sección Despliegue en OpenClaw más abajo).

El sistema lee credenciales en este orden: **Database (Settings page) → Environment variables (.env / secrets)**. Si configuras via Settings, no necesitas `.env` para las credenciales.

### Paso 5: Aprobar Token Allowances (Solo MetaMask/EOA)

> **Salta este paso si te logueas con email/Magic Link (signature_type=1).** Los allowances se configuran automáticamente para cuentas Magic Link.

Si usas MetaMask (signature_type=0), debes aprobar los contratos de exchange de Polymarket para que puedan mover tus USDC y conditional tokens. Esto requiere POL (gas token) en tu wallet.

```bash
# Instalar web3 (una sola vez)
pip install web3

# Ejecutar el script de allowances
python3 scripts/set_allowances.py
```

Esto aprueba tres contratos:

| Contrato | Dirección | Función |
|----------|-----------|---------|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` | Exchange principal |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` | Exchange para mercados neg-risk |
| Neg Risk Adapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` | Adaptador de riesgo negativo |

Para los tokens:

| Token | Dirección |
|-------|-----------|
| USDC (Polygon) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| Conditional Tokens (CTF) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |

**Solo necesitas hacer esto UNA VEZ por wallet.**

### Paso 6: Generar API Credentials

Las API credentials (key, secret, passphrase) autentican tus peticiones de trading al CLOB de Polymarket. Se derivan de tu private key.

```bash
# Generar y guardar credenciales
python3 scripts/generate_api_creds.py
```

O deja que el bot lo haga automáticamente — si `POLYMARKET_API_KEY` está vacío en `.env`, el bot llama a `create_or_derive_api_creds()` al arrancar y guarda el resultado.

**Lo que se genera:**

| Credencial | Descripción | Ejemplo |
|-----------|-------------|---------|
| `POLYMARKET_API_KEY` | Identificador único de API | `a1b2c3d4-e5f6-...` |
| `POLYMARKET_API_SECRET` | Secreto para firmar HMAC (base64) | `dGhpcyBpcyBh...` |
| `POLYMARKET_API_PASSPHRASE` | Factor adicional de autenticación | `some-passphrase` |

Estas credenciales se guardan en tu `.env`. Se pueden re-derivar en cualquier momento desde la misma private key (son determinísticas).

**Cómo funciona la autenticación:**

1. **L1 (firma con private key):** Prueba que controlas la wallet. Se usa para crear credenciales y firmar órdenes localmente.
2. **L2 (API key + secret + passphrase):** Autentica peticiones HTTP al CLOB usando HMAC-SHA256. Se usa para trading, cancelaciones, y consultas autenticadas.

Cada petición de trading envía estos headers:
```
POLY_ADDRESS      → tu dirección de wallet
POLY_SIGNATURE    → firma HMAC-SHA256 de la petición
POLY_TIMESTAMP    → timestamp UNIX actual
POLY_API_KEY      → tu apiKey
POLY_PASSPHRASE   → tu passphrase
```

El SDK `py-clob-client` maneja todo esto automáticamente.

### Paso 7: Verificar Configuración

Antes de ir live, ejecuta el script de verificación para comprobar todo:

```bash
python3 scripts/verify_config.py
```

Esto comprueba:

- [x] Private key es válida y puede firmar mensajes
- [x] Funder address coincide con el proxy wallet de la key
- [x] API credentials funcionan (petición de prueba autenticada)
- [x] Balance USDC en el proxy wallet (muestra fondos disponibles)
- [x] Token allowances están configurados (para wallets EOA)
- [x] Límites de capital son razonables (no exceden el balance de la wallet)

Output esperado:
```
✓ Private key loaded (64 chars)
✓ Funder address: 0x1234...5678
✓ Signature type: 1 (POLY_PROXY)
✓ API credentials valid
✓ Proxy wallet USDC balance: $578.27
✓ Live capital limit: $500.00 (69% of balance)
✓ Max single position: $100.00
✓ Daily loss limit: -$50.00
✓ All checks passed — ready for live trading
```

### Paso 8: Arrancar en Modo Live

```bash
# Arrancar todo (el modo se lee de .env)
bash start.sh
```

El bot va a:

1. Inicializar la base de datos
2. Conectar al CLOB API de Polymarket con tus credenciales
3. Arrancar el servidor API + frontend dashboard
4. Empezar a escanear oportunidades Bond Hunter cada 15 minutos
5. **Colocar órdenes limit reales (GTC)** cuando detecte señales
6. Monitorizar posiciones y registrar exits cuando los mercados resuelvan

Monitoriza desde el dashboard en `http://localhost:3000`.

---

## Variables de Entorno — Referencia Completa

### Obligatorias para Live Trading

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `POLYAGENT_MODE` | Modo de trading fallback: `paper` o `live` (el dashboard toggle tiene prioridad) | `live` |
| `POLYMARKET_PRIVATE_KEY` | Private key de wallet (64 hex chars, sin 0x) | `abcdef1234...` |
| `POLYMARKET_FUNDER_ADDRESS` | Proxy wallet address de polymarket.com/settings | `0x1234...5678` |
| `POLYMARKET_SIGNATURE_TYPE` | `0`=MetaMask, `1`=Email/Magic, `2`=Gnosis | `1` |

### Límites de Capital y Riesgo

| Variable | Descripción | Default |
|----------|-------------|---------|
| `POLYAGENT_LIVE_CAPITAL` | Capital máximo total que puede usar el bot (USDC) | `500.00` |
| `POLYAGENT_MAX_POSITION` | Tamaño máximo de una posición individual (USDC) | `100.00` |
| `POLYAGENT_MAX_DEPLOYED_PCT` | % máximo de capital desplegado a la vez (0.0-1.0) | `0.70` |
| `POLYAGENT_DAILY_LOSS_LIMIT` | Para de tradear si el P&L del día baja de esto | `-50.00` |

### Auto-Generadas (Override Opcional)

| Variable | Descripción |
|----------|-------------|
| `POLYMARKET_API_KEY` | CLOB API key (auto-derivada de la private key) |
| `POLYMARKET_API_SECRET` | CLOB API secret (base64) |
| `POLYMARKET_API_PASSPHRASE` | CLOB API passphrase |

### Infraestructura

| Variable | Descripción | Default |
|----------|-------------|---------|
| `POLYAGENT_DB` | Path de la base de datos SQLite | `./data/polyagent.db` |
| `POLYAGENT_DATA_DIR` | Directorio de datos | `./data` |
| `API_URL` | URL del backend para proxy de Next.js | `http://localhost:8765` |
| `POLYMARKET_CLOB_HOST` | Endpoint del CLOB API | `https://clob.polymarket.com` |
| `POLYMARKET_CHAIN_ID` | Chain ID de Polygon | `137` |
| `POLYGON_RPC_URL` | RPC de Polygon (solo para allowances) | `https://polygon-rpc.com` |

---

## Safety Rails (Protecciones)

El bot incluye múltiples mecanismos de seguridad para proteger tu capital:

### Límites de Capital

- **Cap total** (`POLYAGENT_LIVE_CAPITAL`): El bot NUNCA despliega más de esta cantidad, sin importar cuánto haya en la wallet. Default: $500.
- **Cap por posición** (`POLYAGENT_MAX_POSITION`): Ningún trade individual excede esto. Default: $100.
- **Cap de despliegue** (`POLYAGENT_MAX_DEPLOYED_PCT`): Como máximo el 70% del capital activo a la vez.

### Protección contra Pérdidas

- **Límite diario** (`POLYAGENT_DAILY_LOSS_LIMIT`): El bot pausa todo el trading si el P&L acumulado del día baja de este umbral. Default: -$50.
- **Sin market orders**: Bond Hunter usa **solo órdenes limit (GTC)** a precios calculados. Cero market orders que puedan sufrir slippage.

### Risk Management Automático (NUEVO)

- **Stop-Loss automático**: Si el precio cae por debajo de `entry - (2 × expected_profit)`, se vende inmediatamente. Ejemplo: entry a $0.95, expected profit ~$0.045 → stop en ~$0.86.
- **Trailing Stop**: Se activa cuando el precio sube +$0.01 sobre entry. Trail de $0.05 por debajo del precio más alto visto. Protege ganancias sin cortar winners.
- **Time Exit**: Si faltan <2h para cierre y el precio está por debajo de entry → vender.
- **Order Fill Check** (live): Cancela órdenes no ejecutadas después de 30 minutos.

Todos los parámetros de risk management son configurables desde la página **Strategies** del dashboard.

### Panel de Control Manual por Posición (NUEVO)

Cada señal abierta en el dashboard muestra:
- **Precio actual** en tiempo real (consultado vía CLOB API cada 15s)
- **P&L si vendes ahora** — incluyendo spread (sell al bid) y fees de protocolo
- **P&L si esperas resolución YES** — incluyendo fees de redención
- **Coste de salida anticipada** — lo que pierdes por salir antes
- **Precio de stop-loss** — donde se vendería automáticamente

Botones de acción (requieren confirmación):
- **Take Profit** — Vender al precio actual (solo visible si hay ganancia)
- **Sell** — Vender inmediatamente para cortar pérdidas

### Verificación de Órdenes

- **Check de balance**: Antes de cada orden, el bot verifica que hay suficiente USDC en el proxy wallet.
- **Logging doble**: Cada orden real se registra en la BD con el order ID del CLOB para auditoría.
- **Confirmación de orden**: El bot espera confirmación del CLOB antes de registrar la posición.

### Kill Switch

- **Dashboard**: Botón "STOP" con un click cancela todas las órdenes abiertas y desactiva el bot.
- **API**: Endpoints `POST /bot/disable` + `POST /orders/cancel-all`.
- **CLI**: `python3 agent.py --cancel-all` cancela todas las órdenes abiertas inmediatamente.
- **Manual**: `bash stop.sh` mata todos los procesos y elimina el cron.

### Aislamiento de Modos

- Paper y live se almacenan con columnas separadas (`mode = 'paper'` vs `mode = 'live'`).
- El modo paper NUNCA toca el CLOB API para órdenes.
- Puedes ejecutar paper y live en paralelo para comparar resultados.

---

## Cómo Funciona el Trading Real (Bond Hunter)

### Flujo de Ejecución (cada 15 minutos)

```
1. Cron dispara: python3 agent.py
   (el modo paper/live se lee de bot_status.trading_mode en la BD)

2. FASE DE RISK MANAGEMENT (NUEVO — se ejecuta PRIMERO)
   ├─ Para cada señal abierta:
   │   ├─ Consulta precio actual vía CLOB last-trade-price
   │   ├─ Actualiza current_price, highest_price_seen en BD
   │   ├─ CHECK 1: Hard Stop-Loss
   │   │   └─ Si current_price ≤ stop_loss_price → VENDER
   │   ├─ CHECK 2: Trailing Stop
   │   │   └─ Si trailing activo Y current ≤ trailing_stop_price → VENDER
   │   └─ CHECK 3: Time Exit
   │       └─ Si <2h para cierre Y current < entry → VENDER
   └─ Paper: solo marca en BD. Live: ejecuta sell_position() + marca.

3. FASE DE RESOLUCIÓN
   ├─ Consulta señales abiertas (status='open')
   ├─ Para cada señal, consulta si el mercado resolvió (Gamma API)
   ├─ Si resolvió YES → tokens se redimen automáticamente a $1.00
   │   └─ P&L = (shares × $1.00) - position_usdc - fees
   ├─ Si resolvió NO → pérdida total de la posición
   │   └─ P&L = -position_usdc - fees
   └─ Actualiza status='resolved' con P&L

4. CHECK ORDER FILLS (solo live, NUEVO)
   ├─ Verifica si órdenes limit se llenaron vía CLOB get_order()
   └─ Cancela órdenes no ejecutadas después de 30 minutos

5. FASE DE ESCANEO
   ├─ Fetch mercados abiertos de Gamma API
   ├─ Filtrar por: precio 0.92–0.995, liquidez, profit mínimo, wash score
   ├─ Para cada mercado que pasa los filtros:
   │
   │   a. CHECK DE BALANCE
   │   │   └─ Verifica USDC disponible en proxy wallet via CLOB API
   │   │
   │   b. CHECK DE LÍMITES
   │   │   ├─ Capital desplegado actual < max_deployed_pct × live_capital
   │   │   ├─ P&L del día > daily_loss_limit
   │   │   └─ Si falla cualquier check → skip mercado
   │   │
   │   c. POSITION SIZING (Kelly fraccionado)
   │   │   ├─ kelly_f = (p × b - q) / b   [p=win_prob, b=payout, q=1-p]
   │   │   ├─ position = min(kelly_f × capital × kelly_fraction,
   │   │   │                 capital × max_position_pct,
   │   │   │                 max_position_usdc)
   │   │   └─ shares = position_usdc / ask_price
   │   │
   │   d. COLOCAR ORDEN LIMIT (GTC)
   │   │   ├─ Crear OrderArgs(token_id, price, size, side=BUY)
   │   │   ├─ Firmar con private key: client.create_order(order_args)
   │   │   ├─ Enviar al CLOB: client.post_order(signed_order, OrderType.GTC)
   │   │   └─ Recibir order_id de confirmación
   │   │
   │   e. REGISTRAR EN BD
   │       ├─ INSERT en signals con mode='live', order_id, status='open'
   │       └─ Log del trade para auditoría
   │
   └─ Fin del scan

6. RESOLUCIÓN DE POSICIONES
   ├─ Bond Hunter espera resolución del mercado (pero ahora tiene stop-loss automático)
   ├─ Cuando el mercado resuelve YES:
   │   └─ Los YES tokens se convierten automáticamente en $1.00 USDC
   │       (redención on-chain, no requiere acción del bot)
   ├─ Cuando el mercado resuelve NO:
   │   └─ Los YES tokens valen $0.00 — pérdida registrada
   └─ El bot actualiza el P&L en el siguiente scan (fase de resolución)
```

### Código de Inicialización del CLOB Client

```python
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import OrderArgs, MarketOrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY, SELL

# Inicializar cliente
client = ClobClient(
    host="https://clob.polymarket.com",   # POLYMARKET_CLOB_HOST
    key=private_key,                       # POLYMARKET_PRIVATE_KEY
    chain_id=137,                          # POLYMARKET_CHAIN_ID (Polygon)
    signature_type=1,                      # POLYMARKET_SIGNATURE_TYPE
    funder=funder_address                  # POLYMARKET_FUNDER_ADDRESS
)

# Configurar API credentials (auto-derivar o usar guardadas)
client.set_api_creds(client.create_or_derive_api_creds())

# Colocar orden limit GTC para comprar YES tokens
order_args = OrderArgs(
    token_id="<yes-token-id>",    # ID del token YES del mercado
    price=0.96,                    # Precio limit (ej: $0.96 por token)
    size=50.0,                     # Cantidad de tokens a comprar
    side=BUY                       # Lado: comprar
)
signed_order = client.create_order(order_args)
response = client.post_order(signed_order, OrderType.GTC)
# response contiene el order_id para tracking
```

---

## Arquitectura del Proyecto

```
polyagent/
├── agent.py              # Core: DB init, strategy dispatch, CLI
├── api.py                # FastAPI REST server (puerto 8765)
├── clob_client.py        # Wrapper del CLOB client de Polymarket (NUEVO — live trading)
├── backtest.py           # Runner de backtests históricos
├── migrations.sql        # Todas las migraciones de BD (para OpenClaw)
├── requirements.txt      # Deps: py-clob-client, fastapi, websockets, etc.
├── start.sh              # Orquestación completa (6 pasos)
├── stop.sh               # Kill de todos los procesos + cron
├── .env.example          # Template de configuración (copiar a .env)
├── .env                  # Tus secretos (gitignored, NUNCA committed)
├── scripts/
│   ├── generate_api_creds.py   # Generación one-time de API credentials
│   ├── set_allowances.py       # Aprobación one-time de tokens (solo MetaMask)
│   └── verify_config.py        # Check pre-vuelo de configuración
├── strategies/
│   ├── __init__.py       # Strategy registry (STRATEGY_REGISTRY)
│   ├── base.py           # BaseStrategy ABC
│   ├── bond_hunter.py    # Bond Hunter (cron, paper+live)
│   └── ifnl_lite/
│       ├── __init__.py       # IfnlLiteStrategy class
│       ├── ifnl_runner.py    # Async runner (main loop)
│       ├── ws_client.py      # WebSocket (book/trades real-time)
│       ├── data_api.py       # REST poller (trades con wallet IDs)
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
│   └── ifnl_lite_status.json
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

### Ubicación y Persistencia

| Entorno | Path | Configurado por |
|---------|------|-----------------|
| Docker/OpenClaw | `/app/data/polyagent.db` | Default (volumen montado `./data:/app/data`) |
| Local | `./data/polyagent.db` | `start.sh` exporta `POLYAGENT_DB` |
| Custom | Cualquier path | `export POLYAGENT_DB=/mi/path/db` |

### Migraciones

**IMPORTANTE:** Todos los cambios de esquema están en `migrations.sql`. Es idempotente (seguro ejecutar múltiples veces).

```bash
# Inicializar tablas base
python3 agent.py --mode paper --force

# Aplicar migraciones
sqlite3 data/polyagent.db < migrations.sql
```

`start.sh` ejecuta ambos automáticamente.

### Tablas Principales

| Tabla | Descripción |
|-------|-------------|
| `config` | Parámetros Bond Hunter (singleton, id=1) |
| `bot_status` | Estado del bot Bond Hunter (singleton, id=1) |
| `signals` | Señales de Bond Hunter (paper + live, diferenciadas por `mode`) |
| `scan_log` | Historial de scans |
| `strategies` | Registry de estrategias (slug, type, enabled, capital, config_json) |
| `ifnl_signals` | Señales de IFNL-Lite |
| `ifnl_wallet_profiles` | Scores pre-computados de wallets |
| `ifnl_wallet_trades` | Datos raw de trades para profiling |
| `credentials` | Private key, funder address, API creds (singleton, id=1) |
| `runs` / `trades` | Resultados de backtests |

---

## API Endpoints

### Multi-Strategy

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/strategies` | Lista todas las estrategias |
| GET | `/strategies/{slug}` | Detalle de estrategia + config con defaults |
| POST | `/strategies/{slug}/config` | Actualizar config de estrategia |
| POST | `/strategies/{slug}/enable` | Activar estrategia |
| POST | `/strategies/{slug}/disable` | Desactivar estrategia |
| POST | `/strategies/{slug}/scan-now` | Scan inmediato (solo cron strategies) |
| GET | `/strategies/{slug}/signals` | Señales de la estrategia |
| GET | `/strategies/{slug}/signals/open` | Señales abiertas |
| GET | `/strategies/{slug}/stats` | Stats específicos |
| GET | `/strategies/{slug}/activity` | Métricas live del engine |

### Legacy Bond Hunter

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/config` | Config Bond Hunter |
| POST | `/config` | Update config |
| GET/POST | `/bot`, `/bot/enable`, `/bot/disable` | Control del bot |
| POST | `/bot/scan-now` | Scan inmediato |
| POST | `/bot/mode` | Cambiar modo paper/live (NUEVO) |
| GET | `/signals`, `/signals/open` | Señales |
| GET | `/signals/open/live` | Señales abiertas con precios en tiempo real + P&L (NUEVO) |
| POST | `/signals/{id}/sell` | Venta manual live (NUEVO) |
| POST | `/signals/{id}/sell-paper` | Venta manual paper (NUEVO) |
| GET | `/stats` | KPIs agregados (acepta `?mode=paper\|live`) |

### Settings / Credentials

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/settings/credentials` | Obtener credenciales (private key enmascarada) |
| POST | `/settings/credentials` | Guardar private key → auto-deriva funder + API creds |
| POST | `/settings/credentials/test` | Test de conexión CLOB API |
| GET | `/trading-mode` | Modo actual (lee de BD → env var → default paper) |
| POST | `/orders/cancel-all` | Cancelar todas las órdenes abiertas (solo live) |

### Utilidad

| Method | Path | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado + DB path + mode + timestamp |
| GET | `/scan-logs` | Historial de scans |
| GET | `/runs`, `/runs/{id}`, `/runs/{id}/trades` | Datos de backtest |

---

## Dashboard

Accede en `http://localhost:3000` después de ejecutar `start.sh`.

| Página | Descripción |
|--------|-------------|
| `/dashboard` | KPIs, gráfico P&L, señales activas con precios en tiempo real, control del bot, toggle PAPER/LIVE |
| `/strategies` | Cards de configuración (Bond Hunter con risk management, IFNL-Lite) |
| `/settings` | Configurar credenciales de Polymarket (private key, auto-derive funder + API creds) |
| `/logs` | Historial de ejecución de scans |

Cada señal abierta en el dashboard muestra:
- Precio actual, P&L si vendes ahora, P&L si esperas, coste de salir early
- Botones **Take Profit** y **Sell** con confirmación de doble-click
- Badge de `exit_reason` para señales cerradas por risk management (SL, TS, TIME, TP, SELL)

Login: `admin@polyagent.io` / `admin`

---

## Despliegue en OpenClaw

### Configuración de Secretos

En el panel de OpenClaw, configura estas variables como **secretos**:

**Obligatorios:**
```
POLYAGENT_MODE=live
POLYMARKET_PRIVATE_KEY=<tu-private-key-64-hex-sin-0x>
POLYMARKET_SIGNATURE_TYPE=1
```

**Opcionales (se auto-derivan si faltan):**
```
POLYMARKET_FUNDER_ADDRESS=<auto-derivado-de-private-key-via-CREATE2>
POLYMARKET_API_KEY=<auto-derivado-de-private-key>
POLYMARKET_API_SECRET=<auto-derivado>
POLYMARKET_API_PASSPHRASE=<auto-derivado>
```

**Límites de capital:**
```
POLYAGENT_LIVE_CAPITAL=500.00
POLYAGENT_MAX_POSITION=100.00
POLYAGENT_MAX_DEPLOYED_PCT=0.70
POLYAGENT_DAILY_LOSS_LIMIT=-50.00
```

**Nota:** Si solo configuras `POLYMARKET_PRIVATE_KEY`, el sistema auto-deriva el funder address (CREATE2) y las API credentials al arrancar. Pero se recomienda configurar `POLYMARKET_FUNDER_ADDRESS` también para evitar problemas si la derivación falla.

**Alternativa:** Configura las credenciales desde la página **Settings** del dashboard después del primer arranque. Las credenciales se guardan en la BD (que persiste en el volumen) y sobreviven rebuilds.

### Reset de Base de Datos (primer despliegue)

**IMPORTANTE:** Antes del primer arranque en live (o cuando se quiera empezar con datos limpios), ejecutar:

```bash
# Reset completo (borra señales paper, stats, logs — todo limpio)
bash reset_db.sh

# Reset preservando credenciales (si ya se configuraron via Settings)
bash reset_db.sh --keep-creds
```

Este script:
1. Borra la BD existente (con datos paper)
2. La recrea limpia con todas las tablas y seeds
3. Aplica `migrations.sql`
4. Opcionalmente restaura las credenciales guardadas

**En OpenClaw:** Ejecutar `bash reset_db.sh` una sola vez antes del primer `bash start.sh`. Después de eso, `start.sh` es el único entrypoint necesario.

### Entrypoint

Usa `bash start.sh` como entrypoint del container.

### Flujo de Arranque (start.sh)

```
[1/6] Instalar dependencias Python (pip install -r requirements.txt)
[2/6] Inicializar BD + aplicar migrations.sql
      → Crea tablas: signals, strategies, credentials, config, etc.
      → Seeds: Bond Hunter (enabled), IFNL-Lite (disabled)
[3/6] Arrancar API FastAPI (uvicorn, puerto 8765)
[4/6] Build + arrancar frontend Next.js (puerto 3000)
[5/6] Configurar cron: */15 * * * * agent.py (modo leído de BD)
[6/6] Auto-arrancar IFNL-Lite si enabled=1 en BD
```

### Persistencia de Datos

```yaml
volumes:
  - ./data:/app/data    # BD SQLite + datos persistentes
```

La BD (`polyagent.db`) sobrevive rebuilds del container. Contiene:
- Credenciales guardadas desde Settings
- Señales históricas (paper + live)
- Config de estrategias
- Perfiles de wallets (IFNL)

### Restart del Container

Cuando el container se reinicia:
- La BD ya existe en el volumen → solo aplica migraciones nuevas
- Credenciales persisten en la BD → no hay que reconfigurar
- IFNL-Lite se auto-lanza si estaba enabled
- Bond Hunter continúa via cron
- **No requiere acción del usuario**

### Puertos

| Puerto | Servicio | Descripción |
|--------|----------|-------------|
| 3000 | Frontend Next.js | Dashboard (proxy a API via /api/*) |
| 8765 | API FastAPI | REST API + Swagger (/docs) |

Expón el puerto 3000 en OpenClaw para acceder al dashboard.

---

## Troubleshooting

### "Invalid API key" o errores 401

Tus API credentials pueden haber expirado o son incorrectas.

```bash
# Re-derivar credenciales desde tu private key
python3 scripts/generate_api_creds.py
```

### "Insufficient balance" al colocar órdenes

El bot verifica tu balance USDC real antes de cada trade. Si tu balance bajó (ej: tradeaste manualmente en polymarket.com), el bot respeta el balance real.

### Las órdenes no se llenan (fills)

Bond Hunter usa órdenes limit (GTC). Si el mercado se mueve antes de que tu orden se llene, puede quedarse sin ejecutar. El bot monitoriza órdenes abiertas y cancela las que llevan demasiado tiempo.

### "Allowance too low" (solo MetaMask/EOA)

```bash
python3 scripts/set_allowances.py
```

### El bot colocó una orden que no quiero

1. Click en **STOP** en el dashboard (cancela todas las órdenes + desactiva bot)
2. O via API: `curl -X POST http://localhost:8765/bot/disable`
3. O mata todo: `bash stop.sh`
4. Verifica en polymarket.com que tus posiciones estén correctas

### Cambiar entre paper y live

**Opción A — Dashboard (recomendado, sin reinicio):**

En el dashboard, junto al control del bot, hay un toggle **PAPER / LIVE**. Click para cambiar. Si cambias a LIVE, se pide confirmación.

El modo se guarda en la BD (`bot_status.trading_mode`). El siguiente scan del cron usa el nuevo modo automáticamente — **no requiere reinicio**.

**Opción B — Variable de entorno (legacy):**

Edita `.env`:
```env
POLYAGENT_MODE=paper   # o live
```

Luego reinicia:
```bash
bash stop.sh && bash start.sh
```

**Prioridad de resolución del modo:**
1. CLI `--mode` (override manual para testing)
2. BD `bot_status.trading_mode` (toggle del dashboard)
3. ENV `POLYAGENT_MODE` (fallback para deploy sin UI)
4. Default: `paper`

Las señales paper y live se almacenan por separado (columna `mode`) — cambiar de modo no afecta datos históricos. Stats y P&L se pueden filtrar por modo con `GET /stats?mode=paper`.

---

## Comandos Útiles

```bash
# Arrancar todo
bash start.sh

# Parar todo
bash stop.sh

# Scan manual Bond Hunter (paper)
python3 agent.py --mode paper --force

# Scan manual Bond Hunter (live — ¡coloca órdenes reales!)
python3 agent.py --mode live --force

# Backtest
python3 agent.py --mode backtest --days 60 --capital 500

# IFNL runner manual
python3 -m strategies.ifnl_lite.ifnl_runner --db data/polyagent.db

# Wallet profiler (diario)
python3 -m strategies.ifnl_lite.wallet_profiler --db data/polyagent.db

# Verificar configuración live
python3 scripts/verify_config.py

# Check API health
curl http://localhost:8765/health

# Ver estrategias
curl http://localhost:8765/strategies | python3 -m json.tool

# Ver señales abiertas
curl http://localhost:8765/signals/open | python3 -m json.tool

# Logs
tail -f logs/agent.log
tail -f logs/api.log
tail -f logs/ifnl_lite.log
```

---

## Seguridad

- **Private keys** se almacenan en la BD (`credentials` table) o en `.env` (gitignored). Nunca committed a version control.
- **API credentials** se auto-derivan de tu private key y se guardan en BD o `.env`.
- **Sin almacenamiento en la nube** — todo corre localmente o en tu propio servidor.
- **Auth del dashboard** es local-only (hardcoded `admin/admin`). Si expones a internet, añade auth real.
- **Permisos USDC** se otorgan solo a contratos oficiales de exchange de Polymarket.
- **Kill switch** disponible en dashboard, API, y CLI para emergencias.

---

## Referencias

- [Polymarket py-clob-client (GitHub)](https://github.com/Polymarket/py-clob-client)
- [Polymarket CLOB Authentication Docs](https://docs.polymarket.com/developers/CLOB/authentication)
- [Polymarket Proxy Wallet Docs](https://docs.polymarket.com/developers/proxy-wallet)
- [CLOB Allowance Setup (Gist)](https://gist.github.com/poly-rodr/44313920481de58d5a3f6d1f8226bd5e)
- [py-clob-client en PyPI](https://pypi.org/project/py-clob-client/) (v0.34.6)
- [Guía de Generación de API Keys](https://jeremywhittaker.com/index.php/2024/08/28/generating-api-keys-for-polymarket-com/)
