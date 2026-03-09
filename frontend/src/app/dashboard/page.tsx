'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/AppShell'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { ActiveSignals } from '@/components/dashboard/ActiveSignals'
import { RecentSignalsTable } from '@/components/dashboard/RecentSignalsTable'
import { BotControl } from '@/components/dashboard/BotControl'
import { NegRiskSection } from '@/components/dashboard/NegRiskSection'
import { useStats } from '@/hooks/useStats'
import { useSignals, useOpenSignals } from '@/hooks/useSignals'
import { useNegRiskStats, useNegRiskSignals } from '@/hooks/useNegRisk'

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

type Strategy = 'bond-hunter' | 'negrisk'

function StrategyTab({
  id, label, badge, active, onClick,
}: {
  id: Strategy; label: string; badge?: string; active: boolean; onClick: () => void
}) {
  const isNR = id === 'negrisk'
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 18px',
        background: active ? (isNR ? 'rgba(124,58,237,0.12)' : 'var(--green-dim)') : 'transparent',
        border: active
          ? `1px solid ${isNR ? 'rgba(124,58,237,0.3)' : 'rgba(0,232,122,0.25)'}`
          : '1px solid transparent',
        borderRadius: 8,
        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: active ? 600 : 400,
        color: active ? (isNR ? '#a78bfa' : 'var(--green)') : 'var(--text3)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: active ? (isNR ? '#a78bfa' : 'var(--green)') : 'var(--text3)',
        flexShrink: 0,
      }} />
      {label}
      {badge && (
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 9,
          padding: '2px 6px', borderRadius: 4,
          background: isNR ? 'rgba(124,58,237,0.15)' : 'rgba(0,232,122,0.1)',
          color: isNR ? '#a78bfa' : 'var(--green)',
        }}>{badge}</span>
      )}
    </button>
  )
}

export default function DashboardPage() {
  const [activeStrategy, setActiveStrategy] = useState<Strategy>('bond-hunter')

  const { stats, isLoading: statsLoading } = useStats()
  const { signals: openSignals } = useOpenSignals()
  const { signals: recentSignals } = useSignals({ limit: 20 })
  const { stats: nrStats } = useNegRiskStats()
  const { signals: nrSignals } = useNegRiskSignals({ limit: 50 })

  const bondOpenCount = openSignals?.data?.length ?? 0
  const nrOpenCount = nrStats?.open ?? 0

  return (
    <AppShell activePage="dashboard" title="Dashboard">

      {/* Bot control panel */}
      <BotControl />

      {/* Strategy switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
        padding: '12px 16px',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12,
      }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
          Strategy
        </span>
        <StrategyTab
          id="bond-hunter"
          label="Bond Hunter"
          badge={bondOpenCount > 0 ? `${bondOpenCount} open` : undefined}
          active={activeStrategy === 'bond-hunter'}
          onClick={() => setActiveStrategy('bond-hunter')}
        />
        <StrategyTab
          id="negrisk"
          label="NegRisk Arb"
          badge={nrOpenCount > 0 ? `${nrOpenCount} open` : undefined}
          active={activeStrategy === 'negrisk'}
          onClick={() => setActiveStrategy('negrisk')}
        />
      </div>

      {/* Bond Hunter dashboard */}
      {activeStrategy === 'bond-hunter' && (
        statsLoading || !stats ? (
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
        )
      )}

      {/* NegRisk Arb dashboard */}
      {activeStrategy === 'negrisk' && (
        <NegRiskSection
          signals={nrSignals?.data ?? []}
          stats={nrStats}
        />
      )}
    </AppShell>
  )
}
