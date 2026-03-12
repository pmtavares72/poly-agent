'use client'
import { useState, useEffect } from 'react'
import type { Stats, BotConfig } from '@/types'
import { formatUSDC, formatPct } from '@/lib/format'
import { useConfig } from '@/hooks/useConfig'
import { useStrategy } from '@/hooks/useStrategies'
import { updateStrategyConfig } from '@/lib/api'

const PARAM_META: {
  key: keyof Omit<BotConfig, 'id' | 'updated_at' | 'scan_interval_min'>
  label: string
  hint: string
  step: string
  min?: string
  max?: string
}[] = [
  { key: 'initial_capital',    label: 'INITIAL_CAPITAL',    hint: 'Starting capital in USDC ($)',  step: '10', min: '0' },
  { key: 'min_probability',    label: 'MIN_PROBABILITY',    hint: 'Min YES price to enter',        step: '0.01', min: '0', max: '1' },
  { key: 'max_probability',    label: 'MAX_PROBABILITY',    hint: 'Max YES (avoid resolved)',       step: '0.001', min: '0', max: '1' },
  { key: 'min_profit_net',     label: 'MIN_PROFIT_NET',     hint: 'Min net profit after fees (%)', step: '0.001' },
  { key: 'max_hours_to_close', label: 'MAX_HOURS_TO_CLOSE', hint: 'Max hours until market close',  step: '1' },
  { key: 'min_liquidity_usdc', label: 'MIN_LIQUIDITY_USDC', hint: 'Min market liquidity ($)',      step: '100', min: '0' },
  { key: 'kelly_fraction',              label: 'KELLY_FRACTION',              hint: 'Conservative Kelly multiplier',         step: '0.05',  min: '0', max: '1' },
  { key: 'max_position_pct',            label: 'MAX_POSITION_PCT',            hint: 'Max % of capital per single trade',     step: '0.01',  min: '0', max: '1' },
  { key: 'max_capital_deployed_pct',    label: 'MAX_CAPITAL_DEPLOYED_PCT',    hint: 'Max % of capital in open positions',    step: '0.05',  min: '0', max: '1' },
  { key: 'fee_rate',                    label: 'FEE_RATE',                    hint: 'Protocol fee estimate',                 step: '0.001', min: '0', max: '1' },
]

const RISK_PARAM_META: {
  key: string
  label: string
  hint: string
  step: string
  min?: string
  max?: string
  type: 'number' | 'toggle'
}[] = [
  { key: 'stop_loss_enabled',         label: 'STOP_LOSS',            hint: 'Enable automatic stop-loss',            step: '', type: 'toggle' },
  { key: 'stop_loss_multiplier',      label: 'SL_MULTIPLIER',        hint: 'Stop = entry - (X × expected profit)', step: '0.5', min: '1', max: '5', type: 'number' },
  { key: 'trailing_stop_enabled',     label: 'TRAILING_STOP',        hint: 'Enable trailing stop',                  step: '', type: 'toggle' },
  { key: 'trailing_stop_activation',  label: 'TRAIL_ACTIVATION',     hint: 'Activate when +X above entry',          step: '0.005', min: '0', max: '0.1', type: 'number' },
  { key: 'trailing_stop_distance',    label: 'TRAIL_DISTANCE',       hint: 'Trail X below highest seen',            step: '0.01', min: '0.01', max: '0.2', type: 'number' },
  { key: 'time_exit_enabled',         label: 'TIME_EXIT',            hint: 'Enable time-based exit',                step: '', type: 'toggle' },
  { key: 'time_exit_hours',           label: 'TIME_EXIT_HOURS',      hint: 'Sell if <X hours to close & in loss',   step: '0.5', min: '0.5', max: '12', type: 'number' },
  { key: 'order_fill_timeout_min',    label: 'FILL_TIMEOUT',         hint: 'Cancel unfilled orders after X min',    step: '5', min: '5', max: '120', type: 'number' },
]

interface BondHunterCardProps {
  stats?: Stats
}

