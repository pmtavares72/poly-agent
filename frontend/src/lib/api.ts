import type { Stats, SignalsResponse, Signal, Run, BotConfig, BotStatus, ScanLogsResponse, StrategiesResponse, Strategy, Credentials, CredentialsSaveResponse, CredentialsTestResponse, SellResponse } from '@/types'

const BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`)
  return res.json()
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `API error ${res.status}`)
  }
  return res.json()
}

// Stats
export const fetchStats = (mode?: string) =>
  get<Stats>(mode ? `/stats?mode=${mode}` : '/stats')

// Signals
export const fetchSignals = (params?: { status?: string; limit?: number; offset?: number; mode?: string }) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.mode) q.set('mode', params.mode)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  if (params?.offset !== undefined) q.set('offset', String(params.offset))
  const qs = q.toString()
  return get<SignalsResponse>(`/signals${qs ? `?${qs}` : ''}`)
}
export const fetchOpenSignals     = () => get<SignalsResponse>('/signals/open')
export const fetchResolvedSignals = () => get<SignalsResponse>('/signals/resolved')
export const fetchSignal          = (id: number) => get<Signal>(`/signals/${id}`)

// Runs
export const fetchRuns = () => get<{ total: number; data: Run[] }>('/runs')
export const fetchRun  = (id: number) => get<Run>(`/runs/${id}`)

// Scan logs
export const fetchScanLogs = (limit = 50) =>
  get<ScanLogsResponse>(`/scan-logs?limit=${limit}`)

// Config
export const fetchConfig  = () => get<BotConfig>('/config')
export const updateConfig = (cfg: Partial<Omit<BotConfig, 'id' | 'updated_at'>>) =>
  post<BotConfig>('/config', cfg)

// Bot control
export const fetchBotStatus = () => get<BotStatus>('/bot')
export const enableBot      = () => post<{ enabled: boolean; message: string }>('/bot/enable')
export const disableBot     = () => post<{ enabled: boolean; message: string }>('/bot/disable')
export const scanNow        = () => post<{ triggered: boolean; pid: number; message: string }>('/bot/scan-now')

// Strategies
export const fetchStrategies       = () => get<StrategiesResponse>('/strategies')
export const fetchStrategy         = (slug: string) => get<Strategy>(`/strategies/${slug}`)
export const updateStrategyConfig  = (slug: string, config: Record<string, unknown>) =>
  post<{ slug: string; config: Record<string, unknown> }>(`/strategies/${slug}/config`, config)
export const enableStrategy        = (slug: string) => post<{ slug: string; enabled: boolean }>(`/strategies/${slug}/enable`)
export const disableStrategy       = (slug: string) => post<{ slug: string; enabled: boolean }>(`/strategies/${slug}/disable`)
export const strategyScanNow       = (slug: string) =>
  post<{ triggered: boolean; pid: number; strategy: string }>(`/strategies/${slug}/scan-now`)
export const fetchStrategySignals  = (slug: string, params?: { status?: string; limit?: number; offset?: number }) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  if (params?.offset !== undefined) q.set('offset', String(params.offset))
  const qs = q.toString()
  return get<SignalsResponse>(`/strategies/${slug}/signals${qs ? `?${qs}` : ''}`)
}
export const fetchStrategyStats    = (slug: string) => get<Record<string, unknown>>(`/strategies/${slug}/stats`)
export const fetchStrategyActivity = (slug: string) => get<Record<string, unknown>>(`/strategies/${slug}/activity`)

// Credentials / Settings
export const fetchCredentials     = () => get<Credentials>('/settings/credentials')
export const saveCredentials      = (data: { private_key?: string; signature_type?: number }) =>
  post<CredentialsSaveResponse>('/settings/credentials', data)
export const testCredentials      = () => post<CredentialsTestResponse>('/settings/credentials/test')
export const fetchTradingMode     = () => get<{ mode: string }>('/trading-mode')

// Live signals with real-time prices
export const fetchOpenSignalsLive = (mode?: string) =>
  get<{ total: number; data: Signal[] }>(mode ? `/signals/open/live?mode=${mode}` : '/signals/open/live')

// Manual sell actions
export const sellSignal      = (id: number, reason: string) =>
  post<SellResponse>(`/signals/${id}/sell`, { reason })
export const sellSignalPaper = (id: number, reason: string) =>
  post<SellResponse>(`/signals/${id}/sell-paper`, { reason })
export const claimSignal     = (id: number) =>
  post<SellResponse>(`/signals/${id}/claim`)

// Mode switching (legacy)
export const setTradingMode = (mode: string) =>
  post<{ mode: string; message: string }>('/bot/mode', { mode })

// Independent mode toggles
export const togglePaperMode = (enabled: boolean) =>
  post<{ mode: string; enabled: boolean }>('/bot/paper', { enabled })
export const toggleLiveMode = (enabled: boolean) =>
  post<{ mode: string; enabled: boolean }>('/bot/live', { enabled })

