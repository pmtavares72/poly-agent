'use client'
import { formatUSDC } from '@/lib/format'

interface TopbarProps {
  title: string
  capital: number
  lastScan?: string
}

export function Topbar({ title, capital, lastScan }: TopbarProps) {
  return (
    <div style={{
      height: 56,
      background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 28px',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{title}</div>

      {lastScan && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
          Last scan: <span style={{ color: 'var(--text2)' }}>{lastScan}</span>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 8, padding: '6px 14px',
      }}>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>Capital</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--green)' }}>
          {formatUSDC(capital, false)}
        </span>
      </div>

      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 14, position: 'relative',
      }}>
        🔔
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--red)', border: '1px solid var(--bg2)',
        }} />
      </div>

      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--purple), var(--cyan))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer',
      }}>PT</div>
    </div>
  )
}
