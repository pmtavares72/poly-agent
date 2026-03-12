'use client'
import { useState } from 'react'

interface ModeToggleProps {
  mode: string
  onSwitch: (mode: string) => Promise<void>
  disabled?: boolean
}

export function ModeToggle({ mode, onSwitch, disabled }: ModeToggleProps) {
  const [confirming, setConfirming] = useState(false)
  const isLive = mode === 'live'

  async function handleClick() {
    if (isLive) {
      // Switching to paper — no confirmation needed
      await onSwitch('paper')
      return
    }
    // Switching to live — require confirmation
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    setConfirming(false)
    await onSwitch('live')
  }

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${isLive ? 'var(--red)' : 'var(--yellow)'}`,
        background: isLive ? 'rgba(231,76,60,0.1)' : 'rgba(240,180,41,0.1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.08em',
        color: isLive ? 'var(--red)' : 'var(--yellow)',
        transition: 'all 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isLive ? 'var(--red)' : 'var(--yellow)',
      }} />
      {confirming ? 'CONFIRM LIVE?' : isLive ? 'LIVE' : 'PAPER'}
    </button>
  )
}
