import type { Signal } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { formatPrice, formatUSDC, formatPct, formatHours, hoursUntilClose } from '@/lib/format'

interface RecentSignalsTableProps {
  signals: Signal[]
  total: number
}

function signalBadge(signal: Signal) {
  if (signal.status === 'open') return <Badge variant="open" />
  if (signal.outcome === 'YES') return <Badge variant="win" />
  return <Badge variant="loss" />
}

export function RecentSignalsTable({ signals, total }: RecentSignalsTableProps) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '18px 22px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Recent Signals</div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
          {total} total · last 30d
        </span>
      </div>

      <table className="signals-table">
        <thead>
          <tr>
            <th>Question</th>
            <th>Entry</th>
            <th>Position</th>
            <th>Hrs Close</th>
            <th>Net %</th>
            <th>PnL</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(s => {
            const htc = s.status === 'open' ? hoursUntilClose(s.closes_at) : s.hours_to_close
            return (
              <tr key={s.id}>
                <td className="td-question"><span>{s.question}</span></td>
                <td>{formatPrice(s.entry_price)}</td>
                <td>{formatUSDC(s.position_usdc, false)}</td>
                <td>{formatHours(htc)}</td>
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
