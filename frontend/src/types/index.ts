export interface Signal {
  id: number
  status: 'open' | 'resolved' | 'expired'
  outcome: 'YES' | 'NO' | null
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
  bot_enabled: boolean
  bot_last_scan: string | null
  bot_scan_count: number
  bot_last_error: string | null
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
