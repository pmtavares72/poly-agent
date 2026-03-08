"""
POLYAGENT — BOND HUNTER STRATEGY RUNNER
============================================

ESTRATEGIA: Bond Hunter
-----------------------
Busca mercados de predicción binarios (YES/NO) en Polymarket donde el precio
del token YES está muy cerca de 1.0, es decir, el mercado prácticamente ya sabe
que el resultado será YES. La idea es comprar esos tokens como si fueran
"bonos a corto plazo": entrada cerca de $0.96-0.995, resolución en <48h a $1.00.

CÓMO INTERPRETAR LOS RESULTADOS
---------------------------------
- PnL positivo: la estrategia habría ganado ese importe en el período analizado.
- Win rate > 90%: normal para esta estrategia (mercados casi seguros).
- Pérdidas grandes: indican los raros casos donde el mercado sorprendió (resolución NO).
- Spread promedio: coste implícito de liquidez. Menor = mejor mercado.
- Rechazados por spread: mercados donde los fees se comían el beneficio potencial.
- Rechazados por wash: mercados con actividad sospechosa (volumen artificial).

LIMITACIONES DEL BACKTEST
--------------------------
- Los precios históricos son OHLC o puntuales; sin datos de orderbook real.
- El spread es estimado según liquidez, no el spread real en ese momento.
- No se modela el impacto de mercado (slippage por tamaño de orden).
- Las fechas de resolución pueden variar levemente de las de cierre oficial.

USO
----
python agent.py                             # parámetros por defecto
python agent.py --days 60 --capital 500    # personalizar
python agent.py --min-prob 0.93 --max-prob 0.99
"""

import argparse
import json
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import requests
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# ─────────────────────────────────────────────
# PARÁMETROS DE LA ESTRATEGIA
# ─────────────────────────────────────────────
INITIAL_CAPITAL    = 200.0   # USDC
DAYS_BACK          = 30      # días hacia atrás a analizar
MIN_PROBABILITY    = 0.95    # precio mínimo YES para entrar
MAX_PROBABILITY    = 0.995   # precio máximo YES (evitar ya resueltos)
MIN_PROFIT_NET     = 0.015   # beneficio neto mínimo tras fees (1.5%)
MAX_HOURS_TO_CLOSE = 48      # solo mercados que cierran en <48h
MIN_LIQUIDITY_USDC = 500     # liquidez mínima
FEE_RATE           = 0.005   # fee protocolo estimado (0.5%)
KELLY_FRACTION     = 0.25    # fracción Kelly conservadora
MAX_POSITION_PCT   = 0.15    # máximo 15% del capital por trade

# ─────────────────────────────────────────────
# CONSTANTES API
# ─────────────────────────────────────────────
GAMMA_API   = "https://gamma-api.polymarket.com/markets"
CLOB_PRICES = "https://clob.polymarket.com/prices-history"
REQUEST_TIMEOUT = 10
SLEEP_BETWEEN_REQUESTS = 0.1

console = Console()


# ─────────────────────────────────────────────
# BASE DE DATOS
# ─────────────────────────────────────────────

def init_db(db_path: str = "polyagent.db") -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS runs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at    TEXT NOT NULL,
            completed_at  TEXT,
            days_back     INTEGER,
            initial_capital REAL,
            final_capital REAL,
            total_trades  INTEGER,
            wins          INTEGER,
            losses        INTEGER,
            win_rate      REAL,
            total_pnl     REAL,
            total_pnl_pct REAL,
            avg_spread_pct REAL,
            total_fees_paid REAL,
            params_json   TEXT
        );

        CREATE TABLE IF NOT EXISTS trades (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id              INTEGER REFERENCES runs(id),
            token_id            TEXT,
            question            TEXT,
            status              TEXT,
            opened_at           TEXT,
            closes_at           TEXT,
            entry_price         REAL,
            ask_price           REAL,
            spread_entry_pct    REAL,
            slippage_usdc       REAL DEFAULT 0,
            position_usdc       REAL,
            shares              REAL,
            protocol_fee        REAL,
            breakeven_price     REAL,
            resolved_at         TEXT,
            resolution          TEXT,
            revenue_usdc        REAL,
            pnl_usdc            REAL,
            pnl_pct             REAL,
            liquidity_at_entry  REAL,
            volume_24h_at_entry REAL,
            hours_to_close      REAL,
            wash_score          TEXT,
            mode                TEXT DEFAULT 'backtest'
        );

        -- Configuración del bot (una sola fila, id=1)
        CREATE TABLE IF NOT EXISTS config (
            id                  INTEGER PRIMARY KEY DEFAULT 1,
            initial_capital     REAL    DEFAULT 500.0,
            min_probability     REAL    DEFAULT 0.95,
            max_probability     REAL    DEFAULT 0.995,
            min_profit_net      REAL    DEFAULT 0.015,
            max_hours_to_close  REAL    DEFAULT 48.0,
            min_liquidity_usdc  REAL    DEFAULT 500.0,
            kelly_fraction      REAL    DEFAULT 0.25,
            max_position_pct    REAL    DEFAULT 0.15,
            fee_rate            REAL    DEFAULT 0.005,
            scan_interval_min   INTEGER DEFAULT 15,
            updated_at          TEXT
        );
        INSERT OR IGNORE INTO config (id) VALUES (1);

        -- Estado del bot (una sola fila, id=1)
        CREATE TABLE IF NOT EXISTS bot_status (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            enabled         INTEGER DEFAULT 0,   -- 0=parado 1=activo
            pid             INTEGER,             -- PID del proceso cron/runner
            last_scan_at    TEXT,
            next_scan_at    TEXT,
            last_error      TEXT,
            scan_count      INTEGER DEFAULT 0
        );
        INSERT OR IGNORE INTO bot_status (id) VALUES (1);

        -- Log de cada ejecución del scanner (paper trading)
        CREATE TABLE IF NOT EXISTS scan_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TEXT NOT NULL,
            finished_at     TEXT,
            duration_sec    REAL,
            markets_fetched INTEGER DEFAULT 0,
            markets_checked INTEGER DEFAULT 0,
            signals_found   INTEGER DEFAULT 0,
            signals_resolved INTEGER DEFAULT 0,
            skipped_wash    INTEGER DEFAULT 0,
            skipped_spread  INTEGER DEFAULT 0,
            skipped_no_data INTEGER DEFAULT 0,
            skipped_price   INTEGER DEFAULT 0,
            error           TEXT,
            mode            TEXT DEFAULT 'paper'
        );

        -- Señales paper trading: mercados abiertos detectados en tiempo real
        CREATE TABLE IF NOT EXISTS signals (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            detected_at         TEXT NOT NULL,
            token_id            TEXT NOT NULL,
            question            TEXT,
            market_url          TEXT,
            closes_at           TEXT,
            hours_to_close      REAL,
            entry_price         REAL,
            ask_price           REAL,
            spread_entry_pct    REAL,
            net_profit_pct      REAL,
            position_usdc       REAL,
            shares              REAL,
            protocol_fee        REAL,
            breakeven_price     REAL,
            liquidity           REAL,
            volume_24h          REAL,
            wash_score          TEXT,
            outcome             TEXT,       -- NULL hasta resolución, luego 'YES'/'NO'
            resolved_at         TEXT,
            pnl_usdc            REAL,
            pnl_pct             REAL,
            status              TEXT DEFAULT 'open'  -- open | resolved | expired
        );
    """)
    conn.commit()
    return conn


def insert_run(conn: sqlite3.Connection, params: dict) -> int:
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO runs (started_at, days_back, initial_capital, params_json)
           VALUES (?, ?, ?, ?)""",
        (datetime.now(timezone.utc).isoformat(), params["days_back"],
         params["initial_capital"], json.dumps(params))
    )
    conn.commit()
    return cur.lastrowid


