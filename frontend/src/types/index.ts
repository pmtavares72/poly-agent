export interface Signal {
  id: number
  status: 'open' | 'resolved' | 'expired'
  outcome: 'YES' | 'NO' | 'RISK_EXIT' | null
  detected_at: string
  resolved_at: string | null
  token_id: string
  question: string
  market_url: string | null
  closes_at: string
  hours_to_close: number
  entry_price: number
  ask_price: number
  spread_entry_pct: number
  net_profit_pct: number
  position_usdc: number
  shares: number
  protocol_fee: number
  breakeven_price: number
  liquidity: number | null
  volume_24h: number | null
  wash_score: string | null
  pnl_usdc: number | null
  pnl_pct: number | null
  // Risk management fields
  stop_loss_price: number | null
  highest_price_seen: number | null
  trailing_stop_price: number | null
  exit_reason: string | null
  current_price: number | null
  last_price_check: string | null
  mode: string | null
  // Live P&L calculations (only from /signals/open/live)
  pnl_if_sell_now?: number | null
  pnl_if_wait?: number | null
  opportunity_cost?: number | null
  can_take_profit?: boolean
}

export interface PnlPoint {
  ts: string
  cumulative_pnl: number
}

export interface Stats {
  base_capital: number
  total_signals: number
  open: number
  resolved: number
  wins: number
  losses: number
  win_rate: number
  total_pnl: number
  avg_spread_pct: number
  best_trade: number
  worst_trade: number
  total_fees: number
  pnl_series: PnlPoint[]
  // Risk exit counters
  risk_exits: number
  stop_losses: number
  trailing_stops: number
  time_exits: number
  manual_tps: number
  manual_sells: number
  // Bot state
  bot_enabled: boolean
  bot_last_scan: string | null
  bot_scan_count: number
  bot_last_error: string | null
  trading_mode: string
  active_strategies: number
  generated_at: string
}

export interface SignalsResponse {
  total: number
  limit: number
  offset: number
  data: Signal[]
}

export interface BotConfig {
  id: number
  initial_capital: number
  min_probability: number
  max_probability: number
  min_profit_net: number
  max_hours_to_close: number
  min_liquidity_usdc: number
  kelly_fraction: number
  max_position_pct: number
  max_capital_deployed_pct: number
  fee_rate: number
  scan_interval_min: number
  updated_at: string | null
}

export interface BotStatus {
  id: number
  enabled: number
  pid: number | null
  pid_alive: boolean
  last_scan_at: string | null
  next_scan_at: string | null
  last_error: string | null
  scan_count: number
  trading_mode: string
  paper_enabled: number
  live_enabled: number
}

export interface SellResponse {
  sold: boolean
  signal_id: number
  exit_reason: string
  sell_price: number
  pnl_usdc: number
  pnl_pct: number
  mode?: string
}

export interface ScanLog {
  id: number
  started_at: string
  finished_at: string | null
  duration_sec: number | null
  markets_fetched: number
  markets_checked: number
  signals_found: number
  signals_resolved: number
  skipped_wash: number
  skipped_spread: number
  skipped_no_data: number
  skipped_price: number
  error: string | null
  mode: string
}

export interface ScanLogsResponse {
  total: number
  limit: number
  offset: number
  data: ScanLog[]
}

export interface Strategy {
  slug: string
  name: string
  type: 'cron' | 'continuous'
  enabled: boolean
  capital: number
  config_json: string
  config: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
  stats?: Record<string, unknown>
}

export interface StrategiesResponse {
  strategies: Strategy[]
}

export interface IfnlSignal {
  id: number
  detected_at: string
  token_id: string
  question: string | null
  market_url: string | null
  direction: 'YES' | 'NO'
  signal_strength: number
  entry_mid: number
  entry_price: number
  exit_price: number | null
  position_usdc: number
  informed_flow: number
  divergence: number
  book_imbalance: number
  tp_target: number
  sl_target: number
  time_limit_min: number
  resolved_at: string | null
  pnl_usdc: number | null
  pnl_pct: number | null
  exit_reason: string | null
  status: 'open' | 'resolved' | 'expired'
}

export interface Credentials {
  configured: boolean
  private_key_masked: string
  funder_address: string
  signature_type: number
  has_api_creds: boolean
  updated_at: string | null
}

export interface CredentialsSaveResponse {
  saved: boolean
  configured: boolean
  private_key_masked: string
  funder_address: string
  signature_type: number
  has_api_creds: boolean
  errors: string[] | null
  updated_at: string
}

export interface CredentialsTestResponse {
  success: boolean
  message: string
  open_orders?: number
}

export interface Run {
  id: number
  started_at: string
  completed_at: string | null
  days_back: number
  initial_capital: number
  final_capital: number
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  total_pnl: number
  total_pnl_pct: number
  avg_spread_pct: number
  total_fees_paid: number
  params_json: string
}
