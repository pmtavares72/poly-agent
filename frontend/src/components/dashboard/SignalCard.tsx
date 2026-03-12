'use client'
import { useState } from 'react'
import type { Signal } from '@/types'
import { formatPrice, formatUSDC, formatPct, hoursUntilClose, formatHours, timeAgo } from '@/lib/format'
import { sellSignal, sellSignalPaper } from '@/lib/api'

interface SignalCardProps {
  signal: Signal
  maxHours?: number
  onSold?: () => void
}

export function SignalCard({ signal, maxHours = 48, onSold }: SignalCardProps) {
  const htc = hoursUntilClose(signal.closes_at)
  const progress = Math.max(5, Math.min(100, ((maxHours - htc) / maxHours) * 100))
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const [selling, setSelling] = useState(false)
  const [soldMsg, setSoldMsg] = useState<string | null>(null)

  const hasLiveData = signal.current_price != null && signal.current_price > 0

  async function handleSell(reason: string) {
    if (confirmAction !== reason) {
      setConfirmAction(reason)
      setTimeout(() => setConfirmAction(null), 3000)
      return
    }
    setSelling(true)
    try {
      const sellFn = signal.mode === 'live' ? sellSignal : sellSignalPaper
      const result = await sellFn(signal.id, reason)
      setSoldMsg(`${result.exit_reason === 'manual_tp' ? 'Profit taken' : 'Sold'}: ${result.pnl_usdc >= 0 ? '+' : ''}$${result.pnl_usdc.toFixed(2)}`)
      onSold?.()
    } catch (e) {
      setSoldMsg(`Error: ${e instanceof Error ? e.message : 'Failed'}`)
    } finally {
      setSelling(false)
      setConfirmAction(null)
    }
  }

  if (soldMsg) {
    return (
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16, textAlign: 'center',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{soldMsg}</div>
      </div>
    )
  }

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
          #{signal.id} · {timeAgo(signal.detected_at)}
          {signal.mode && <span style={{ marginLeft: 6, color: signal.mode === 'live' ? 'var(--red)' : 'var(--yellow)' }}>
            {signal.mode.toUpperCase()}
          </span>}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--green)', whiteSpace: 'nowrap' }}>
          {formatPct(signal.net_profit_pct * 100, 1)}
        </div>
      </div>

      {/* Question */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, marginBottom: 12 }}>
        {signal.question}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: hasLiveData ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Entry</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{formatPrice(signal.entry_price)}</div>
        </div>
        {hasLiveData && (
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Current</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: signal.current_price! >= signal.entry_price ? 'var(--green)' : 'var(--red)' }}>
              {formatPrice(signal.current_price!)}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Position</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{formatUSDC(signal.position_usdc, false)}</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text3)', marginBottom: 2 }}>Closes in</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: htc < 6 ? 'var(--red)' : 'var(--yellow)' }}>{formatHours(htc)}</div>
        </div>
      </div>

      {/* P&L scenarios (only when live data available) */}
      {hasLiveData && signal.pnl_if_sell_now != null && (
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'var(--bg3)', borderRadius: 8,
          fontFamily: 'var(--mono)', fontSize: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text3)' }}>If sell now:</span>
            <span style={{ color: signal.pnl_if_sell_now! >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {signal.pnl_if_sell_now! >= 0 ? '+' : ''}{formatUSDC(signal.pnl_if_sell_now!)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text3)' }}>If wait (YES):</span>
            <span style={{ color: signal.pnl_if_wait! >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {signal.pnl_if_wait! >= 0 ? '+' : ''}{formatUSDC(signal.pnl_if_wait!)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text3)' }}>Early exit cost:</span>
            <span style={{ color: 'var(--yellow)' }}>
              {formatUSDC(signal.opportunity_cost!)}
            </span>
          </div>
          {signal.stop_loss_price != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text3)' }}>Stop-loss at:</span>
              <span style={{ color: 'var(--red)' }}>{formatPrice(signal.stop_loss_price)}</span>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      {hasLiveData && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {signal.can_take_profit && (
            <button
              onClick={() => handleSell('take_profit')}
              disabled={selling}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6,
                border: 'none', cursor: selling ? 'wait' : 'pointer',
                fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                background: confirmAction === 'take_profit' ? 'var(--green)' : 'rgba(46,204,113,0.15)',
                color: confirmAction === 'take_profit' ? 'var(--bg)' : 'var(--green)',
                transition: 'all 0.2s',
              }}
            >
              {selling ? 'Selling...' : confirmAction === 'take_profit' ? 'Confirm?' : 'Take Profit'}
            </button>
          )}
          <button
            onClick={() => handleSell('manual_sell')}
            disabled={selling}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: 'none', cursor: selling ? 'wait' : 'pointer',
              fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
              background: confirmAction === 'manual_sell' ? 'var(--red)' : 'rgba(231,76,60,0.15)',
              color: confirmAction === 'manual_sell' ? 'var(--bg)' : 'var(--red)',
              transition: 'all 0.2s',
            }}
          >
            {selling ? 'Selling...' : confirmAction === 'manual_sell' ? 'Confirm?' : 'Sell'}
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div style={{
        width: '100%', height: 2,
        background: 'var(--bg3)',
        borderRadius: 2, marginTop: 10, overflow: 'hidden',
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
