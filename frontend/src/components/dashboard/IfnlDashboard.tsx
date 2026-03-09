'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useStrategy, useStrategySignals, useStrategyStats, useStrategyActivity } from '@/hooks/useStrategies'
import { enableStrategy, disableStrategy } from '@/lib/api'
import { KpiCard } from './KpiCard'
import { Badge } from '@/components/ui/Badge'
import { formatUSDC, timeAgo } from '@/lib/format'
import type { IfnlSignal, PnlPoint } from '@/types'

const PnlChart = dynamic(
  () => import('@/components/dashboard/PnlChart').then(m => ({ default: m.PnlChart })),
  { ssr: false }
)

function IfnlSignalCard({ signal }: { signal: IfnlSignal }) {
  const dirColor = signal.direction === 'YES' ? 'var(--green)' : 'var(--red)'
  const strengthPct = (signal.signal_strength * 100).toFixed(0)

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px 18px',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
          color: dirColor, letterSpacing: '0.08em',
        }}>
          {signal.direction} · {strengthPct}% strength
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
          {timeAgo(signal.detected_at)}
        </div>
      </div>

      <div style={{
        fontSize: 11, color: 'var(--text)', marginBottom: 10,
        lineHeight: 1.4, maxHeight: 30, overflow: 'hidden',
      }}>
        {signal.question || signal.token_id.slice(0, 16) + '...'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { label: 'Entry', value: `$${signal.entry_price.toFixed(4)}` },
          { label: 'Size', value: `$${signal.position_usdc.toFixed(0)}` },
          { label: 'Divergence', value: `${signal.divergence.toFixed(0)} bps` },
          { label: 'Imbalance', value: signal.book_imbalance.toFixed(2) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', marginTop: 2 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {signal.tp_target && signal.sl_target && (
        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', gap: 16, fontFamily: 'var(--mono)', fontSize: 9,
        }}>
          <span style={{ color: 'var(--green)' }}>TP {signal.tp_target.toFixed(4)}</span>
          <span style={{ color: 'var(--red)' }}>SL {signal.sl_target.toFixed(4)}</span>
          <span style={{ color: 'var(--text3)' }}>Max {signal.time_limit_min}m</span>
        </div>
      )}
    </div>
  )
}

