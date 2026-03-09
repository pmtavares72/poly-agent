'use client'
import { useState, useEffect } from 'react'
import type { Strategy } from '@/types'
import { useStrategy } from '@/hooks/useStrategies'
import { updateStrategyConfig, enableStrategy, disableStrategy } from '@/lib/api'

const PARAM_META: {
  key: string
  label: string
  hint: string
  step: string
  min?: string
  max?: string
  section: string
}[] = [
  // Market Selection
  { key: 'min_24h_volume',             label: 'MIN_24H_VOLUME',             hint: 'Min 24h volume ($)',             step: '1000',  min: '0', section: 'Market Selection' },
  { key: 'min_open_interest',          label: 'MIN_OPEN_INTEREST',          hint: 'Min open interest ($)',          step: '1000',  min: '0', section: 'Market Selection' },
  { key: 'max_spread_bps',             label: 'MAX_SPREAD_BPS',             hint: 'Max spread (basis points)',      step: '10',    min: '0', section: 'Market Selection' },
  { key: 'max_monitored_markets',      label: 'MAX_MONITORED_MARKETS',      hint: 'Max markets to monitor',        step: '1',     min: '1', max: '50', section: 'Market Selection' },
  // Signal Thresholds
  { key: 'min_signal_to_enter',        label: 'MIN_SIGNAL_TO_ENTER',        hint: 'Min signal strength (0-1)',      step: '0.01',  min: '0', max: '1', section: 'Signal Thresholds' },
  { key: 'min_divergence_bps',         label: 'MIN_DIVERGENCE_BPS',         hint: 'Min divergence (bps)',           step: '1',     min: '0', section: 'Signal Thresholds' },
  { key: 'min_active_informed_wallets', label: 'MIN_INFORMED_WALLETS',      hint: 'Min active informed wallets',    step: '1',     min: '1', section: 'Signal Thresholds' },
  { key: 'min_informed_score',         label: 'MIN_INFORMED_SCORE',         hint: 'Min wallet informed score',      step: '0.05',  min: '0', max: '1', section: 'Signal Thresholds' },
  // Position Sizing
  { key: 'base_position_pct',          label: 'BASE_POSITION_PCT',          hint: 'Base position size (%)',         step: '0.01',  min: '0', max: '1', section: 'Position Sizing' },
  { key: 'max_position_pct',           label: 'MAX_POSITION_PCT',           hint: 'Max position per trade (%)',     step: '0.01',  min: '0', max: '1', section: 'Position Sizing' },
  { key: 'max_total_deployed_pct',     label: 'MAX_TOTAL_DEPLOYED_PCT',     hint: 'Max capital deployed (%)',       step: '0.05',  min: '0', max: '1', section: 'Position Sizing' },
  // Exit Rules
  { key: 'tp_capture_ratio',           label: 'TP_CAPTURE_RATIO',           hint: 'Take profit ratio',             step: '0.05',  min: '0', max: '1', section: 'Exit Rules' },
  { key: 'hard_stop_bps',              label: 'HARD_STOP_BPS',              hint: 'Hard stop loss (bps)',           step: '1',     min: '0', section: 'Exit Rules' },
  { key: 'max_hold_minutes',           label: 'MAX_HOLD_MINUTES',           hint: 'Max hold time (min)',            step: '1',     min: '1', section: 'Exit Rules' },
  { key: 'market_cooldown_after_stop_min', label: 'COOLDOWN_AFTER_STOP',    hint: 'Cooldown after stop (min)',      step: '1',     min: '0', section: 'Exit Rules' },
  // IFS Parameters
  { key: 'ifs_k1',                     label: 'IFS_K1',                     hint: 'Short-window IFS weight',       step: '0.05',  min: '0', max: '1', section: 'IFS Parameters' },
  { key: 'ifs_k2',                     label: 'IFS_K2',                     hint: 'Long-window IFS weight',        step: '0.05',  min: '0', max: '1', section: 'IFS Parameters' },
]

