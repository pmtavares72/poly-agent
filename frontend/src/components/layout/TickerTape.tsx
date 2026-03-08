import type { Stats } from '@/types'
import { formatUSDC, formatPct } from '@/lib/format'

interface TickerTapeProps {
  stats: Stats
}

export function TickerTape({ stats }: TickerTapeProps) {
  const capital = 500 + stats.total_pnl

  const items = [
    { label: 'BOND_HUNTER', value: 'ACTIVE', positive: true },
    { label: 'WIN_RATE',    value: formatPct(stats.win_rate), positive: true },
    { label: 'OPEN_SIGNALS', value: String(stats.open), positive: true },
    { label: 'TOTAL_PNL',   value: formatUSDC(stats.total_pnl), positive: stats.total_pnl >= 0 },
    { label: 'CAPITAL',     value: formatUSDC(capital, false), positive: true },
    { label: 'SPREAD_AVG',  value: formatPct(stats.avg_spread_pct, 2), positive: true },
    { label: 'FEES_PAID',   value: formatUSDC(stats.total_fees, false), positive: false },
    { label: 'SIGNALS',     value: String(stats.total_signals), positive: true },
  ]

  // Duplicate for seamless loop
  const all = [...items, ...items]

  return (
    <div className="ticker-wrap">
      <div className="ticker-inner animate-ticker">
        {all.map((item, i) => (
          <div key={i} className="ticker-item">
            {item.label} · <span className={item.positive ? 'pos' : 'neg'}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
