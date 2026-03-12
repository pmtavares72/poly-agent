import type { Stats } from '@/types'
import { KpiCard } from './KpiCard'
import { formatUSDC, formatPct } from '@/lib/format'

interface KpiGridProps {
  stats: Stats
  mode?: 'paper' | 'live'
}

export function KpiGrid({ stats, mode }: KpiGridProps) {
  const capital = stats.base_capital + stats.total_pnl
  const modeLabel = mode === 'live' ? 'Live' : 'Paper'

  return (
    <div className="kpi-grid" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16,
      marginBottom: 24,
    }}>
      <KpiCard
        icon="◈"
        label={`${modeLabel} Capital`}
        value={formatUSDC(capital, false)}
        delta={`${stats.total_pnl >= 0 ? '↑' : '↓'} ${formatUSDC(stats.total_pnl)}`}
        deltaPositive={stats.total_pnl >= 0}
        accent={mode === 'live' ? 'red' : 'green'}
      />
      <KpiCard
        icon="◎"
        label={`${modeLabel} PnL`}
        value={formatUSDC(stats.total_pnl)}
        delta={`${stats.total_pnl >= 0 ? '↑' : '↓'} ${formatPct((stats.total_pnl / stats.base_capital) * 100)}`}
        deltaPositive={stats.total_pnl >= 0}
        accent={mode === 'live' ? 'red' : 'green'}
      />
      <KpiCard
        icon="⬡"
        label="Win Rate"
        value={formatPct(stats.win_rate)}
        delta={`${stats.wins} wins / ${stats.losses} losses`}
        deltaPositive={false}
        accent="purple"
      />
      <KpiCard
        icon="◉"
        label="Active Signals"
        value={String(stats.open)}
        delta={stats.risk_exits ? `${stats.risk_exits} risk exits · ${stats.stop_losses} SL` : 'resolving in <48h'}
        deltaPositive={false}
        accent="yellow"
      />
    </div>
  )
}
