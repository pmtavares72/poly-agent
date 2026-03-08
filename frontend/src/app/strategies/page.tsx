'use client'
import { AppShell } from '@/components/layout/AppShell'
import { BondHunterCard } from '@/components/strategies/BondHunterCard'
import { useStats } from '@/hooks/useStats'

export default function StrategiesPage() {
  const { stats } = useStats()

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
            1 active strategy · paper trading mode
          </div>
        </div>
        <button className="btn-new" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '9px 16px', background: 'var(--green)', color: '#000',
          border: 'none', borderRadius: 8, fontFamily: 'var(--sans)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 0 20px var(--green-glow)',
        }}>+ New Strategy</button>
      </div>

      <BondHunterCard stats={stats} />
    </AppShell>
  )
}
