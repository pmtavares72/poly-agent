'use client'
import { AppShell } from '@/components/layout/AppShell'
import { BondHunterCard } from '@/components/strategies/BondHunterCard'
import { IfnlLiteCard } from '@/components/strategies/IfnlLiteCard'
import { useStats } from '@/hooks/useStats'
import { useStrategies } from '@/hooks/useStrategies'

export default function StrategiesPage() {
  const { stats } = useStats()
  const { strategies } = useStrategies()

  const strategyCount = strategies?.length ?? 0
  const activeCount = strategies?.filter(s => s.enabled).length ?? 0

  return (
    <AppShell activePage="strategies" title="Strategies">
      {/* Header */}
      <div className="strategies-header" style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 24,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Strategies</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {strategyCount} {strategyCount === 1 ? 'strategy' : 'strategies'} · {activeCount} active · paper trading mode
          </div>
        </div>
      </div>

      <BondHunterCard stats={stats} />
      <IfnlLiteCard />
    </AppShell>
  )
}
