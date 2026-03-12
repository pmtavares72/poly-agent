import type { Stats } from '@/types'
import { KpiCard } from './KpiCard'
import { formatUSDC, formatPct } from '@/lib/format'

interface KpiGridProps {
  stats: Stats
}

export function KpiGrid({ stats }: KpiGridProps) {
  const capital = 500 + stats.total_pnl

  return (
    <div className="kpi-grid" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16,
      marginBottom: 24,
    }}>
      <KpiCard
        icon="◈"
        label="Total Capital"
        value={formatUSDC(capital, false)}
        delta={`↑ ${formatUSDC(stats.total_pnl)} today`}
        deltaPositive={stats.total_pnl >= 0}
        accent="green"
      />
      <KpiCard
        icon="◎"
        label="PnL Today"
        value={formatUSDC(stats.total_pnl)}
        delta={`↑ ${formatPct((stats.total_pnl / 500) * 100)}`}
        deltaPositive={stats.total_pnl >= 0}
        accent="green"
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
