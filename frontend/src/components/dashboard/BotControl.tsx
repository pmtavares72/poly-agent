'use client'
import { useState } from 'react'
import { useBot } from '@/hooks/useBot'
import { timeAgo } from '@/lib/format'

export function BotControl() {
  const { bot, actionLoading, actionError, toggle, triggerScan } = useBot()
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const enabled = Boolean(bot?.enabled)
  const scanning = Boolean(bot?.pid_alive)

  async function handleScanNow() {
    setScanMsg(null)
    const result = await triggerScan()
    if (result) {
      setScanMsg(result.message)
      setTimeout(() => setScanMsg(null), 10_000)
    }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${enabled ? 'rgba(0,232,122,0.2)' : 'var(--border)'}`,
      borderRadius: 14,
      padding: '20px 22px',
      position: 'relative',
      overflow: 'hidden',
      marginBottom: 24,
      transition: 'border-color 0.3s',
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: enabled
          ? 'linear-gradient(90deg, transparent, var(--green), transparent)'
          : 'linear-gradient(90deg, transparent, var(--text3), transparent)',
        transition: 'background 0.3s',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        {/* Left: status info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Status indicator */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: enabled ? 'var(--green-dim)' : 'var(--surface2)',
              border: `1px solid ${enabled ? 'rgba(0,232,122,0.3)' : 'var(--border2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>
              {scanning ? '⟳' : enabled ? '◈' : '◉'}
            </div>
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 10, height: 10, borderRadius: '50%',
              background: enabled ? 'var(--green)' : 'var(--text3)',
              border: '2px solid var(--surface)',
              boxShadow: enabled ? '0 0 6px var(--green)' : 'none',
            }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Bond Hunter</span>
              <span style={{
                fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em',
                textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
                background: enabled ? 'var(--green-dim)' : 'var(--surface2)',
                color: enabled ? 'var(--green)' : 'var(--text3)',
                border: `1px solid ${enabled ? 'rgba(0,232,122,0.25)' : 'var(--border)'}`,
              }}>
                {scanning ? 'SCANNING' : enabled ? 'ACTIVE' : 'STOPPED'}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
              {bot?.last_scan_at
                ? <>Last scan: <span style={{ color: 'var(--text2)' }}>{timeAgo(bot.last_scan_at)}</span> · {bot.scan_count} total scans</>
                : 'No scans yet'
              }
            </div>
            {bot?.last_error && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--red)', marginTop: 2 }}>
                ⚠ {bot.last_error}
              </div>
            )}
            {scanMsg && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--green)', marginTop: 2 }}>
                ✓ {scanMsg}
              </div>
            )}
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Scan now button — only when enabled */}
          {enabled && (
            <button
              onClick={handleScanNow}
              disabled={actionLoading}
              style={{
                padding: '8px 14px',
                background: 'transparent',
                color: actionLoading ? 'var(--text3)' : 'var(--cyan)',
                border: '1px solid rgba(0,194,255,0.3)',
                borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11,
                cursor: actionLoading ? 'default' : 'pointer',
                letterSpacing: '0.06em', transition: 'all 0.2s',
              }}
            >
              {actionLoading ? '...' : '▶ Scan Now'}
            </button>
          )}

          {/* Toggle start/stop */}
          <button
            onClick={toggle}
            disabled={actionLoading}
            style={{
              padding: '8px 20px',
              background: enabled ? 'var(--red-dim)' : 'var(--green)',
              color: enabled ? 'var(--red)' : '#000',
              border: enabled ? '1px solid rgba(255,61,90,0.3)' : 'none',
              borderRadius: 8, fontFamily: 'var(--sans)', fontSize: 12,
              fontWeight: 700, cursor: actionLoading ? 'default' : 'pointer',
              letterSpacing: '0.04em',
              boxShadow: enabled ? 'none' : '0 0 20px var(--green-glow)',
              transition: 'all 0.2s',
            }}
          >
            {actionLoading ? '...' : enabled ? '⏹ Stop Bot' : '▶ Start Bot'}
          </button>
        </div>
      </div>

      {actionError && (
        <div style={{
          marginTop: 12, fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--red)', background: 'var(--red-dim)',
          border: '1px solid rgba(255,61,90,0.2)',
          borderRadius: 6, padding: '6px 10px',
        }}>⚠ {actionError}</div>
      )}
    </div>
  )
}