def finalize_run(conn: sqlite3.Connection, run_id: int, summary: dict):
    cur = conn.cursor()
    cur.execute(
        """UPDATE runs SET completed_at=?, final_capital=?, total_trades=?,
           wins=?, losses=?, win_rate=?, total_pnl=?, total_pnl_pct=?,
           avg_spread_pct=?, total_fees_paid=?
           WHERE id=?""",
        (
            datetime.now(timezone.utc).isoformat(),
            summary["final_capital"],
            summary["total_trades"],
            summary["wins"],
            summary["losses"],
            summary["win_rate"],
            summary["total_pnl"],
            summary["total_pnl_pct"],
            summary["avg_spread_pct"],
            summary["total_fees_paid"],
            run_id,
        )
    )
    conn.commit()


def insert_trade(conn: sqlite3.Connection, run_id: int, trade: dict):
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO trades (
            run_id, token_id, question, status, opened_at, closes_at,
            entry_price, ask_price, spread_entry_pct, slippage_usdc,
            position_usdc, shares, protocol_fee, breakeven_price,
            resolved_at, resolution, revenue_usdc, pnl_usdc, pnl_pct,
            liquidity_at_entry, volume_24h_at_entry, hours_to_close,
            wash_score, mode
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            run_id,
            trade.get("token_id"),
            trade.get("question"),
            trade.get("status"),
            trade.get("opened_at"),
            trade.get("closes_at"),
            trade.get("entry_price"),
            trade.get("ask_price"),
            trade.get("spread_entry_pct"),
            trade.get("slippage_usdc", 0),
            trade.get("position_usdc"),
            trade.get("shares"),
            trade.get("protocol_fee"),
            trade.get("breakeven_price"),
            trade.get("resolved_at"),
            trade.get("resolution"),
            trade.get("revenue_usdc"),
            trade.get("pnl_usdc"),
            trade.get("pnl_pct"),
            trade.get("liquidity_at_entry"),
            trade.get("volume_24h_at_entry"),
            trade.get("hours_to_close"),
            trade.get("wash_score"),
            "backtest",
        )
    )
    conn.commit()


# ─────────────────────────────────────────────
# HTTP HELPERS
# ─────────────────────────────────────────────

def safe_get(url: str, params: dict = None) -> Optional[dict]:
    """GET con reintentos en 429 y manejo de errores."""
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 429:
            time.sleep(2)
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        console.print(f"[yellow]  HTTP error: {exc}[/yellow]")
        return None


# ─────────────────────────────────────────────
# PASO 1 — DESCARGA DE MERCADOS
# ─────────────────────────────────────────────

def fetch_resolved_markets(days_back: int) -> list:
    """Descarga mercados resueltos de los últimos days_back días.

    Usa caché local en markets_cache.json para evitar re-descargar.
    La caché expira si tiene más de 1 hora o si el days_back no coincide.
    """
    import os
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
    from rich.live import Live

    cache_file = "markets_cache.json"
    cache_max_age_seconds = 3600  # 1 hora

    # Intentar cargar caché
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r") as f:
                cache = json.load(f)
            cache_age = time.time() - cache.get("saved_at", 0)
            if cache.get("days_back") == days_back and cache_age < cache_max_age_seconds:
                markets = cache["markets"]
                age_min = int(cache_age / 60)
                console.print(f"[green]Usando caché local ({len(markets)} mercados, hace {age_min} min)[/green]")
                return markets
            else:
                console.print(f"[dim]Caché expirada o days_back distinto — re-descargando...[/dim]")
        except (json.JSONDecodeError, KeyError):
            console.print(f"[dim]Caché inválida — re-descargando...[/dim]")

    cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
    now    = datetime.now(timezone.utc)
    total_seconds = days_back * 86400

    markets = []
    offset  = 0
    limit   = 500  # máximo que acepta la API

    with Progress(
        SpinnerColumn(),
        TextColumn("[cyan]Descargando mercados[/cyan]"),
        BarColumn(bar_width=40),
        TaskProgressColumn(),
        TextColumn("[dim]{task.fields[info]}[/dim]"),
        console=console,
        transient=False,
    ) as progress:
        task = progress.add_task(
            "fetch", total=100, info=f"0 mercados | hasta {cutoff.strftime('%Y-%m-%d')}"
        )

        while True:
            params = {
                "closed": "true",
                "limit": limit,
                "offset": offset,
                "order": "closedTime",
                "ascending": "false",
            }
            data = safe_get(GAMMA_API, params)
            if not data:
                break

            batch = data if isinstance(data, list) else data.get("markets", [])
            if not batch:
                break

            reached_cutoff = False
            oldest_dt = None
            for m in batch:
                closed_str = m.get("closedTime") or m.get("endDate") or m.get("endDateIso")
                if not closed_str:
                    continue
                try:
                    closed_dt = datetime.fromisoformat(closed_str.replace("Z", "+00:00"))
                except ValueError:
                    continue

                oldest_dt = closed_dt  # el último del batch es el más antiguo
                if closed_dt < cutoff:
                    reached_cutoff = True
                    break

                # Pre-filtro rápido: solo binarios con volumen y clobTokenIds
                outcomes_raw = m.get("outcomes", [])
                if isinstance(outcomes_raw, str):
                    try:
                        outcomes_raw = json.loads(outcomes_raw)
                    except (ValueError, TypeError):
                        outcomes_raw = []
                if len(outcomes_raw) != 2:
                    continue
                if not (m.get("clobTokenIds") or m.get("clob_token_ids")):
                    continue
                volume = float(m.get("volume") or 0)
                if volume < 1000:
                    continue

                markets.append(m)

            # Calcular progreso según qué tan atrás en el tiempo llegamos
            if oldest_dt:
                elapsed = (now - oldest_dt).total_seconds()
                pct = min(int(elapsed / total_seconds * 100), 99)
                age_str = oldest_dt.strftime("%Y-%m-%d %H:%M")
                progress.update(
                    task,
                    completed=pct,
                    info=f"{len(markets)} mercados | más antiguo: {age_str}",
                )

            time.sleep(SLEEP_BETWEEN_REQUESTS)
            offset += limit

            if reached_cutoff or len(batch) < limit:
                break

        progress.update(task, completed=100, info=f"{len(markets)} mercados descargados")

    # Guardar caché
    try:
        with open(cache_file, "w") as f:
            json.dump({"days_back": days_back, "saved_at": time.time(), "markets": markets}, f)
        console.print(f"[dim]Caché guardada en {cache_file}[/dim]")
    except OSError:
        pass

    return markets


