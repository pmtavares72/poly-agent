'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/AppShell'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { ActiveSignals } from '@/components/dashboard/ActiveSignals'
import { RecentSignalsTable } from '@/components/dashboard/RecentSignalsTable'
import { BotControl } from '@/components/dashboard/BotControl'
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

type StrategyTab = 'bond_hunter' | 'ifnl_lite'
type ModeTab = 'paper' | 'live'

function ModeStartStop({ mode, enabled, onToggle, disabled }: {
  mode: ModeTab
  enabled: boolean
  onToggle: (enabled: boolean) => Promise<void>
  disabled: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const isLive = mode === 'live'
  const color = isLive ? 'var(--red)' : 'var(--yellow)'
  const label = mode.toUpperCase()

  async function handleClick() {
    if (!enabled && isLive) {
      // Enabling live requires confirmation
      if (!confirming) {
        setConfirming(true)
        setTimeout(() => setConfirming(false), 4000)
        return
      }
      setConfirming(false)
    }
    await onToggle(!enabled)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', borderRadius: 10,
      background: enabled ? `${color}08` : 'var(--surface)',
      border: `1px solid ${enabled ? color : 'var(--border)'}`,
      marginBottom: 20,
      transition: 'all 0.2s',
    }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: enabled ? `${color}20` : 'var(--surface2)',
          border: `1px solid ${enabled ? `${color}40` : 'var(--border2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          {enabled ? '◈' : '◉'}
        </div>
        <div style={{
          position: 'absolute', bottom: -1, right: -1,
          width: 10, height: 10, borderRadius: '50%',
          background: enabled ? color : 'var(--text3)',
          border: '2px solid var(--bg)',
          boxShadow: enabled ? `0 0 6px ${color}` : 'none',
        }} />
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: enabled ? color : 'var(--text3)' }}>
            {label} TRADING
          </span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px', borderRadius: 4,
            background: enabled ? `${color}20` : 'var(--surface2)',
            color: enabled ? color : 'var(--text3)',
            letterSpacing: '0.08em',
          }}>
            {enabled ? 'ACTIVE' : 'STOPPED'}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
          {isLive ? 'Real orders on Polymarket CLOB' : 'Simulated trades with real market data'}
        </div>
      </div>

      <button
        onClick={handleClick}
        disabled={disabled}
        style={{
          padding: '8px 18px', borderRadius: 8,
          background: confirming ? color : enabled ? 'rgba(231,76,60,0.12)' : `${color}`,
          color: confirming ? '#000' : enabled ? 'var(--red)' : '#000',
          border: enabled ? '1px solid rgba(231,76,60,0.3)' : 'none',
          fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          letterSpacing: '0.04em', transition: 'all 0.2s',
          opacity: disabled ? 0.5 : 1,
          boxShadow: !enabled && !confirming ? `0 0 16px ${color}40` : 'none',
        }}
      >
        {disabled ? '...' : confirming ? 'Confirm Live?' : enabled ? '⏹ Stop' : '▶ Start'}
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const [strategyTab, setStrategyTab] = useState<StrategyTab>('bond_hunter')
  const [modeTab, setModeTab] = useState<ModeTab>('paper')

  const { bot, togglePaper, toggleLive, actionLoading: modeLoading } = useBot()
  const paperEnabled = bot?.paper_enabled != null ? !!(bot.paper_enabled) : true
  const liveEnabled = bot?.live_enabled != null ? !!(bot.live_enabled) : bot?.trading_mode === 'live'

  // Data filtered by the active mode tab
  const { stats, isLoading: statsLoading } = useStats(modeTab)
  const { signals: openSignals, mutate: mutateOpen } = useOpenSignalsLive(modeTab)
  const { signals: recentSignals } = useSignals({ limit: 20, mode: modeTab })

  const strategyTabs: { key: StrategyTab; label: string; type: string; color: string }[] = [
    { key: 'bond_hunter', label: 'Bond Hunter', type: 'cron', color: 'var(--green)' },
    { key: 'ifnl_lite', label: 'IFNL-Lite', type: 'continuous', color: '#a78bfa' },
  ]

  const modeTabs: { key: ModeTab; label: string; color: string; enabled: boolean }[] = [
    { key: 'paper', label: 'Paper', color: 'var(--yellow)', enabled: paperEnabled },
    { key: 'live', label: 'Live', color: 'var(--red)', enabled: liveEnabled },
  ]

  return (
    <AppShell activePage="dashboard" title="Dashboard">
      {/* Strategy Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 16,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 0,
      }}>
        {strategyTabs.map(tab => {
          const isActive = strategyTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setStrategyTab(tab.key)}
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
      {strategyTab === 'bond_hunter' && (
        <>
          {/* Global bot status + Scan Now */}
          <BotControl />

          {/* Paper / Live sub-tabs */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 16,
          }}>
            {modeTabs.map(tab => {
              const isActive = modeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setModeTab(tab.key)}
                  style={{
                    padding: '8px 20px',
                    background: isActive ? `${tab.color}12` : 'transparent',
                    border: `1px solid ${isActive ? tab.color : 'var(--border)'}`,
                    borderRadius: tab.key === 'paper' ? '8px 0 0 8px' : '0 8px 8px 0',
                    color: isActive ? tab.color : 'var(--text3)',
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    letterSpacing: '0.06em',
                  }}
                >
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: tab.enabled ? tab.color : 'var(--text3)',
                    opacity: tab.enabled ? 1 : 0.3,
                    marginRight: 6,
                  }} />
                  {tab.label.toUpperCase()}
                  <span style={{ fontSize: 9, marginLeft: 6, opacity: 0.6 }}>
                    {tab.enabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Mode-specific Start/Stop control */}
          <ModeStartStop
            mode={modeTab}
            enabled={modeTab === 'paper' ? paperEnabled : liveEnabled}
            onToggle={modeTab === 'paper' ? togglePaper : toggleLive}
            disabled={modeLoading}
          />

          {/* Dashboard content filtered by modeTab */}
          {statsLoading || !stats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
                {[0,1,2,3].map(i => <Skeleton key={i} h={110} />)}
              </div>
              <Skeleton h={220} />
            </div>
          ) : (
            <>
              <KpiGrid stats={stats} mode={modeTab} />
              <div className="grid-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <PnlChart data={stats.pnl_series} totalPnl={stats.total_pnl} />
                <ActiveSignals signals={openSignals?.data ?? []} onSold={() => mutateOpen()} />
              </div>
              <RecentSignalsTable
                signals={recentSignals?.data ?? []}
                total={recentSignals?.total ?? 0}
                liveSignals={openSignals?.data}
                onSold={() => mutateOpen()}
              />
            </>
          )}
        </>
      )}

      {/* IFNL-Lite Tab */}
      {strategyTab === 'ifnl_lite' && (
        <IfnlDashboard />
      )}
    </AppShell>
  )
}
