'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useStats } from '@/hooks/useStats'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TickerTape } from './TickerTape'
import { timeAgo } from '@/lib/format'

type Page = 'dashboard' | 'strategies' | 'logs' | 'settings'

interface AppShellProps {
  children: React.ReactNode
  activePage: Page
  title?: string
}

export function AppShell({ children, activePage, title }: AppShellProps) {
  const router = useRouter()
  const { isAuthenticated, checked } = useAuth()
  const { stats } = useStats()

  useEffect(() => {
    if (checked && !isAuthenticated) {
      router.push('/login')
    }
  }, [checked, isAuthenticated, router])

  if (!checked || !isAuthenticated) return null

  const capital = 500 + (stats?.total_pnl ?? 0)
  const lastScan = stats ? timeAgo(stats.generated_at) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {stats && <TickerTape stats={stats} />}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar activePage={activePage} openSignals={stats?.open ?? 0} />

        <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Topbar title={title ?? ''} capital={capital} lastScan={lastScan} />
          <div style={{ padding: 28, flex: 1 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