# ─────────────────────────────────────────────
# PASO 2 — FILTROS BÁSICOS
# ─────────────────────────────────────────────

def passes_basic_filters(m: dict, min_liquidity: float, require_resolved: bool = True) -> tuple:
    """
    Devuelve (True, token_id_yes, outcome_winner) o (False, reason, None).
    outcome_winner: 'YES' | 'NO' | None (en paper trading, where market is still open)
    require_resolved=True: exige outcomePrices=[1,0] o [0,1] (backtest)
    require_resolved=False: acepta cualquier outcomePrices válido (paper)
    """
    # Solo binarios
    outcomes = m.get("outcomes") or []
    if isinstance(outcomes, str):
        try:
            outcomes = json.loads(outcomes)
        except (ValueError, TypeError):
            outcomes = []

    if len(outcomes) != 2:
        return False, "not_binary", None

    # outcomePrices — en backtest debe ser [1,0] o [0,1]; en paper son precios actuales
    outcome_prices_raw = m.get("outcomePrices") or []
    if isinstance(outcome_prices_raw, str):
        try:
            outcome_prices_raw = json.loads(outcome_prices_raw)
        except (ValueError, TypeError):
            outcome_prices_raw = []

    if len(outcome_prices_raw) != 2:
        return False, "no_outcome_prices", None

    try:
        op = [float(x) for x in outcome_prices_raw]
    except (TypeError, ValueError):
        return False, "bad_outcome_prices", None

    if op == [1.0, 0.0]:
        outcome_winner = "YES"
    elif op == [0.0, 1.0]:
        outcome_winner = "NO"
    elif require_resolved:
        return False, "disputed_resolution", None
    else:
        outcome_winner = None  # mercado abierto, resultado aún desconocido

    # Volumen
    volume = float(m.get("volume", 0) or 0)
    if volume < 1000:
        return False, "low_volume", None

    # Liquidez — el campo puede ser None; usar spread como proxy si falta
    liquidity_raw = m.get("liquidity")
    if liquidity_raw is not None:
        liquidity = float(liquidity_raw or 0)
        if liquidity < min_liquidity:
            return False, "low_liquidity", None
    # Si liquidity es None, aceptar si el spread del mercado es razonable (<5%)
    else:
        spread_raw = float(m.get("spread") or 1.0)
        if spread_raw > 0.05:
            return False, "low_liquidity_proxy", None

    # clobTokenIds
    clob_ids_raw = m.get("clobTokenIds") or m.get("clob_token_ids") or []
    if isinstance(clob_ids_raw, str):
        try:
            clob_ids_raw = json.loads(clob_ids_raw)
        except (ValueError, TypeError):
            clob_ids_raw = []

    if not clob_ids_raw:
        return False, "no_clob_ids", None

    token_id_yes = clob_ids_raw[0]
    return True, token_id_yes, outcome_winner


# ─────────────────────────────────────────────
# PASO 2b — ANTI-WASH TRADING
# ─────────────────────────────────────────────

def compute_wash_score(m: dict) -> tuple:
    """Devuelve (is_wash: bool, reason: str)"""
    volume_total = float(m.get("volume", 0) or 0)
    volume_24h   = float(m.get("volume24hr", 0) or m.get("volume_24h", 0) or 0)
    liquidity    = float(m.get("liquidity") or 0)
    traders      = int(m.get("uniqueTraderCount", 0) or m.get("unique_traders_count", 0) or 999)

    # Calcular duración del mercado para ajustar el umbral de vol24h/total
    duration_h = None
    start_str  = m.get("startDate") or m.get("startDateIso")
    closed_str = m.get("closedTime") or m.get("endDate") or m.get("endDateIso")
    if start_str and closed_str:
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            close_dt = datetime.fromisoformat(closed_str.replace("Z", "+00:00"))
            duration_h = (close_dt - start_dt).total_seconds() / 3600
        except ValueError:
            pass

    # vol24h/total solo aplica a mercados que duraron más de 24h
    # Para mercados cortos (<24h) es normal que todo el volumen sea "de hoy"
    if duration_h is None or duration_h > 24:
        if volume_total > 0 and (volume_24h / volume_total) > 0.85:
            return True, "vol24h/total>0.85"

    if volume_24h > 1000 and traders < 5:
        return True, "few_traders_high_vol"
    if liquidity > 0 and volume_24h > liquidity * 50:
        return True, "vol/liq_anomaly"
    return False, "ok"


# ─────────────────────────────────────────────
# PASO 3 — SERIE TEMPORAL DE PRECIOS
# ─────────────────────────────────────────────

def fetch_price_series(token_id: str, start_ts: int, end_ts: int) -> list:
    """Devuelve lista de {'t': unix, 'p': price} o []."""
    params = {
        "market": token_id,
        "startTs": start_ts,
        "endTs": end_ts,
        "fidelity": 1,
    }
    data = safe_get(CLOB_PRICES, params)
    if not data:
        return []
    history = data.get("history", [])
    return history if isinstance(history, list) else []