export function IfnlLiteCard() {
  const { strategy, mutate } = useStrategy('ifnl_lite')
  const [local, setLocal] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  // Sync local state when strategy config loads
  useEffect(() => {
    if (strategy?.config && Object.keys(local).length === 0) {
      const numConfig: Record<string, number> = {}
      for (const [k, v] of Object.entries(strategy.config)) {
        numConfig[k] = Number(v) || 0
      }
      setLocal(numConfig)
    }
  }, [strategy])

  function handleChange(key: string, val: string) {
    setLocal(p => ({ ...p, [key]: parseFloat(val) || 0 }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await updateStrategyConfig('ifnl_lite', local)
      mutate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (strategy?.config) {
      const numConfig: Record<string, number> = {}
      for (const [k, v] of Object.entries(strategy.config)) {
        numConfig[k] = Number(v) || 0
      }
      setLocal(numConfig)
    }
  }

  async function handleToggle() {
    if (!strategy) return
    setToggling(true)
    try {
      if (strategy.enabled) {
        await disableStrategy('ifnl_lite')
      } else {
        await enableStrategy('ifnl_lite')
      }
      mutate()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setToggling(false)
    }
  }

  const isEnabled = strategy?.enabled ?? false
  const stats = strategy?.stats as Record<string, unknown> | undefined

  // Group params by section
  const sections = PARAM_META.reduce<Record<string, typeof PARAM_META>>((acc, p) => {
    ;(acc[p.section] ??= []).push(p)
    return acc
  }, {})

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 20,
    }}>
      {/* Header */}
      <div style={{
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
            background: isEnabled ? 'rgba(139, 92, 246, 0.15)' : 'var(--surface2)',
            color: isEnabled ? '#a78bfa' : 'var(--text3)',
            border: `1px solid ${isEnabled ? 'rgba(139, 92, 246, 0.3)' : 'var(--border)'}`,
            marginBottom: 12,
          }}>
            {isEnabled ? '● Running · Continuous' : '○ Stopped'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
            IFNL-Lite
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, maxWidth: 520 }}>
            Informed Flow vs Non-Informative Liquidity — Detects divergence between informed
            trade flow and price movement using WebSocket real-time data + offline wallet profiling.
            Continuous strategy with 5–20 minute holding periods.
          </div>
        </div>

        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <button
            onClick={handleToggle}
            disabled={toggling}
            style={{
              padding: '8px 18px',
              background: isEnabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(139, 92, 246, 0.15)',
              color: isEnabled ? '#ef4444' : '#a78bfa',
              border: `1px solid ${isEnabled ? 'rgba(239, 68, 68, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
              borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11,
              fontWeight: 600, cursor: toggling ? 'default' : 'pointer',
              transition: 'all 0.2s', letterSpacing: '0.05em',
            }}
          >
            {toggling ? '...' : isEnabled ? 'STOP' : 'START'}
          </button>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)',
            marginTop: 6,
          }}>
            type: continuous · paper mode
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="strategy-stats">
        {[
          { value: stats?.win_rate != null ? `${stats.win_rate}%` : '—', label: 'Win Rate', accent: true },
          { value: stats?.total_pnl != null ? `$${Number(stats.total_pnl).toFixed(2)}` : '—', label: 'Total PnL', accent: true },
          { value: stats?.total_signals != null ? String(stats.total_signals) : '—', label: 'Signals', accent: false },
          { value: stats?.tracked_wallets != null ? String(stats.tracked_wallets) : '—', label: 'Wallets', accent: false },
          { value: stats?.informed_wallets != null ? String(stats.informed_wallets) : '—', label: 'Informed', accent: false },
          { value: stats?.avg_hold_minutes != null ? `${Number(stats.avg_hold_minutes).toFixed(0)}m` : '—', label: 'Avg Hold', accent: false },
        ].map(({ value, label, accent }) => (
          <div key={label} className="strategy-stat">
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 18, marginBottom: 4,
              color: accent ? '#a78bfa' : 'var(--text)',
            }}>
              {value}
            </div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: 'var(--text3)',
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Params by section */}
      {Object.entries(sections).map(([section, params]) => (
        <div key={section}>
          <div style={{ padding: '16px 28px 12px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
              {section}
            </div>
          </div>
          <div className="params-grid">
            {params.map(({ key, label, hint, step, min, max }) => (
              <div key={key} className="param-item">
                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em',
                  textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10,
                }}>{label}</div>
                <input
                  type="number"
                  value={local[key] ?? ''}
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
                    e.currentTarget.style.borderColor = '#a78bfa'
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(139,92,246,0.2)'
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = 'var(--border2)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                />
                <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 5 }}>
                  {hint}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Footer */}
      <div style={{
        padding: '18px 28px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg2)',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
          Capital: <span style={{ color: 'var(--text)' }}>${strategy?.capital?.toFixed(2) ?? '0.00'}</span>
          <br />
          <span style={{ color: 'var(--text3)' }}>
            WebSocket + REST polling · ~15s wallet identification delay
          </span>
        </div>

        {saveError && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)' }}>
            {saveError}
          </div>
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
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px',
              background: saved ? 'rgba(139,92,246,0.15)' : '#7c3aed',
              color: saved ? '#a78bfa' : '#fff',
              border: saved ? '1px solid rgba(139,92,246,0.3)' : 'none',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 13,
              fontWeight: 700, cursor: saving ? 'default' : 'pointer',
              boxShadow: saved ? 'none' : '0 0 20px rgba(124,58,237,0.3)',
              transition: 'all 0.2s',
            }}
          >{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save & Apply'}</button>
        </div>
      </div>
    </div>
  )
}
