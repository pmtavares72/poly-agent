'use client'
import { useState, useEffect } from 'react'
import type { BotConfig, NegRiskStats } from '@/types'
import { formatUSDC, formatPct } from '@/lib/format'
import { useConfig } from '@/hooks/useConfig'

const PARAM_META: {
  key: keyof BotConfig
  label: string
  hint: string
  step: string
  min?: string
  max?: string
  isToggle?: boolean
}[] = [
  { key: 'nr_enabled',           label: 'ENABLED',              hint: '1 = active, 0 = disabled',                     step: '1', min: '0', max: '1', isToggle: true },
  { key: 'nr_min_gap',           label: 'MIN_GAP',              hint: 'Min net gap after fees to open (e.g. 0.02=2%)', step: '0.005', min: '0', max: '1' },
  { key: 'nr_min_leg_liquidity', label: 'MIN_LEG_LIQUIDITY',    hint: 'Min liquidity per outcome leg ($)',              step: '50', min: '0' },
  { key: 'nr_max_legs',          label: 'MAX_LEGS',             hint: 'Max outcomes per event to consider',            step: '1', min: '2' },
  { key: 'nr_fee_rate',          label: 'FEE_RATE',             hint: 'Estimated protocol fee rate (e.g. 0.02=2%)',    step: '0.005', min: '0', max: '1' },
  { key: 'nr_max_position_usdc', label: 'MAX_POSITION_USDC',    hint: 'Max total USDC per basket ($)',                 step: '10', min: '0' },
]

interface NegRiskHunterCardProps {
  nrStats?: NegRiskStats
}

export function NegRiskHunterCard({ nrStats }: NegRiskHunterCardProps) {
  const { config, isLoading, saveConfig } = useConfig()
  const [local, setLocal] = useState<Partial<BotConfig>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (config && Object.keys(local).length === 0) {
      setLocal(config)
    }
  }, [config])

  function handleChange(key: keyof BotConfig, val: string) {
    setLocal(p => ({ ...p, [key]: parseFloat(val) || 0 }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const { id: _, updated_at: __, ...rest } = local as BotConfig
      await saveConfig(rest)
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
  }

  const isEnabled = Number(local.nr_enabled ?? config?.nr_enabled ?? 1) === 1

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
        background: 'linear-gradient(180deg, rgba(124,58,237,0.08) 0%, transparent 100%)',
      }}>
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6,
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: isEnabled ? 'rgba(124,58,237,0.15)' : 'var(--surface2)',
            color: isEnabled ? '#a78bfa' : 'var(--text3)',
            border: `1px solid ${isEnabled ? 'rgba(124,58,237,0.35)' : 'var(--border)'}`,
            marginBottom: 12,
          }}>
            {isEnabled ? '● Active · Paper Mode' : '○ Disabled'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.01em' }}>
            NegRisk Arb Hunter
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, maxWidth: 460 }}>
            Exploits NegRisk multi-outcome events where the sum of all YES prices is below $1.
            Buys proportional positions across every outcome — one always resolves YES and pays $1,
            locking in a risk-free spread. Sports markets are especially underexplored by other bots.
          </div>
        </div>

        <div className="toggle-wrap" style={{ flexShrink: 0, textAlign: 'right' }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
            color: isEnabled ? '#a78bfa' : 'var(--text3)',
          }}>
            {isEnabled ? 'ACTIVE' : 'DISABLED'}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
            Toggle via ENABLED param below
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="strategy-stats">
        {[
          { value: nrStats ? formatPct(nrStats.win_rate) : '—',          label: 'Win Rate',       accent: '#a78bfa' },
          { value: nrStats ? formatUSDC(nrStats.total_pnl) : '—',        label: 'Total PnL',      accent: 'var(--green)' },
          { value: nrStats ? String(nrStats.total) : '—',                label: 'Total Baskets',  accent: 'var(--text)' },
          { value: nrStats ? formatPct(nrStats.avg_gap_pct, 2) : '—',    label: 'Avg Gap',        accent: '#a78bfa' },
        ].map(({ value, label, accent }) => (
          <div key={label} className="strategy-stat">
            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, marginBottom: 4, color: accent }}>
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
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(124,58,237,0.15)'
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

      {/* Footer */}
      <div className="strategy-footer" style={{
        padding: '18px 28px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg2)',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
          {nrStats ? (
            <>
              <span style={{ color: 'var(--text3)' }}>Open baskets: </span>
              <span style={{ color: 'var(--text)' }}>{nrStats.open}</span>
              {'  ·  '}
              <span style={{ color: 'var(--text3)' }}>Resolved: </span>
              <span style={{ color: 'var(--text)' }}>{nrStats.resolved}</span>
              {'  ·  '}
              <span style={{ color: 'var(--text3)' }}>Wins / Losses: </span>
              <span style={{ color: 'var(--green)' }}>{nrStats.wins}</span>
              {' / '}
              <span style={{ color: 'var(--red)' }}>{nrStats.losses}</span>
            </>
          ) : (
            <span style={{ color: 'var(--text3)' }}>No data yet</span>
          )}
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
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 24px',
              background: saved ? 'rgba(124,58,237,0.15)' : '#7c3aed',
              color: saved ? '#a78bfa' : '#fff',
              border: saved ? '1px solid rgba(124,58,237,0.3)' : 'none',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 13,
              fontWeight: 700, cursor: saving ? 'default' : 'pointer',
              boxShadow: saved ? 'none' : '0 0 20px rgba(124,58,237,0.4)',
              transition: 'all 0.2s',
            }}
          >{saving ? 'Saving...' : saved ? '✓ Saved' : 'Save & Apply'}</button>
        </div>
      </div>
    </div>
  )
}
