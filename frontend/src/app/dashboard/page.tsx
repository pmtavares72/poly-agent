'use client'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/AppShell'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { ActiveSignals } from '@/components/dashboard/ActiveSignals'
import { RecentSignalsTable } from '@/components/dashboard/RecentSignalsTable'
import { BotControl } from '@/components/dashboard/BotControl'
import { useStats } from '@/hooks/useStats'
import { useSignals, useOpenSignals } from '@/hooks/useSignals'

const PnlChart = dynamic(
  () => import('@/components/dashboard/PnlChart').then(m => ({ default: m.PnlChart })),
  { ssr: false }
)

function Skeleton({ h = 160 }: { h?: number }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, height: h,
    }} />
  )
}

export default function DashboardPage() {
  const { stats, isLoading: statsLoading } = useStats()
  const { signals: openSignals } = useOpenSignals()
  const { signals: recentSignals } = useSignals({ limit: 20 })

  return (
    <AppShell activePage="dashboard" title="Dashboard">
      <BotControl />

      {statsLoading || !stats ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
            {[0,1,2,3].map(i => <Skeleton key={i} h={110} />)}
          </div>
          <Skeleton h={220} />
        </div>
      ) : (
        <>
          <KpiGrid stats={stats} />
          <div className="grid-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            <PnlChart data={stats.pnl_series} totalPnl={stats.total_pnl} />
            <ActiveSignals signals={openSignals?.data ?? []} />
          </div>
          <RecentSignalsTable
            signals={recentSignals?.data ?? []}
            total={recentSignals?.total ?? 0}
          />
        </>
      )}
    </AppShell>
  )
}
