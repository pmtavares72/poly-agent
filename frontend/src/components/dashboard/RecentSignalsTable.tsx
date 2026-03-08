'use client'
import { useState, useMemo } from 'react'
import type { Signal } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { formatPrice, formatUSDC, formatPct, formatHours, hoursUntilClose, timeAgo } from '@/lib/format'

type SortKey = 'id' | 'detected_at' | 'closes_at' | 'entry_price' | 'position_usdc' | 'net_profit_pct' | 'pnl_usdc' | 'status'
type SortDir = 'asc' | 'desc'

interface RecentSignalsTableProps {
  signals: Signal[]
  total: number
}

function signalBadge(signal: Signal) {
  if (signal.status === 'open') return <Badge variant="open" />
  if (signal.outcome === 'YES') return <Badge variant="win" />
  return <Badge variant="loss" />
}

function formatDetectedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function SortTh({ label, sortKey, current, dir, onSort }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th onClick={() => onSort(sortKey)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      <span style={{ color: active ? 'var(--cyan)' : undefined }}>
        {label}{' '}{active ? (dir === 'asc' ? '↑' : '↓') : <span style={{ opacity: 0.3 }}>↕</span>}
      </span>
    </th>
  )
}

export function RecentSignalsTable({ signals, total }: RecentSignalsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('detected_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

      <table className="signals-table">
        <thead>
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
          </tr>
        </thead>
        <tbody>
          {sorted.map(s => {
            const htc = s.status === 'open' ? hoursUntilClose(s.closes_at) : s.hours_to_close
            return (
              <tr key={s.id}>
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
