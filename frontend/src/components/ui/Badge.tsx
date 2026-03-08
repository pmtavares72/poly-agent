type BadgeVariant = 'open' | 'win' | 'loss'

const styles: Record<BadgeVariant, React.CSSProperties> = {
  open: {
    background: 'var(--yellow-dim)',
    color: 'var(--yellow)',
    border: '1px solid rgba(240,180,41,0.2)',
  },
  win: {
    background: 'var(--green-dim)',
    color: 'var(--green)',
    border: '1px solid rgba(0,232,122,0.2)',
  },
  loss: {
    background: 'var(--red-dim)',
    color: 'var(--red)',
    border: '1px solid rgba(255,61,90,0.2)',
  },
}

const labels: Record<BadgeVariant, string> = {
  open: '● open',
  win:  '✓ yes',
  loss: '✗ no',
}

interface BadgeProps {
  variant: BadgeVariant
  label?: string
}

export function Badge({ variant, label }: BadgeProps) {
  return (
    <span
      style={{
        ...styles[variant],
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 4,
        fontFamily: 'var(--mono)',
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {label ?? labels[variant]}
    </span>
  )
}