def find_entry_point(history: list, end_ts: int, min_prob: float, max_prob: float,
                     max_hours: float) -> Optional[dict]:
    """
    Busca el PRIMER punto donde min_prob <= price <= max_prob y hours_to_close > 1h.

    Requisito anti look-ahead: exigir al menos 1h hasta el cierre en el punto de entrada.
    Esto evita entrar cuando el precio ya refleja el outcome inminente (últimos minutos).
    """
    MIN_HOURS_TO_CLOSE = 1.0  # mínimo 1h hasta el cierre para que sea una entrada real

    for point in history:
        try:
            t = int(point["t"])
            p = float(point["p"])
        except (KeyError, TypeError, ValueError):
            continue

        hours_to_close = (end_ts - t) / 3600.0
        if hours_to_close < MIN_HOURS_TO_CLOSE:
            continue
        if hours_to_close > max_hours:
            continue
        if min_prob <= p <= max_prob:
            return {"timestamp": t, "price": p, "hours_to_close": hours_to_close}
    return None


# ─────────────────────────────────────────────
# PASO 4 — SPREAD ESTIMADO
# ─────────────────────────────────────────────

def estimate_spread(liquidity: float) -> float:
    """Retorna spread estimado como fracción (ej. 0.005 = 0.5%)."""
    if liquidity > 5000:
        return 0.005
    if liquidity > 1000:
        return 0.010
    return 0.020


# ─────────────────────────────────────────────
# PASO 5 — KELLY SIZING
# ─────────────────────────────────────────────

def kelly_size(capital: float, entry_price: float, ask_price: float,
               kelly_fraction: float, max_pct: float) -> float:
    b = (1.0 - ask_price) / ask_price
    p = entry_price
    q = 1.0 - p
    kelly_f = max(0.0, (b * p - q) / b)
    position = capital * kelly_fraction * kelly_f
    position = min(position, capital * max_pct)
    position = max(position, 5.0)
    return position


# ─────────────────────────────────────────────
# OUTPUT HELPERS
# ─────────────────────────────────────────────

def print_trade(outcome_winner: str, question: str, entry_price: float,
                position_usdc: float, pnl: float, capital: float):
    won = (outcome_winner == "YES")
    icon = "✅" if won else "❌"
    q_short = (question[:50] + "…") if len(question) > 50 else question.ljust(51)
    pnl_str = f"+${pnl:.2f}" if pnl >= 0 else f"-${abs(pnl):.2f}"
    color = "green" if won else "red"
    console.print(
        f"  {icon}  [bold]{q_short}[/bold]  "
        f"[cyan]${entry_price:.4f}[/cyan]  "
        f"[yellow]${position_usdc:.2f}[/yellow]  "
        f"[{color}]{pnl_str}[/{color}]  "
        f"capital=[white]${capital:.2f}[/white]"
    )


def print_skip(reason: str, question: str):
    q_short = (question[:45] + "…") if len(question) > 45 else question
    console.print(f"  [dim]⏭️  [SKIP] {reason}: {q_short}[/dim]")


def print_summary(params: dict, capital: float, trades: list,
                  stats: dict):
    initial = params["initial_capital"]
    total_pnl = capital - initial
    total_pnl_pct = (total_pnl / initial) * 100

    wins    = sum(1 for t in trades if t["resolution"] == "YES")
    losses  = sum(1 for t in trades if t["resolution"] == "NO")
    n       = len(trades)
    win_rate = (wins / n * 100) if n > 0 else 0.0

    best  = max((t["pnl_usdc"] for t in trades), default=0.0)
    worst = min((t["pnl_usdc"] for t in trades), default=0.0)
    avg_pnl = (total_pnl / n) if n > 0 else 0.0

    spreads = [t["spread_entry_pct"] for t in trades]
    avg_spread = (sum(spreads) / len(spreads) * 100) if spreads else 0.0
    total_fees = sum(t["protocol_fee"] for t in trades)

    pnl_color = "green" if total_pnl >= 0 else "red"
    pnl_sign  = "+" if total_pnl >= 0 else ""

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("label", style="bold white", no_wrap=True)
    table.add_column("value", style="white")

    table.add_row("", "")
    table.add_row("[bold cyan]CAPITAL[/bold cyan]", "")
    table.add_row("  Inicial:",   f"${initial:.2f}")
    table.add_row("  Final:",     f"${capital:.2f}")
    table.add_row("  PnL total:", f"[{pnl_color}]{pnl_sign}${total_pnl:.2f}  ({pnl_sign}{total_pnl_pct:.1f}%)[/{pnl_color}]")

    table.add_row("", "")
    table.add_row("[bold cyan]TRADES[/bold cyan]", "")
    table.add_row("  Total ejecutados:", str(n))
    table.add_row("  Ganadores:",  f"[green]{wins}[/green]  ({win_rate:.1f}%)")
    table.add_row("  Perdedores:", f"[red]{losses}[/red]  ({100-win_rate:.1f}%)")

    table.add_row("", "")
    table.add_row("[bold cyan]COSTES REALES SIMULADOS[/bold cyan]", "")
    table.add_row("  Spread promedio:",      f"{avg_spread:.2f}%")
    table.add_row("  Fees totales pagadas:", f"${total_fees:.2f}")
    table.add_row("  PnL medio por trade:",  f"{'+'if avg_pnl>=0 else ''}${avg_pnl:.2f}")
    table.add_row("  Mejor trade:",          f"[green]+${best:.2f}[/green]")
    table.add_row("  Peor trade:",           f"[red]-${abs(worst):.2f}[/red]")

    table.add_row("", "")
    table.add_row("[bold cyan]FILTROS[/bold cyan]", "")
    table.add_row("  Mercados analizados:", str(stats["analyzed"]))
    table.add_row("  Pasaron filtros:",     f"{n}  ({n/max(stats['analyzed'],1)*100:.1f}%)")
    table.add_row("  Rechazados wash:",     str(stats["rejected_wash"]))
    table.add_row("  Rechazados spread:",   str(stats["rejected_spread"]))
    table.add_row("  Sin datos precio:",    str(stats["no_price_data"]))

    panel = Panel(
        table,
        title=f"[bold yellow]POLYMARKET BOND HUNTER — BACKTEST[/bold yellow]",
        subtitle=f"[dim]Últimos {params['days_back']} días | ${initial:.0f} inicial[/dim]",
        border_style="yellow",
    )
    console.print()
    console.print(panel)


