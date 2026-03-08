import type { Signal } from '@/types'
import { formatPrice, formatUSDC, formatPct, hoursUntilClose, formatHours } from '@/lib/format'

interface SignalCardProps {
  signal: Signal
  maxHours?: number
}

export function SignalCard({ signal, maxHours = 48 }: SignalCardProps) {
  const htc = hoursUntilClose(signal.closes_at)
  const progress = Math.max(5, Math.min(100, ((maxHours - htc) / maxHours) * 100))

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
      transition: 'border-color 0.2s',
      cursor: 'default',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(240,180,41,0.3)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, flex: 1 }}>
          {signal.question}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)', whiteSpace: 'nowrap' }}>
          {formatPct(signal.net_profit_pct * 100, 1)}
        </div>
      </div>

      <div className="signal-meta" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Entry</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{formatPrice(signal.entry_price)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Position</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{formatUSDC(signal.position_usdc, false)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Closes in</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--yellow)' }}>{formatHours(htc)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%', height: 2,
        background: 'var(--bg3)',
        borderRadius: 2, marginTop: 12, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'linear-gradient(90deg, var(--yellow), var(--green))',
          borderRadius: 2,
          transition: 'width 0.5s',
        }} />
      </div>
    </div>
  )
}
