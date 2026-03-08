'use client'
import Link from 'next/link'
import { LogoMark } from '@/components/ui/LogoMark'

type Page = 'dashboard' | 'strategies'

interface SidebarProps {
  activePage: Page
  openSignals?: number
}

const navItems = [
  { id: 'dashboard',   href: '/dashboard',   icon: '◈', label: 'Dashboard',     section: 'monitor' },
  { id: 'strategies',  href: '/strategies',  icon: '⬡', label: 'Strategies',    section: 'monitor' },
  { id: 'signals',     href: '/dashboard',   icon: '◎', label: 'Signals',       section: 'monitor', badge: true },
  { id: 'history',     href: '/dashboard',   icon: '≡', label: 'Trade History', section: 'monitor' },
  { id: 'settings',    href: '/dashboard',   icon: '⚙', label: 'Settings',      section: 'system' },
  { id: 'apikeys',     href: '/dashboard',   icon: '⬡', label: 'API Keys',      section: 'system' },
]

export function Sidebar({ activePage, openSignals = 0 }: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo" style={{
        padding: '24px 20px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <LogoMark size="sm" />
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>PolyAgent</span>
      </div>

      {/* Monitor section */}
      <div className="sidebar-section" style={{ padding: '20px 12px 8px' }}>
        <div className="sidebar-section-label" style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.15em',
          textTransform: 'uppercase', color: 'var(--text3)',
          padding: '0 8px', marginBottom: 6,
        }}>Monitor</div>

        {navItems.filter(n => n.section === 'monitor').map(item => (
          <Link
            key={item.id}
            href={item.href}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
          >
            <span className="nav-icon" style={{ fontSize: 15, width: 20, textAlign: 'center' }}>
              {item.icon}
            </span>
            {item.label}
            {item.badge && openSignals > 0 && (
              <span className="nav-badge" style={{
                marginLeft: 'auto',
                background: 'var(--green)', color: '#000',
                fontFamily: 'var(--mono)', fontSize: 9,
                padding: '2px 6px', borderRadius: 20,
              }}>{openSignals}</span>
            )}
          </Link>
        ))}
      </div>

      {/* System section */}
      <div className="sidebar-section" style={{ padding: '8px 12px' }}>
        <div className="sidebar-section-label" style={{
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.15em',
          textTransform: 'uppercase', color: 'var(--text3)',
          padding: '0 8px', marginBottom: 6,
        }}>System</div>

        {navItems.filter(n => n.section === 'system').map(item => (
          <Link key={item.id} href={item.href} className="nav-item">
            <span className="nav-icon" style={{ fontSize: 15, width: 20, textAlign: 'center' }}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </div>

      {/* User chip */}
      <div className="sidebar-bottom" style={{
        marginTop: 'auto', padding: '16px 12px',
        borderTop: '1px solid var(--border)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 8,
          background: 'var(--surface)', cursor: 'pointer',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>PT</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>P. Tavares</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>Admin · Paper</div>
          </div>
          <span style={{ color: 'var(--text3)', fontSize: 12 }}>⋮</span>
        </div>
      </div>
    </aside>
  )
}