# ─────────────────────────────────────────────
# MAIN LOOP
# ─────────────────────────────────────────────

def run_backtest(params: dict):
    days_back          = params["days_back"]
    initial_capital    = params["initial_capital"]
    min_prob           = params["min_prob"]
    max_prob           = params["max_prob"]
    min_profit_net     = params["min_profit_net"]
    max_hours          = params["max_hours"]
    min_liquidity      = params["min_liquidity"]
    fee_rate           = params["fee_rate"]
    kelly_fraction     = params["kelly_fraction"]
    max_position_pct   = params["max_position_pct"]

    conn   = init_db()
    run_id = insert_run(conn, params)
    capital = initial_capital

    stats = {
        "analyzed": 0,
        "rejected_wash": 0,
        "rejected_spread": 0,
        "no_price_data": 0,
    }
    trades = []

    # ── Descargar mercados ──
    markets = fetch_resolved_markets(days_back)
    console.print(f"\n[bold]Procesando {len(markets)} mercados...[/bold]\n")

    for m in markets:
        stats["analyzed"] += 1
        question = m.get("question", m.get("title", "Unknown"))

        # ── Filtros básicos ──
        ok, token_or_reason, outcome_winner = passes_basic_filters(m, min_liquidity)
        if not ok:
            continue  # skip silencioso (no relevante para el usuario)

        token_id_yes = token_or_reason

        # ── Pre-filtro por lastTradePrice (evita llamadas CLOB innecesarias) ──
        last_price_raw = m.get("lastTradePrice")
        if last_price_raw is not None:
            try:
                last_price = float(last_price_raw)
                # Si el precio final está muy lejos del rango de entrada, skip sin llamar CLOB
                if last_price < min_prob - 0.05 or last_price > max_prob + 0.01:
                    stats["no_price_data"] += 1
                    continue
            except (TypeError, ValueError):
                pass

        # ── Anti-wash ──
        is_wash, wash_reason = compute_wash_score(m)
        if is_wash:
            stats["rejected_wash"] += 1
            print_skip(f"wash_score={wash_reason}", question)
            continue

        # ── Fechas ──
        end_date_str = m.get("endDate") or m.get("end_date_iso") or m.get("closingDate", "")
        try:
            end_dt  = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            end_ts  = int(end_dt.timestamp())
        except ValueError:
            continue

        start_ts = end_ts - int(max_hours * 3600)

        # ── Serie de precios ──
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        history = fetch_price_series(token_id_yes, start_ts, end_ts)
        if not history:
            stats["no_price_data"] += 1
            continue  # skip silencioso

        # ── Punto de entrada ──
        entry = find_entry_point(history, end_ts, min_prob, max_prob, max_hours)
        if not entry:
            stats["no_price_data"] += 1
            continue

        entry_price    = entry["price"]
        hours_to_close = entry["hours_to_close"]
        liquidity_raw  = m.get("liquidity")
        liquidity      = float(liquidity_raw or 0) if liquidity_raw is not None else None
        volume_24h     = float(m.get("volume24hr", 0) or m.get("volume_24h", 0) or 0)

        # ── Spread y ask ──
        # Si liquidity es None, usar spread del mercado como proxy para estimar liquidez efectiva
        if liquidity is None:
            market_spread = float(m.get("spread") or 0.02)
            # Convertir spread a liquidez aproximada: spread bajo => alta liquidez
            if market_spread < 0.005:
                liquidity = 10000.0
            elif market_spread < 0.01:
                liquidity = 2000.0
            else:
                liquidity = 800.0
        spread = estimate_spread(liquidity)
        ask_price = min(entry_price + spread / 2, 0.999)

        net_profit_pct = (1.0 - ask_price) - fee_rate
        if net_profit_pct < min_profit_net:
            stats["rejected_spread"] += 1
            print_skip("spread eats profit", question)
            continue

        # ── Kelly sizing ──
        position_usdc = kelly_size(capital, entry_price, ask_price,
                                   kelly_fraction, max_position_pct)
        if position_usdc > capital:
            continue

        shares        = position_usdc / ask_price
        protocol_fee  = position_usdc * fee_rate
        breakeven     = ask_price + fee_rate

        # ── Outcome ──
        op_raw = m.get("outcomePrices") or []
        if isinstance(op_raw, str):
            try:
                op_raw = json.loads(op_raw)
            except (ValueError, TypeError):
                op_raw = []
        try:
            op = [float(x) for x in op_raw]
        except (TypeError, ValueError):
            op = []

        if op and op[0] == 1.0:
            resolution = "YES"
            revenue    = shares * 1.0
            pnl        = revenue - position_usdc - protocol_fee
        else:
            resolution = "NO"
            revenue    = 0.0
            pnl        = -(position_usdc + protocol_fee)

        capital += pnl
        pnl_pct  = (pnl / position_usdc) * 100 if position_usdc > 0 else 0.0

        # ── Guardar trade ──
        trade = {
            "token_id":            token_id_yes,
            "question":            question,
            "status":              "resolved",
            "opened_at":           datetime.fromtimestamp(end_ts - int(hours_to_close * 3600),
                                                          tz=timezone.utc).isoformat(),
            "closes_at":           end_date_str,
            "entry_price":         entry_price,
            "ask_price":           ask_price,
            "spread_entry_pct":    spread,
            "slippage_usdc":       0.0,
            "position_usdc":       position_usdc,
            "shares":              shares,
            "protocol_fee":        protocol_fee,
            "breakeven_price":     breakeven,
            "resolved_at":         end_date_str,
            "resolution":          resolution,
            "revenue_usdc":        revenue,
            "pnl_usdc":            pnl,
            "pnl_pct":             pnl_pct,
            "liquidity_at_entry":  liquidity,
            "volume_24h_at_entry": volume_24h,
            "hours_to_close":      hours_to_close,
            "wash_score":          "ok",
        }
        trades.append(trade)
        insert_trade(conn, run_id, trade)

        print_trade(resolution, question, entry_price, position_usdc, pnl, capital)

    # ── Resumen final ──
    n       = len(trades)
    wins    = sum(1 for t in trades if t["resolution"] == "YES")
    losses  = n - wins
    win_rate = (wins / n) if n > 0 else 0.0
    total_pnl = capital - initial_capital
    total_pnl_pct = (total_pnl / initial_capital) * 100

    spreads    = [t["spread_entry_pct"] for t in trades]
    avg_spread = (sum(spreads) / len(spreads)) if spreads else 0.0
    total_fees = sum(t["protocol_fee"] for t in trades)

    summary = {
        "final_capital":  capital,
        "total_trades":   n,
        "wins":           wins,
        "losses":         losses,
        "win_rate":       win_rate,
        "total_pnl":      total_pnl,
        "total_pnl_pct":  total_pnl_pct,
        "avg_spread_pct": avg_spread,
        "total_fees_paid": total_fees,
    }
    finalize_run(conn, run_id, summary)
    conn.close()

    print_summary(params, capital, trades, stats)
    console.print(f"\n[dim]Resultados guardados en [bold]polyagent.db[/bold] (run_id={run_id})[/dim]\n")


