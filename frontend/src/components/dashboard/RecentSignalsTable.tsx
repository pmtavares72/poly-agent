'use client'
import { useState, useMemo } from 'react'
import type { Signal } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { formatPrice, formatUSDC, formatPct, formatHours, hoursUntilClose, timeAgo } from '@/lib/format'
import { sellSignal, sellSignalPaper } from '@/lib/api'

type SortKey = 'id' | 'detected_at' | 'closes_at' | 'entry_price' | 'position_usdc' | 'net_profit_pct' | 'pnl_usdc' | 'status'
type SortDir = 'asc' | 'desc'

interface RecentSignalsTableProps {
  signals: Signal[]
  total: number
  liveSignals?: Signal[]
  onSold?: () => void
}

const EXIT_REASON_LABELS: Record<string, string> = {
  stop_loss: 'SL',
  trailing_stop: 'TS',
  time_exit: 'TIME',
  manual_tp: 'TP',
  manual_sell: 'SELL',
}

function signalBadge(signal: Signal) {
  if (signal.status === 'open') return <Badge variant="open" />
  if (signal.outcome === 'RISK_EXIT') {
    const label = signal.exit_reason ? EXIT_REASON_LABELS[signal.exit_reason] ?? signal.exit_reason : 'EXIT'
    return (
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
        padding: '2px 6px', borderRadius: 4,
        background: 'rgba(231,76,60,0.15)', color: 'var(--red)',
      }}>
        {label}
      </span>
    )
  }
  if (signal.outcome === 'YES') return <Badge variant="win" />
  return <Badge variant="loss" />
}

function formatDetectedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function SortTh({ label, sortKey, current, dir, onSort, colSpan }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  colSpan?: number
}) {
  const active = current === sortKey
  return (
    <th onClick={() => onSort(sortKey)} colSpan={colSpan} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      <span style={{ color: active ? 'var(--cyan)' : undefined }}>
        {label}{' '}{active ? (dir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
      </span>
    </th>
  )
}

function ActionButtons({ signal, onSold }: { signal: Signal; onSold?: () => void }) {
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const [selling, setSelling] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleSell(reason: string) {
    if (confirmAction !== reason) {
      setConfirmAction(reason)
      setTimeout(() => setConfirmAction(null), 3000)
      return
    }
    setSelling(true)
    try {
      const sellFn = signal.mode === 'live' ? sellSignal : sellSignalPaper
      const res = await sellFn(signal.id, reason)
      setResult(`${res.pnl_usdc >= 0 ? '+' : ''}$${res.pnl_usdc.toFixed(2)}`)
      onSold?.()
    } catch (e) {
      setResult(`ERR: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setSelling(false)
      setConfirmAction(null)
    }
  }

  if (result) {
    return <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text2)' }}>{result}</span>
  }

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {signal.can_claim && (
        <button
          onClick={() => handleSell('take_profit')}
          disabled={selling}
          style={{
            padding: '2px 8px', borderRadius: 4, border: 'none',
            cursor: selling ? 'wait' : 'pointer',
            fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
            background: confirmAction === 'take_profit' ? '#a78bfa' : 'rgba(167,139,250,0.15)',
            color: confirmAction === 'take_profit' ? 'var(--bg)' : '#a78bfa',
            transition: 'all 0.15s',
          }}
        >
          {selling ? '...' : confirmAction === 'take_profit' ? 'Confirm?' : 'Claim'}
        </button>
      )}
      {!signal.can_claim && signal.can_take_profit && (
        <button
          onClick={() => handleSell('take_profit')}
          disabled={selling}
          style={{
            padding: '2px 8px', borderRadius: 4, border: 'none',
            cursor: selling ? 'wait' : 'pointer',
            fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
            background: confirmAction === 'take_profit' ? 'var(--green)' : 'rgba(46,204,113,0.15)',
            color: confirmAction === 'take_profit' ? 'var(--bg)' : 'var(--green)',
            transition: 'all 0.15s',
          }}
        >
          {selling ? '...' : confirmAction === 'take_profit' ? 'Confirm?' : 'Take Profit'}
        </button>
      )}
      {!signal.can_claim && (
        <button
          onClick={() => handleSell('manual_sell')}
          disabled={selling}
          style={{
            padding: '2px 8px', borderRadius: 4, border: 'none',
            cursor: selling ? 'wait' : 'pointer',
            fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
            background: confirmAction === 'manual_sell' ? 'var(--red)' : 'rgba(231,76,60,0.15)',
            color: confirmAction === 'manual_sell' ? 'var(--bg)' : 'var(--red)',
            transition: 'all 0.15s',
          }}
        >
          {selling ? '...' : confirmAction === 'manual_sell' ? 'Confirm?' : 'Sell'}
        </button>
      )}
    </div>
  )
}

function RiskRow({ signal, colSpan }: { signal: Signal; colSpan: number }) {
  const hasData = signal.current_price != null && signal.current_price > 0
  if (!hasData) return null

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '0 16px 10px', background: 'var(--bg2)' }}>
        <div style={{
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
          fontFamily: 'var(--mono)', fontSize: 10,
          padding: '8px 12px', borderRadius: 8,
          background: 'var(--bg3)',
        }}>
          <div>
            <span style={{ color: 'var(--text3)', marginRight: 4 }}>Current:</span>
            <span style={{ color: signal.current_price! >= signal.entry_price ? 'var(--green)' : 'var(--red)' }}>
              {formatPrice(signal.current_price!)}
            </span>
          </div>
          {signal.pnl_if_sell_now != null && (
            <div>
              <span style={{ color: 'var(--text3)', marginRight: 4 }}>Sell now:</span>
              <span style={{ color: signal.pnl_if_sell_now >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {signal.pnl_if_sell_now >= 0 ? '+' : ''}{formatUSDC(signal.pnl_if_sell_now)}
              </span>
            </div>
          )}
          {signal.pnl_if_wait != null && (
            <div>
              <span style={{ color: 'var(--text3)', marginRight: 4 }}>If wait:</span>
              <span style={{ color: signal.pnl_if_wait >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {signal.pnl_if_wait >= 0 ? '+' : ''}{formatUSDC(signal.pnl_if_wait)}
              </span>
            </div>
          )}
          {signal.opportunity_cost != null && (
            <div>
              <span style={{ color: 'var(--text3)', marginRight: 4 }}>Exit cost:</span>
              <span style={{ color: 'var(--yellow)' }}>{formatUSDC(signal.opportunity_cost)}</span>
            </div>
          )}
          {signal.stop_loss_price != null && (
            <div>
              <span style={{ color: 'var(--text3)', marginRight: 4 }}>Stop:</span>
              <span style={{ color: 'var(--red)' }}>
                {formatPrice(signal.stop_loss_price)}
                {signal.pnl_at_stop != null && (
                  <span style={{ marginLeft: 4, opacity: 0.8 }}>
                    ({signal.pnl_at_stop >= 0 ? '+' : ''}{formatUSDC(signal.pnl_at_stop)})
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

export function RecentSignalsTable({ signals, total, liveSignals, onSold }: RecentSignalsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Merge live data (prices, P&L) into signals by ID
  const liveMap = useMemo(() => {
    const m = new Map<number, Signal>()
    if (liveSignals) {
      for (const s of liveSignals) m.set(s.id, s)
    }
    return m
  }, [liveSignals])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    return [...signals].sort((a, b) => {
      let va: number | string
      let vb: number | string
      switch (sortKey) {
        case 'id':             va = a.id;              vb = b.id;              break
        case 'detected_at':    va = a.detected_at;     vb = b.detected_at;     break
        case 'closes_at':
          va = a.status === 'open' ? hoursUntilClose(a.closes_at) : a.hours_to_close
          vb = b.status === 'open' ? hoursUntilClose(b.closes_at) : b.hours_to_close
          break
        case 'entry_price':    va = a.entry_price;     vb = b.entry_price;     break
        case 'position_usdc':  va = a.position_usdc;   vb = b.position_usdc;   break
        case 'net_profit_pct': va = a.net_profit_pct;  vb = b.net_profit_pct;  break
        case 'pnl_usdc':       va = a.pnl_usdc ?? -Infinity; vb = b.pnl_usdc ?? -Infinity; break
        case 'status':         va = a.status;          vb = b.status;          break
        default:               va = 0;                 vb = 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [signals, sortKey, sortDir])

  const hasOpenSignals = signals.some(s => s.status === 'open')
  const totalCols = hasOpenSignals ? 10 : 9

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        padding: '18px 22px 14px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Recent Signals</div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
          {total} total · click column to sort
        </span>
      </div>

      <div style={{ maxHeight: 484, overflowY: 'auto' }}>
      <table className="signals-table">
        <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface)' }}>
          <tr>
            <SortTh label="#"         sortKey="id"             current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="Detected"  sortKey="detected_at"    current={sortKey} dir={sortDir} onSort={handleSort} />
            <th>Question</th>
            <SortTh label="Entry"     sortKey="entry_price"    current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="Position"  sortKey="position_usdc"  current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="Closes in" sortKey="closes_at"      current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="Net %"     sortKey="net_profit_pct" current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="PnL"       sortKey="pnl_usdc"       current={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="Status"    sortKey="status"         current={sortKey} dir={sortDir} onSort={handleSort} />
            {hasOpenSignals && <th style={{ whiteSpace: 'nowrap' }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => {
            const htc = s.status === 'open' ? hoursUntilClose(s.closes_at) : s.hours_to_close
            const enriched = s.status === 'open' ? liveMap.get(s.id) ?? s : s
            return (
              <SignalRow
                key={s.id}
                signal={s}
                enriched={enriched}
                htc={htc}
                hasActionsCol={hasOpenSignals}
                totalCols={totalCols}
                onSold={onSold}
              />
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function SignalRow({ signal: s, enriched, htc, hasActionsCol, totalCols, onSold }: {
  signal: Signal
  enriched: Signal
  htc: number
  hasActionsCol: boolean
  totalCols: number
  onSold?: () => void
}) {
  const isOpen = s.status === 'open'
  const hasLiveData = enriched.current_price != null && enriched.current_price > 0

  return (
    <>
      <tr style={isOpen && hasLiveData ? { borderBottom: 'none' } : undefined}>
        <td>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>#{s.id}</span>
        </td>
        <td>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
            {formatDetectedAt(s.detected_at)}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
            {timeAgo(s.detected_at)}
          </div>
        </td>
        <td className="td-question"><span>{s.question}</span></td>
        <td>{formatPrice(s.entry_price)}</td>
        <td>{formatUSDC(s.position_usdc, false)}</td>
        <td style={{ color: htc < 6 ? 'var(--yellow)' : 'var(--text2)' }}>{formatHours(htc)}</td>
        <td style={{ color: 'var(--green)' }}>{formatPct(s.net_profit_pct * 100, 1)}</td>
        <td style={{ color: s.pnl_usdc != null ? (s.pnl_usdc >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text3)' }}>
          {s.pnl_usdc != null ? formatUSDC(s.pnl_usdc) : '—'}
        </td>
        <td>{signalBadge(s)}</td>
        {hasActionsCol && (
          <td>
            {isOpen ? <ActionButtons signal={enriched} onSold={onSold} /> : null}
          </td>
        )}
      </tr>
      {isOpen && hasLiveData && <RiskRow signal={enriched} colSpan={totalCols} />}
    </>
  )
}
