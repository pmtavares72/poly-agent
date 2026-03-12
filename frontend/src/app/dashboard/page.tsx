'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/AppShell'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { ActiveSignals } from '@/components/dashboard/ActiveSignals'
import { RecentSignalsTable } from '@/components/dashboard/RecentSignalsTable'
import { BotControl } from '@/components/dashboard/BotControl'
import { ModeToggle } from '@/components/dashboard/ModeToggle'
import { IfnlDashboard } from '@/components/dashboard/IfnlDashboard'
import { useStats } from '@/hooks/useStats'
import { useSignals, useOpenSignalsLive } from '@/hooks/useSignals'
import { useBot } from '@/hooks/useBot'

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

type TabKey = 'bond_hunter' | 'ifnl_lite'

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('bond_hunter')
  const { stats, isLoading: statsLoading } = useStats()
  const { signals: openSignals, mutate: mutateOpen } = useOpenSignalsLive()
  const { signals: recentSignals } = useSignals({ limit: 20 })
  const { bot, switchMode, actionLoading: modeLoading } = useBot()
  const tradingMode = stats?.trading_mode ?? bot?.trading_mode ?? 'paper'

  const tabs: { key: TabKey; label: string; type: string; color: string }[] = [
    { key: 'bond_hunter', label: 'Bond Hunter', type: 'cron', color: 'var(--green)' },
    { key: 'ifnl_lite', label: 'IFNL-Lite', type: 'continuous', color: '#a78bfa' },
  ]

  return (
    <AppShell activePage="dashboard" title="Dashboard">
      {/* Strategy Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 0,
      }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${tab.color}` : '2px solid transparent',
                color: isActive ? 'var(--text)' : 'var(--text3)',
                fontFamily: 'var(--sans)',
                fontSize: 13,
                fontWeight: isActive ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.2s',
                marginBottom: -1,
              }}
            >
              {tab.label}
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, marginLeft: 8,
                color: isActive ? tab.color : 'var(--text3)',
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                {tab.type}
              </span>
            </button>
          )
        })}
      </div>

      {/* Bond Hunter Tab */}
      {activeTab === 'bond_hunter' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}><BotControl /></div>
            <ModeToggle mode={tradingMode} onSwitch={switchMode} disabled={modeLoading} />
          </div>
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
                <ActiveSignals signals={openSignals?.data ?? []} onSold={() => mutateOpen()} />
              </div>
              <RecentSignalsTable
                signals={recentSignals?.data ?? []}
                total={recentSignals?.total ?? 0}
              />
            </>
          )}
        </>
      )}

      {/* IFNL-Lite Tab */}
      {activeTab === 'ifnl_lite' && (
        <IfnlDashboard />
      )}
    </AppShell>
  )
}
