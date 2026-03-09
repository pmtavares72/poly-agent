'use client'
import { useState } from 'react'
import type { NegRiskSignal, NegRiskStats } from '@/types'
import { formatUSDC, formatPct, timeAgo } from '@/lib/format'
import { KpiCard } from './KpiCard'

interface NegRiskSectionProps {
  signals: NegRiskSignal[]
  stats?: NegRiskStats
}

function statusColor(s: NegRiskSignal) {
  if (s.status === 'open') return 'var(--yellow)'
  if (s.outcome === 'WIN') return 'var(--green)'
  return 'var(--red)'
}

function statusLabel(s: NegRiskSignal) {
  if (s.status === 'open') return 'OPEN'
  if (s.outcome === 'WIN') return 'WIN'
  if (s.outcome === 'LOSS') return 'LOSS'
  return 'EXPIRED'
}

function NegRiskBasketRow({ signal }: { signal: NegRiskSignal }) {
  const [expanded, setExpanded] = useState(false)

  let legs: { token_id: string; question: string; ask: number; weight: number; usdc: number }[] = []
  try { legs = JSON.parse(signal.legs_json) } catch {}

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>#{signal.id}</span>
        </td>
        <td>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
            {timeAgo(signal.detected_at)}
          </div>
        </td>
        <td className="td-question">
          <span>{signal.event_title}</span>
        </td>
        <td>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#a78bfa' }}>{signal.n_legs} legs</span>
        </td>
        <td style={{ color: 'var(--green)' }}>
          {formatPct(signal.gap_pct, 2)}
        </td>
        <td style={{ color: 'var(--green)' }}>
          {formatPct(signal.net_profit_pct, 2)}
        </td>
        <td>{formatUSDC(signal.total_usdc, false)}</td>
        <td style={{ color: signal.pnl_usdc != null ? (signal.pnl_usdc >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' }}>
          {signal.pnl_usdc != null ? formatUSDC(signal.pnl_usdc) : '—'}
        </td>
        <td>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
            padding: '3px 7px', borderRadius: 4,
            background: signal.status === 'open' ? 'rgba(240,180,41,0.12)' : signal.outcome === 'WIN' ? 'rgba(0,232,122,0.12)' : 'rgba(255,71,87,0.12)',
            color: statusColor(signal),
          }}>{statusLabel(signal)}</span>
        </td>
        <td style={{ color: 'var(--text3)', fontSize: 10 }}>{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && legs.length > 0 && (
        <tr>
          <td colSpan={10} style={{ padding: '0 16px 12px', background: 'var(--bg2)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8 }}>
              {legs.map(leg => (
                <div key={leg.token_id} style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8, padding: '6px 10px',
                  fontFamily: 'var(--mono)', fontSize: 9,
                  maxWidth: 240,
                }}>
                  <div style={{ color: 'var(--text2)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {leg.question || leg.token_id.slice(0, 20) + '…'}
                  </div>
                  <div style={{ color: 'var(--text3)' }}>
                    ask <span style={{ color: 'var(--text)' }}>${leg.ask?.toFixed(4)}</span>
                    {'  '}
                    weight <span style={{ color: '#a78bfa' }}>{((leg.weight ?? 0) * 100).toFixed(1)}%</span>
                    {'  '}
                    <span style={{ color: 'var(--yellow)' }}>${leg.usdc?.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function NegRiskSection({ signals, stats }: NegRiskSectionProps) {
  return (
    <div>
      {/* KPI cards */}
      <div className="kpi-grid" style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16, marginBottom: 24,
      }}>
        <KpiCard
          icon="⬡"
          label="Total Capital"
          value={stats ? formatUSDC(500 + stats.total_pnl, false) : '—'}
          delta={stats ? `↑ ${formatUSDC(stats.total_pnl)} PnL` : '—'}
          deltaPositive={(stats?.total_pnl ?? 0) >= 0}
          accent="purple"
        />
        <KpiCard
          icon="◎"
          label="Total PnL"
          value={stats ? formatUSDC(stats.total_pnl) : '—'}
          delta={stats ? `${stats.wins} wins / ${stats.losses} losses` : '—'}
          deltaPositive={(stats?.total_pnl ?? 0) >= 0}
          accent="purple"
        />
        <KpiCard
          icon="◈"
          label="Win Rate"
          value={stats ? formatPct(stats.win_rate) : '—'}
          delta={stats ? `${stats.resolved} resolved` : '—'}
          deltaPositive={false}
          accent="purple"
        />
        <KpiCard
          icon="◉"
          label="Open Baskets"
          value={stats ? String(stats.open) : '—'}
          delta={stats ? `avg gap ${formatPct(stats.avg_gap_pct, 2)}` : '—'}
          deltaPositive={false}
          accent="yellow"
        />
      </div>

      {/* Signals table */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
      {/* Header */}
      <div style={{
        padding: '18px 22px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Arb Baskets</div>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
            padding: '3px 8px', borderRadius: 4,
            background: 'rgba(124,58,237,0.12)', color: '#a78bfa',
            border: '1px solid rgba(124,58,237,0.2)',
          }}>click row to expand legs</span>
        </div>
        {stats && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
            {stats.total} total
          </span>
        )}
      </div>

      {signals.length === 0 ? (
        <div style={{ padding: '32px 22px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>
          No NegRisk baskets yet — will appear after next scan
        </div>
      ) : (
        <div style={{ maxHeight: 440, overflowY: 'auto' }}>
          <table className="signals-table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
              <tr>
                <th>#</th>
                <th>Detected</th>
                <th>Event</th>
                <th>Legs</th>
                <th>Gap %</th>
                <th>Net %</th>
                <th>Total</th>
                <th>PnL</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => <NegRiskBasketRow key={s.id} signal={s} />)}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  )
}