export function BondHunterCard({ stats }: BondHunterCardProps) {
  const { config, isLoading, saveConfig } = useConfig()
  const { strategy, mutate: mutateStrategy } = useStrategy('bond_hunter')
  const [local, setLocal] = useState<Partial<BotConfig>>({})
  const [riskLocal, setRiskLocal] = useState<Record<string, number | boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Sync local state when config loads
  useEffect(() => {
    if (config && Object.keys(local).length === 0) {
      setLocal(config)
    }
  }, [config])

  // Sync risk params when strategy config loads
  useEffect(() => {
    if (strategy?.config && Object.keys(riskLocal).length === 0) {
      const rc: Record<string, number | boolean> = {}
      for (const p of RISK_PARAM_META) {
        const val = (strategy.config as Record<string, unknown>)[p.key]
        rc[p.key] = val as number | boolean
      }
      setRiskLocal(rc)
    }
  }, [strategy])

  function handleChange(key: keyof BotConfig, val: string) {
    setLocal(p => ({ ...p, [key]: parseFloat(val) || 0 }))
  }

  function handleRiskChange(key: string, val: string | boolean) {
    setRiskLocal(p => ({ ...p, [key]: typeof val === 'boolean' ? val : (parseFloat(val) || 0) }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      // Save legacy config params
      const { id: _, updated_at: __, ...rest } = local as BotConfig
      await saveConfig(rest)
      // Save risk management params to strategy config
      await updateStrategyConfig('bond_hunter', riskLocal)
      await mutateStrategy()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (config) setLocal(config)
    if (strategy?.config) {
      const rc: Record<string, number | boolean> = {}
      for (const p of RISK_PARAM_META) {
        rc[p.key] = (strategy.config as Record<string, unknown>)[p.key] as number | boolean
      }
      setRiskLocal(rc)
    }
  }

  const activeEnabled = Boolean(stats?.bot_enabled)

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 20,
    }}>
      {/* Header */}
      <div className="strategy-card-header" style={{
        padding: '24px 28px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        background: 'linear-gradient(180deg, var(--bg2) 0%, transparent 100%)',
      }}>
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6,
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: activeEnabled ? 'var(--green-dim)' : 'var(--surface2)',
            color: activeEnabled ? 'var(--green)' : 'var(--text3)',
            border: `1px solid ${activeEnabled ? 'rgba(0,232,122,0.25)' : 'var(--border)'}`,
            marginBottom: 12,
          }}>
            {activeEnabled ? '● Live · Paper Mode' : '○ Stopped'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
            Bond Hunter
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, maxWidth: 460 }}>
            Targets near-certain prediction market outcomes by entering when YES token price is in the
            0.95–0.995 range with &lt;48h to close. Simulates a short-term bond: high probability,
            small but consistent returns.
          </div>
        </div>

        {/* Status badge */}
        <div className="toggle-wrap" style={{ flexShrink: 0 }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
            color: activeEnabled ? 'var(--green)' : 'var(--text3)',
            textAlign: 'right',
          }}>
            {activeEnabled ? 'ACTIVE' : 'STOPPED'}
          </div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)',
            textAlign: 'right', marginTop: 2,
          }}>Control from Dashboard</div>
        </div>
      </div>

      {/* Stats */}
      <div className="strategy-stats">
        {[
          { value: stats ? formatPct(stats.win_rate) : '—', label: 'Win Rate', green: true },
          { value: stats ? formatUSDC(stats.total_pnl) : '—', label: 'Total PnL', green: true },
          { value: stats ? String(stats.total_signals) : '—', label: 'Total Signals', green: false },
          { value: stats ? formatPct(stats.avg_spread_pct, 2) : '—', label: 'Avg Spread', green: false },
          { value: stats ? String(stats.stop_losses ?? 0) : '—', label: 'Stop Losses', green: false },
          { value: stats ? String(stats.trailing_stops ?? 0) : '—', label: 'Trail Stops', green: false },
        ].map(({ value, label, green }) => (
          <div key={label} className="strategy-stat">
            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, marginBottom: 4, color: green ? 'var(--green)' : 'var(--text)' }}>
              {value}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)' }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Params header */}
      <div style={{ padding: '20px 28px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Strategy Parameters</div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em' }}>
            · changes apply on next scan
          </span>
        </div>
      </div>

      {/* Params grid */}
      <div className="params-grid">
        {isLoading ? (
          <div style={{ padding: 24, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', gridColumn: '1/-1' }}>
            Loading config...
          </div>
        ) : (
          PARAM_META.map(({ key, label, hint, step, min, max }) => (
            <div key={key} className="param-item">
              <div className="param-label" style={{
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10,
              }}>{label}</div>
              <input
                type="number"
                value={(local[key] as number) ?? ''}
                step={step}
                min={min}
                max={max}
                onChange={e => handleChange(key, e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg)',
                  border: '1px solid var(--border2)', borderRadius: 8,
                  padding: '9px 12px', color: 'var(--text)',
                  fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--green)'
                  e.currentTarget.style.boxShadow = '0 0 0 2px var(--green-dim)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--border2)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 5 }}>{hint}</div>
            </div>
          ))
        )}
      </div>

      {/* Risk Management Section */}
      <div style={{ padding: '20px 28px 16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Risk Management</div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--red)', letterSpacing: '0.08em' }}>
            · automatic protection
          </span>
        </div>
      </div>

      <div className="params-grid">
        {RISK_PARAM_META.map(({ key, label, hint, step, min, max, type }) => (
          <div key={key} className="param-item">
            <div className="param-label" style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10,
            }}>{label}</div>
            {type === 'toggle' ? (
              <button
                onClick={() => handleRiskChange(key, !riskLocal[key])}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: `1px solid ${riskLocal[key] ? 'rgba(0,232,122,0.3)' : 'var(--border2)'}`,
                  background: riskLocal[key] ? 'rgba(0,232,122,0.1)' : 'var(--bg)',
                  color: riskLocal[key] ? 'var(--green)' : 'var(--text3)',
                  fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {riskLocal[key] ? 'ON' : 'OFF'}
              </button>
            ) : (
              <input
                type="number"
                value={(riskLocal[key] as number) ?? ''}
                step={step}
                min={min}
                max={max}
                onChange={e => handleRiskChange(key, e.target.value)}
                style={{
                  width: '100%', background: 'var(--bg)',
                  border: '1px solid var(--border2)', borderRadius: 8,
                  padding: '9px 12px', color: 'var(--text)',
                  fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--green)'
                  e.currentTarget.style.boxShadow = '0 0 0 2px var(--green-dim)'
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--border2)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
            )}
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 5 }}>{hint}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="strategy-footer" style={{
        padding: '18px 28px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg2)',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
          {config?.updated_at
            ? <>Last saved: <span style={{ color: 'var(--text)' }}>{new Date(config.updated_at).toLocaleString()}</span></>
            : 'Not saved yet'
          }
          <br />
          <span style={{ color: 'var(--text3)' }}>
            Scan interval: every {config?.scan_interval_min ?? 15} min · cron: */{config?.scan_interval_min ?? 15} * * * *
          </span>
        </div>

        {saveError && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)' }}>⚠ {saveError}</div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '10px 18px', background: 'transparent',
              color: 'var(--text2)', border: '1px solid var(--border2)',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 12,
              cursor: 'pointer', transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text2)')}
          >Reset</button>

          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px',
              background: saved ? 'var(--green-dim)' : 'var(--green)',
              color: saved ? 'var(--green)' : '#000',
              border: saved ? '1px solid rgba(0,232,122,0.3)' : 'none',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 13,
              fontWeight: 700, cursor: saving ? 'default' : 'pointer',
              boxShadow: saved ? 'none' : '0 0 20px var(--green-glow)',
              transition: 'all 0.2s',
            }}
          >{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save & Apply'}</button>
        </div>
      </div>
    </div>
  )
}