# ─────────────────────────────────────────────
# PAPER TRADING
# ─────────────────────────────────────────────

def fetch_open_markets(min_liquidity: float) -> list:
    """Descarga mercados abiertos ahora mismo de la Gamma API."""
    markets = []
    offset = 0
    limit = 500
    while True:
        params = {
            "active": "true",
            "closed": "false",
            "limit": limit,
            "offset": offset,
            "order": "endDate",
            "ascending": "true",   # los que cierran antes primero
        }
        data = safe_get(GAMMA_API, params)
        if not data:
            break
        batch = data if isinstance(data, list) else data.get("markets", [])
        if not batch:
            break
        for m in batch:
            # Solo binarios con clobTokenIds y volumen
            outcomes_raw = m.get("outcomes", [])
            if isinstance(outcomes_raw, str):
                try: outcomes_raw = json.loads(outcomes_raw)
                except: outcomes_raw = []
            if len(outcomes_raw) != 2:
                continue
            if not m.get("clobTokenIds"):
                continue
            if float(m.get("volume") or 0) < 1000:
                continue
            markets.append(m)
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        offset += limit
        if len(batch) < limit:
            break
    return markets


def resolve_pending_signals(conn: sqlite3.Connection) -> int:
    """
    Para cada señal en estado 'open' cuyo closes_at ya pasó,
    consulta la Gamma API para obtener el outcome real y actualiza el registro.
    Devuelve el número de señales resueltas.
    """
    cur = conn.cursor()
    cur.execute("SELECT id, token_id, question, closes_at, position_usdc, shares, protocol_fee FROM signals WHERE status='open'")
    pending = cur.fetchall()
    if not pending:
        return 0
    resolved_count = 0

    now = datetime.now(timezone.utc)
    console.print(f"\n[cyan]Revisando {len(pending)} señales pendientes de resolución...[/cyan]")

    for row in pending:
        sig_id, token_id, question, closes_at_str, position_usdc, shares, protocol_fee = row
        try:
            closes_dt = datetime.fromisoformat(closes_at_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue

        if closes_dt > now:
            continue  # aún no ha cerrado

        # Buscar el mercado por token_id en la Gamma API
        data = safe_get(GAMMA_API, {"clobTokenIds": token_id})
        if not data:
            # Marcar como expirado si no se puede resolver tras 24h del cierre
            if (now - closes_dt).total_seconds() > 86400:
                cur.execute("UPDATE signals SET status='expired' WHERE id=?", (sig_id,))
                conn.commit()
            continue

        batch = data if isinstance(data, list) else []
        market = None
        for m in batch:
            clob_raw = m.get("clobTokenIds") or []
            if isinstance(clob_raw, str):
                try: clob_raw = json.loads(clob_raw)
                except: clob_raw = []
            if token_id in clob_raw:
                market = m
                break

        if not market:
            continue

        op_raw = market.get("outcomePrices") or []
        if isinstance(op_raw, str):
            try: op_raw = json.loads(op_raw)
            except: op_raw = []
        if len(op_raw) != 2:
            continue

        try:
            op = [float(x) for x in op_raw]
        except (TypeError, ValueError):
            continue

        if op == [1.0, 0.0]:
            outcome = "YES"
            revenue = (shares or 0) * 1.0
            pnl = revenue - (position_usdc or 0) - (protocol_fee or 0)
        elif op == [0.0, 1.0]:
            outcome = "NO"
            revenue = 0.0
            pnl = -((position_usdc or 0) + (protocol_fee or 0))
        else:
            continue  # aún no resuelto limpiamente

        pnl_pct = (pnl / position_usdc * 100) if position_usdc else 0
        icon = "✅" if outcome == "YES" else "❌"
        q_short = (question[:50] + "…") if question and len(question) > 50 else question
        color = "green" if pnl >= 0 else "red"
        pnl_str = f"+${pnl:.2f}" if pnl >= 0 else f"-${abs(pnl):.2f}"
        console.print(f"  {icon}  [bold]{q_short}[/bold]  [{color}]{pnl_str}[/{color}]  (resuelto)")

        cur.execute("""
            UPDATE signals SET outcome=?, resolved_at=?, pnl_usdc=?, pnl_pct=?, status='resolved'
            WHERE id=?
        """, (outcome, now.isoformat(), pnl, pnl_pct, sig_id))
        conn.commit()
        resolved_count += 1
        time.sleep(SLEEP_BETWEEN_REQUESTS)

    return resolved_count


def run_paper(params: dict):
    """
    Modo paper trading: escanea mercados abiertos AHORA, detecta señales
    Bond Hunter y las registra en signals sin ejecutar ninguna orden real.
    También resuelve señales anteriores pendientes.
    """
    min_prob         = params["min_prob"]
    max_prob         = params["max_prob"]
    min_profit_net   = params["min_profit_net"]
    max_hours        = params["max_hours"]
    min_liquidity    = params["min_liquidity"]
    fee_rate         = params["fee_rate"]
    capital          = params["initial_capital"]
    kelly_fraction   = params["kelly_fraction"]
    max_position_pct = params["max_position_pct"]

    import time as _time
    scan_start = _time.time()

    conn = init_db()

    # Insertar registro de scan en curso
    scan_started_at = datetime.now(timezone.utc).isoformat()
    cur_log = conn.cursor()
    cur_log.execute(
        "INSERT INTO scan_log (started_at, mode) VALUES (?, 'paper')",
        (scan_started_at,)
    )
    conn.commit()
    scan_log_id = cur_log.lastrowid

    # Primero resolver señales anteriores pendientes
    resolved_count = resolve_pending_signals(conn)

    # Capital disponible = initial_capital - capital ya comprometido en señales abiertas
    cur_cap = conn.cursor()
    cur_cap.execute("SELECT COALESCE(SUM(position_usdc),0), COUNT(*) FROM signals WHERE status='open'")
    committed_usdc, open_count = cur_cap.fetchone()
    available_capital = max(0.0, capital - committed_usdc)

    MAX_OPEN_SIGNALS = 10  # máximo de posiciones abiertas simultáneas

    if open_count >= MAX_OPEN_SIGNALS:
        console.print(f"\n[yellow]⚠ {open_count} señales abiertas (límite={MAX_OPEN_SIGNALS}). No se abren nuevas posiciones.[/yellow]\n")
        new_signals = 0
        markets = []
    else:
        console.print(f"\n[cyan]Escaneando mercados abiertos en busca de señales...[/cyan]\n")
        console.print(f"[cyan]  Capital disponible: ${available_capital:.2f} (${committed_usdc:.2f} comprometido en {open_count} señales)[/cyan]\n")
        markets = fetch_open_markets(min_liquidity)
        console.print(f"[cyan]  {len(markets)} mercados activos encontrados[/cyan]\n")

    new_signals = 0
    markets_checked = 0
    skipped_wash = 0
    skipped_spread = 0
    skipped_no_data = 0
    skipped_price = 0

    for m in markets:
        question = m.get("question", m.get("title", "Unknown"))

        # Filtros básicos (mercados abiertos: no exigir outcomePrices resuelto)
        ok, token_or_reason, _ = passes_basic_filters(m, min_liquidity, require_resolved=False)
        if not ok:
            continue

        token_id_yes = token_or_reason

        markets_checked += 1

        # Anti-wash
        is_wash, _ = compute_wash_score(m)
        if is_wash:
            skipped_wash += 1
            continue

        # Fechas — mercado debe cerrar dentro de max_hours
        end_date_str = m.get("endDate") or m.get("endDateIso") or ""
        try:
            end_dt = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
            end_ts = int(end_dt.timestamp())
        except ValueError:
            continue

        now_ts = int(datetime.now(timezone.utc).timestamp())
        hours_to_close = (end_ts - now_ts) / 3600.0
        if hours_to_close <= 0 or hours_to_close > max_hours:
            continue

        # Precio actual via CLOB — últimos 10 minutos
        time.sleep(SLEEP_BETWEEN_REQUESTS)
        start_ts = now_ts - 600
        history = fetch_price_series(token_id_yes, start_ts, now_ts)
        if not history:
            skipped_no_data += 1
            continue

        # Precio más reciente
        try:
            current_price = float(history[-1]["p"])
        except (KeyError, TypeError, ValueError):
            continue

        if not (min_prob <= current_price <= max_prob):
            skipped_price += 1
            continue

        # Comprobar que esta señal no existe ya (mismo token_id + aún abierta)
        cur = conn.cursor()
        cur.execute("SELECT id FROM signals WHERE token_id=? AND status='open'", (token_id_yes,))
        if cur.fetchone():
            continue  # ya registrada

        # Respetar límite de posiciones abiertas simultáneas
        if open_count + new_signals >= MAX_OPEN_SIGNALS:
            break

        # Spread y profit
        liquidity_raw = m.get("liquidity")
        liquidity = float(liquidity_raw or 0) if liquidity_raw is not None else None
        if liquidity is None:
            market_spread = float(m.get("spread") or 0.02)
            liquidity = 10000.0 if market_spread < 0.005 else (2000.0 if market_spread < 0.01 else 800.0)

        spread = estimate_spread(liquidity)
        ask_price = min(current_price + spread / 2, 0.999)
        net_profit_pct = (1.0 - ask_price) - fee_rate

        if net_profit_pct < min_profit_net:
            skipped_spread += 1
            continue

        # Kelly sizing sobre capital disponible (no comprometido)
        if available_capital < 5.0:
            break  # sin capital suficiente para abrir más posiciones
        position_usdc = kelly_size(available_capital, current_price, ask_price, kelly_fraction, max_position_pct)
        available_capital -= position_usdc  # descontar para siguientes iteraciones
        shares = position_usdc / ask_price
        protocol_fee = position_usdc * fee_rate
        breakeven = ask_price + fee_rate

        volume_24h = float(m.get("volume24hr") or 0)
        market_url = f"https://polymarket.com/event/{m.get('slug', '')}"

        cur.execute("""
            INSERT INTO signals (
                detected_at, token_id, question, market_url, closes_at,
                hours_to_close, entry_price, ask_price, spread_entry_pct,
                net_profit_pct, position_usdc, shares, protocol_fee,
                breakeven_price, liquidity, volume_24h, wash_score, status
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            datetime.now(timezone.utc).isoformat(),
            token_id_yes, question, market_url,
            end_date_str, hours_to_close,
            current_price, ask_price, spread,
            net_profit_pct, position_usdc, shares, protocol_fee,
            breakeven, liquidity, volume_24h, "ok", "open"
        ))
        conn.commit()
        new_signals += 1

        q_short = (question[:52] + "…") if len(question) > 52 else question.ljust(53)
        console.print(
            f"  🎯  [bold]{q_short}[/bold]  "
            f"[cyan]${current_price:.4f}[/cyan]  "
            f"[yellow]${position_usdc:.2f}[/yellow]  "
            f"cierra en [white]{hours_to_close:.1f}h[/white]  "
            f"net=[green]+{net_profit_pct*100:.2f}%[/green]"
        )

    # Guardar scan_log completo
    finished_at = datetime.now(timezone.utc).isoformat()
    duration_sec = round(_time.time() - scan_start, 1)
    conn.execute("""
        UPDATE scan_log SET
            finished_at=?, duration_sec=?,
            markets_fetched=?, markets_checked=?,
            signals_found=?, signals_resolved=?,
            skipped_wash=?, skipped_spread=?,
            skipped_no_data=?, skipped_price=?
        WHERE id=?
    """, (
        finished_at, duration_sec,
        len(markets), markets_checked,
        new_signals, resolved_count,
        skipped_wash, skipped_spread,
        skipped_no_data, skipped_price,
        scan_log_id,
    ))
    conn.commit()
    conn.close()

    console.print(f"\n[bold]Paper trading scan completo.[/bold]")
    console.print(f"  Mercados descargados:      [cyan]{len(markets)}[/cyan]")
    console.print(f"  Mercados analizados:       [cyan]{markets_checked}[/cyan]")
    console.print(f"  Señales nuevas:            [green]{new_signals}[/green]")
    console.print(f"  Señales resueltas:         [green]{resolved_count}[/green]")
    console.print(f"  Descartados (wash):        [dim]{skipped_wash}[/dim]")
    console.print(f"  Descartados (spread):      [dim]{skipped_spread}[/dim]")
    console.print(f"  Sin datos CLOB:            [dim]{skipped_no_data}[/dim]")
    console.print(f"  Precio fuera de rango:     [dim]{skipped_price}[/dim]")
    console.print(f"  Duración:                  [dim]{duration_sec}s[/dim]")
    console.print(f"  Datos guardados en:        [bold]polyagent.db[/bold] → tabla [bold]signals[/bold]\n")


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def parse_args() -> dict:
    parser = argparse.ArgumentParser(
        description="Polymarket Bond Hunter — Backtesting & Paper Trading"
    )
    parser.add_argument("--mode",      type=str,   default="backtest",         help="backtest | paper")
    parser.add_argument("--days",      type=int,   default=DAYS_BACK,          help="Días hacia atrás (backtest)")
    parser.add_argument("--capital",   type=float, default=INITIAL_CAPITAL,    help="Capital inicial USDC")
    parser.add_argument("--min-prob",  type=float, default=MIN_PROBABILITY,    help="Prob. mínima YES")
    parser.add_argument("--max-prob",  type=float, default=MAX_PROBABILITY,    help="Prob. máxima YES")
    parser.add_argument("--min-profit",type=float, default=MIN_PROFIT_NET,     help="Beneficio neto mín.")
    parser.add_argument("--max-hours", type=float, default=MAX_HOURS_TO_CLOSE, help="Horas máx. al cierre")
    parser.add_argument("--min-liq",   type=float, default=MIN_LIQUIDITY_USDC, help="Liquidez mínima USDC")
    parser.add_argument("--fee-rate",  type=float, default=FEE_RATE,           help="Fee protocolo")
    parser.add_argument("--force",     action="store_true",                    help="Forzar ejecución aunque bot esté disabled")
    args = parser.parse_args()

    return {
        "mode":             args.mode,
        "days_back":        args.days,
        "initial_capital":  args.capital,
        "min_prob":         args.min_prob,
        "max_prob":         args.max_prob,
        "min_profit_net":   args.min_profit,
        "max_hours":        args.max_hours,
        "min_liquidity":    args.min_liq,
        "fee_rate":         args.fee_rate,
        "kelly_fraction":   KELLY_FRACTION,
        "max_position_pct": MAX_POSITION_PCT,
        "force":            args.force,
    }


def load_config_from_db(conn: sqlite3.Connection) -> dict:
    """Lee la configuración guardada en BD. Devuelve defaults si no existe."""
    cur = conn.cursor()
    cur.execute("SELECT * FROM config WHERE id=1")
    row = cur.fetchone()
    if not row:
        return {}
    col = [d[0] for d in cur.description]
    cfg = dict(zip(col, row))
    return {
        "initial_capital":  cfg["initial_capital"],
        "min_prob":         cfg["min_probability"],
        "max_prob":         cfg["max_probability"],
        "min_profit_net":   cfg["min_profit_net"],
        "max_hours":        cfg["max_hours_to_close"],
        "min_liquidity":    cfg["min_liquidity_usdc"],
        "kelly_fraction":   cfg["kelly_fraction"],
        "max_position_pct": cfg["max_position_pct"],
        "fee_rate":         cfg["fee_rate"],
    }


def update_bot_status(conn: sqlite3.Connection, **kwargs):
    """Actualiza campos de bot_status."""
    fields = ", ".join(f"{k}=?" for k in kwargs)
    values = list(kwargs.values())
    conn.execute(f"UPDATE bot_status SET {fields} WHERE id=1", values)
    conn.commit()


def check_bot_enabled(conn: sqlite3.Connection) -> bool:
    cur = conn.cursor()
    cur.execute("SELECT enabled FROM bot_status WHERE id=1")
    row = cur.fetchone()
    return bool(row and row[0])


if __name__ == "__main__":
    import os

    cli_params = parse_args()
    mode = cli_params.get("mode", "backtest")

    # Inicializar BD primero para tener acceso a config y bot_status
    conn_init = init_db()

    if mode == "paper":
        # Verificar si el bot está habilitado (a menos que se fuerce con --force)
        if not check_bot_enabled(conn_init) and not cli_params.get("force"):
            console.print("[yellow]Bot está PARADO (disabled en config). "
                          "Actívalo desde la app o usa --force para forzar.[/yellow]")
            conn_init.close()
            exit(0)

        # Mezclar: CLI tiene precedencia sobre BD, BD tiene precedencia sobre defaults
        db_params = load_config_from_db(conn_init)
        params = {**db_params, **{k: v for k, v in cli_params.items() if k != "mode"}}
        params["mode"] = "paper"

        # Registrar inicio de scan
        now_iso = datetime.now(timezone.utc).isoformat()
        update_bot_status(conn_init,
            pid=os.getpid(),
            last_scan_at=now_iso,
            last_error=None,
        )
        conn_init.close()

        console.rule("[bold green]POLYMARKET BOND HUNTER — PAPER TRADING[/bold green]")
        console.print(f"  Capital referencia: [bold]${params['initial_capital']:.2f}[/bold]  |  "
                      f"Prob. entrada: [bold]{params['min_prob']}-{params['max_prob']}[/bold]  |  "
                      f"Max cierre: [bold]{params['max_hours']}h[/bold]\n")

        try:
            run_paper(params)
            # Incrementar contador de scans
            conn_done = init_db()
            cur = conn_done.cursor()
            cur.execute("UPDATE bot_status SET scan_count = scan_count + 1 WHERE id=1")
            conn_done.commit()
            conn_done.close()
        except Exception as e:
            conn_err = init_db()
            update_bot_status(conn_err, last_error=str(e))
            conn_err.close()
            raise

    else:
        db_params = load_config_from_db(conn_init)
        params = {**db_params, **{k: v for k, v in cli_params.items() if k != "mode"}}
        params["mode"] = "backtest"
        conn_init.close()

        console.rule("[bold yellow]POLYMARKET BOND HUNTER — BACKTEST[/bold yellow]")
        console.print(f"  Capital inicial: [bold]${params['initial_capital']:.2f}[/bold]  |  "
                      f"Período: [bold]{params.get('days_back', DAYS_BACK)} días[/bold]  |  "
                      f"Prob. entrada: [bold]{params['min_prob']}-{params['max_prob']}[/bold]\n")
        run_backtest(params)