function IfnlSignalsTable({ signals }: { signals: IfnlSignal[] }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        padding: '18px 22px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Recent IFNL Signals</div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
          {signals.length} signals
        </span>
      </div>

      <div style={{ maxHeight: 484, overflowY: 'auto' }}>
        <table className="signals-table">
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
            <tr>
              <th>#</th>
              <th>Detected</th>
              <th>Direction</th>
              <th>Strength</th>
              <th>Entry</th>
              <th>Size</th>
              <th>Divergence</th>
              <th>PnL</th>
              <th>Exit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {signals.map(s => (
              <tr key={s.id}>
                <td><span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>#{s.id}</span></td>
                <td>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                    {new Date(s.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}
                    {new Date(s.detected_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
                    {timeAgo(s.detected_at)}
                  </div>
                </td>
                <td style={{ color: s.direction === 'YES' ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
                  {s.direction}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {(s.signal_strength * 100).toFixed(0)}%
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>${s.entry_price.toFixed(4)}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>${s.position_usdc.toFixed(0)}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s.divergence.toFixed(0)} bps</td>
                <td style={{
                  fontFamily: 'var(--mono)', fontSize: 11,
                  color: s.pnl_usdc != null ? (s.pnl_usdc >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)',
                }}>
                  {s.pnl_usdc != null ? formatUSDC(s.pnl_usdc) : '—'}
                </td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                  {s.exit_reason || '—'}
                </td>
                <td>
                  {s.status === 'open' ? (
                    <Badge variant="open" />
                  ) : s.pnl_usdc != null && s.pnl_usdc >= 0 ? (
                    <Badge variant="win" />
                  ) : (
                    <Badge variant="loss" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function IfnlActivityPanel({ activity }: { activity: Record<string, unknown> }) {
  const running = Boolean(activity.running)
  const uptime = Number(activity.uptime_seconds ?? 0)
  const wsConnected = Boolean(activity.ws_connected)
  const markets = Number(activity.markets_monitored ?? 0)
  const trades = Number(activity.trades_captured ?? 0)
  const wallets = Number(activity.unique_wallets_seen ?? 0)
  const signals = Number(activity.signals_generated ?? 0)
  const flows = Number(activity.active_flow_entries ?? 0)
  const books = Number(activity.book_states ?? 0)
  const stale = Boolean(activity.possibly_stale)
  const marketNames = (activity.market_names ?? []) as string[]

  const items: { label: string; value: string; status: 'ok' | 'warn' | 'off' }[] = [
    { label: 'Process', value: running ? 'Running' : 'Stopped', status: running ? 'ok' : 'off' },
    { label: 'Uptime', value: formatUptime(uptime), status: running ? 'ok' : 'off' },
    { label: 'WebSocket', value: wsConnected ? 'Connected' : 'Disconnected', status: wsConnected ? 'ok' : 'warn' },
    { label: 'Markets', value: `${markets} monitored`, status: markets > 0 ? 'ok' : 'warn' },
    { label: 'Book States', value: String(books), status: books > 0 ? 'ok' : 'warn' },
    { label: 'Trades Captured', value: String(trades), status: trades > 0 ? 'ok' : 'warn' },
    { label: 'Wallets Seen', value: String(wallets), status: wallets > 0 ? 'ok' : 'warn' },
    { label: 'Flow Entries', value: String(flows), status: flows > 0 ? 'ok' : 'off' },
    { label: 'Signals Generated', value: String(signals), status: signals > 0 ? 'ok' : 'off' },
  ]

  const statusColors = { ok: '#00e87a', warn: '#f0b429', off: 'var(--text3)' }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '18px 22px',
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          Engine Activity
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {stale && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 9, color: '#f0b429',
              padding: '2px 6px', borderRadius: 4,
              background: 'rgba(240,180,41,0.1)',
              border: '1px solid rgba(240,180,41,0.2)',
            }}>STALE</span>
          )}
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: running ? '#00e87a' : 'var(--text3)',
            letterSpacing: '0.06em',
          }}>
            {running ? '● LIVE' : '○ OFFLINE'}
          </span>
        </div>
      </div>

      {/* Status grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
        gap: 10,
        marginBottom: marketNames.length > 0 ? 16 : 0,
      }}>
        {items.map(({ label, value, status }) => (
          <div key={label} style={{
            background: 'var(--surface2)',
            borderRadius: 8,
            padding: '10px 12px',
            border: '1px solid var(--border)',
          }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text3)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4,
            }}>
              {label}
            </div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
              color: statusColors[status],
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Monitored markets */}
      {marketNames.length > 0 && (
        <div>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
          }}>
            Monitored Markets
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {marketNames.map((name, i) => (
              <span key={i} style={{
                fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text2)',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                padding: '3px 8px',
                maxWidth: 280,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {name.length > 55 ? name.slice(0, 55) + '...' : name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function IfnlDashboard() {
  const { strategy, mutate: mutateStrategy } = useStrategy('ifnl_lite')
  const { stats, isLoading: statsLoading } = useStrategyStats('ifnl_lite')
  const { activity } = useStrategyActivity('ifnl_lite')
  const { signals: openSignals } = useStrategySignals('ifnl_lite', { status: 'open', limit: 20 })
  const { signals: recentSignals } = useStrategySignals('ifnl_lite', { limit: 30 })
  const [toggling, setToggling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isEnabled = strategy?.enabled ?? false

  async function handleToggle() {
    setToggling(true)
    setActionError(null)
    try {
      if (isEnabled) {
        await disableStrategy('ifnl_lite')
      } else {
        await enableStrategy('ifnl_lite')
      }
      mutateStrategy()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setToggling(false)
    }
  }

  const s = stats as Record<string, number | string | unknown[]> | undefined
  const openData = (openSignals?.data ?? []) as unknown as IfnlSignal[]
  const recentData = (recentSignals?.data ?? []) as unknown as IfnlSignal[]

  if (statsLoading || !s) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>
          Loading IFNL-Lite data...
        </div>
      </div>
    )
  }

  const totalPnl = Number(s.total_pnl ?? 0)
  const capital = 500 + totalPnl
  const winRate = Number(s.win_rate ?? 0)
  const openCount = Number(s.open ?? 0)
  const totalSignals = Number(s.total_signals ?? 0)
  const wallets = Number(s.tracked_wallets ?? 0)
  const informed = Number(s.informed_wallets ?? 0)
  const avgHold = Number(s.avg_hold_minutes ?? 0)

  return (
    <>
      {/* IFNL Control Bar */}
      <div style={{
        background: 'var(--surface)',
        border: `1px solid ${isEnabled ? 'rgba(139,92,246,0.25)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '20px 22px',
        position: 'relative',
        overflow: 'hidden',
        marginBottom: 24,
        transition: 'border-color 0.3s',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: isEnabled
            ? 'linear-gradient(90deg, transparent, #a78bfa, transparent)'
            : 'linear-gradient(90deg, transparent, var(--text3), transparent)',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: isEnabled ? 'rgba(139,92,246,0.15)' : 'var(--surface2)',
                border: `1px solid ${isEnabled ? 'rgba(139,92,246,0.3)' : 'var(--border2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}>
                {isEnabled ? '◈' : '◉'}
              </div>
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 10, height: 10, borderRadius: '50%',
                background: isEnabled ? '#a78bfa' : 'var(--text3)',
                border: '2px solid var(--surface)',
                boxShadow: isEnabled ? '0 0 6px rgba(139,92,246,0.5)' : 'none',
              }} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>IFNL-Lite</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                  textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
                  background: isEnabled ? 'rgba(139,92,246,0.15)' : 'var(--surface2)',
                  color: isEnabled ? '#a78bfa' : 'var(--text3)',
                  border: `1px solid ${isEnabled ? 'rgba(139,92,246,0.3)' : 'var(--border)'}`,
                }}>
                  {isEnabled ? 'RUNNING' : 'STOPPED'}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
                Continuous strategy · WebSocket + REST polling · paper mode
              </div>
            </div>
          </div>

          <button
            onClick={handleToggle}
            disabled={toggling}
            style={{
              padding: '8px 20px',
              background: isEnabled ? 'var(--red-dim)' : '#7c3aed',
              color: isEnabled ? 'var(--red)' : '#fff',
              border: isEnabled ? '1px solid rgba(255,61,90,0.3)' : 'none',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 12,
              fontWeight: 700, cursor: toggling ? 'default' : 'pointer',
              letterSpacing: '0.04em',
              boxShadow: isEnabled ? 'none' : '0 0 20px rgba(124,58,237,0.3)',
              transition: 'all 0.2s',
            }}
          >
            {toggling ? '...' : isEnabled ? '⏹ Stop Strategy' : '▶ Start Strategy'}
          </button>
        </div>

        {actionError && (
          <div style={{
            marginTop: 12, fontFamily: 'var(--mono)', fontSize: 10,
            color: 'var(--red)', background: 'var(--red-dim)',
            border: '1px solid rgba(255,61,90,0.2)',
            borderRadius: 6, padding: '6px 10px',
          }}>⚠ {actionError}</div>
        )}
      </div>

      {/* Live Activity Panel */}
      {isEnabled && activity && (
        <IfnlActivityPanel activity={activity} />
      )}

      {/* KPIs */}
      <div className="kpi-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 24,
      }}>
        <KpiCard
          icon="◈"
          label="IFNL Capital"
          value={`$${capital.toFixed(2)}`}
          delta={`${formatUSDC(totalPnl)} total PnL`}
          deltaPositive={totalPnl >= 0}
          accent="purple"
        />
        <KpiCard
          icon="⬡"
          label="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          delta={`${s.wins ?? 0}W / ${s.losses ?? 0}L`}
          deltaPositive={false}
          accent="purple"
        />
        <KpiCard
          icon="◉"
          label="Active Signals"
          value={String(openCount)}
          delta={`${totalSignals} total · ~${avgHold.toFixed(0)}m avg hold`}
          deltaPositive={false}
          accent="yellow"
        />
        <KpiCard
          icon="◎"
          label="Wallet Intelligence"
          value={String(informed)}
          delta={`${wallets} tracked · ${informed} informed`}
          deltaPositive={false}
          accent="green"
        />
      </div>

      {/* PnL chart + Active signals */}
      <div className="grid-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <PnlChart data={(s.pnl_series as PnlPoint[]) ?? []} totalPnl={totalPnl} />

        {/* Active IFNL signals */}
        <div>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 14,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Active IFNL Signals</div>
            <Badge variant="open" label={`● ${openData.length} open`} />
          </div>

          <div style={{ maxHeight: 572, overflowY: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {openData.length === 0 ? (
                <div style={{
                  fontFamily: 'var(--mono)', fontSize: 11,
                  color: 'var(--text3)', padding: '20px 0',
                }}>No active IFNL signals — strategy may be stopped or waiting for conditions</div>
              ) : (
                openData.map(s => <IfnlSignalCard key={s.id} signal={s} />)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent signals table */}
      <IfnlSignalsTable signals={recentData} />
    </>
  )
}
