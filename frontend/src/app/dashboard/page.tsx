'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { AppShell } from '@/components/layout/AppShell'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { ActiveSignals } from '@/components/dashboard/ActiveSignals'
import { RecentSignalsTable } from '@/components/dashboard/RecentSignalsTable'
import { IfnlDashboard } from '@/components/dashboard/IfnlDashboard'
import { useStats } from '@/hooks/useStats'
import { useSignals, useOpenSignalsLive } from '@/hooks/useSignals'
import { useBot } from '@/hooks/useBot'
import { timeAgo } from '@/lib/format'

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

export default function DashboardPage() {
  const [strategyTab, setStrategyTab] = useState<StrategyTab>('bond_hunter')
  const [modeTab, setModeTab] = useState<ModeTab>('paper')
  const [confirming, setConfirming] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const { bot, togglePaper, toggleLive, triggerScan, actionLoading } = useBot()
  const paperEnabled = bot?.paper_enabled != null ? !!(bot.paper_enabled) : true
  const liveEnabled = bot?.live_enabled != null ? !!(bot.live_enabled) : bot?.trading_mode === 'live'
  const scanning = Boolean(bot?.pid_alive)

  const modeEnabled = modeTab === 'paper' ? paperEnabled : liveEnabled
  const modeColor = modeTab === 'live' ? 'var(--red)' : 'var(--yellow)'

  const { stats, isLoading: statsLoading } = useStats(modeTab)
  const { signals: openSignals, mutate: mutateOpen } = useOpenSignalsLive(modeTab)
  const { signals: recentSignals } = useSignals({ limit: 20, mode: modeTab })

  const strategyTabs: { key: StrategyTab; label: string; type: string; color: string }[] = [
    { key: 'bond_hunter', label: 'Bond Hunter', type: 'cron', color: 'var(--green)' },
    { key: 'ifnl_lite', label: 'IFNL-Lite', type: 'continuous', color: '#a78bfa' },
  ]

  async function handleToggle() {
    if (!modeEnabled && modeTab === 'live') {
      if (!confirming) {
        setConfirming(true)
        setTimeout(() => setConfirming(false), 4000)
        return
      }
      setConfirming(false)
    }
    const fn = modeTab === 'paper' ? togglePaper : toggleLive
    await fn(!modeEnabled)
  }

  async function handleScan() {
    setScanMsg(null)
    await triggerScan()
    setScanMsg('Scan triggered')
    setTimeout(() => setScanMsg(null), 8000)
  }

  return (
    <AppShell activePage="dashboard" title="Dashboard">
      {/* Strategy Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
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
          {/* Mode selector + controls */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 24, gap: 16, flexWrap: 'wrap',
          }}>
            {/* Left: segmented control */}
            <div style={{
              display: 'inline-flex',
              background: 'var(--bg2)',
              borderRadius: 10,
              padding: 3,
              border: '1px solid var(--border)',
            }}>
              {(['paper', 'live'] as ModeTab[]).map(m => {
                const isActive = modeTab === m
                const c = m === 'live' ? 'var(--red)' : 'var(--yellow)'
                const en = m === 'paper' ? paperEnabled : liveEnabled
                return (
                  <button
                    key={m}
                    onClick={() => { setModeTab(m); setConfirming(false) }}
                    style={{
                      position: 'relative',
                      padding: '7px 22px',
                      background: isActive ? 'var(--surface2)' : 'transparent',
                      border: 'none',
                      borderRadius: 8,
                      color: isActive ? 'var(--text)' : 'var(--text3)',
                      fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.08em',
                    }}
                  >
                    <span style={{
                      display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                      background: en ? c : 'var(--text3)', opacity: en ? 1 : 0.3,
                      marginRight: 7, verticalAlign: 'middle',
                      boxShadow: en && isActive ? `0 0 6px ${c}` : 'none',
                      transition: 'all 0.3s',
                    }} />
                    {m.toUpperCase()}
                  </button>
                )
              })}
            </div>

            {/* Center: status */}
            <div style={{
              flex: 1, minWidth: 0,
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)',
              textAlign: 'center',
            }}>
              {scanMsg
                ? <span style={{ color: 'var(--green)' }}>{scanMsg}</span>
                : bot?.last_error
                  ? <span style={{ color: 'var(--red)' }}>{bot.last_error}</span>
                  : bot?.last_scan_at
                    ? <>{timeAgo(bot.last_scan_at)} · {bot.scan_count} scans</>
                    : null
              }
            </div>

            {/* Right: actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {modeEnabled && (
                <button
                  onClick={handleScan}
                  disabled={actionLoading || scanning}
                  style={{
                    padding: '6px 14px', borderRadius: 7,
                    background: 'transparent',
                    color: actionLoading || scanning ? 'var(--text3)' : 'var(--cyan)',
                    border: '1px solid rgba(0,194,255,0.2)',
                    fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em',
                    cursor: actionLoading || scanning ? 'default' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {scanning ? '...' : 'Scan Now'}
                </button>
              )}
              <button
                onClick={handleToggle}
                disabled={actionLoading}
                style={{
                  padding: '6px 16px', borderRadius: 7,
                  background: confirming ? modeColor : modeEnabled ? 'transparent' : modeColor,
                  color: confirming ? '#000' : modeEnabled ? modeColor : '#000',
                  border: `1px solid ${confirming ? 'transparent' : modeEnabled ? modeColor : 'transparent'}`,
                  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s', opacity: actionLoading ? 0.5 : 1,
                }}
              >
                {actionLoading ? '...' : confirming ? 'Confirm?' : modeEnabled ? 'Stop' : 'Start'}
              </button>
            </div>
          </div>

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
