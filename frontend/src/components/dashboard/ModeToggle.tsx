'use client'
import { useState } from 'react'

interface ModeToggleProps {
  paperEnabled: boolean
  liveEnabled: boolean
  onTogglePaper: (enabled: boolean) => Promise<void>
  onToggleLive: (enabled: boolean) => Promise<void>
  disabled?: boolean
}

export function ModeToggle({ paperEnabled, liveEnabled, onTogglePaper, onToggleLive, disabled }: ModeToggleProps) {
  const [confirmingLive, setConfirmingLive] = useState(false)

  async function handlePaper() {
    await onTogglePaper(!paperEnabled)
  }

  async function handleLive() {
    if (!liveEnabled) {
      if (!confirmingLive) {
        setConfirmingLive(true)
        setTimeout(() => setConfirmingLive(false), 4000)
        return
      }
      setConfirmingLive(false)
    }
    await onToggleLive(!liveEnabled)
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <ToggleBtn
        label="PAPER"
        active={paperEnabled}
        color="var(--yellow)"
        onClick={handlePaper}
        disabled={disabled}
      />
      <ToggleBtn
        label={confirmingLive ? 'CONFIRM?' : 'LIVE'}
        active={liveEnabled}
        color="var(--red)"
        onClick={handleLive}
        disabled={disabled}
      />
    </div>
  )
}

function ToggleBtn({ label, active, color, onClick, disabled }: {
  label: string
  active: boolean
  color: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 6,
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `${color}15` : 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.08em',
        color: active ? color : 'var(--text3)',
        transition: 'all 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: active ? color : 'var(--text3)',
        opacity: active ? 1 : 0.3,
      }} />
      {label}
      <span style={{ fontSize: 8, marginLeft: 2, opacity: 0.7 }}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}
