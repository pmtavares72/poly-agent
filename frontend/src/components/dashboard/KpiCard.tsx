type AccentColor = 'green' | 'red' | 'purple' | 'yellow'

const accentMap: Record<AccentColor, string> = {
  green:  'var(--green)',
  red:    'var(--red)',
  purple: 'var(--purple)',
  yellow: 'var(--yellow)',
}

interface KpiCardProps {
  icon: string
  label: string
  value: string
  delta: string
  deltaPositive?: boolean
  accent: AccentColor
}

export function KpiCard({ icon, label, value, delta, deltaPositive, accent }: KpiCardProps) {
  const color = accentMap[accent]
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 22px',
      position: 'relative',
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border2)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
      }} />

      <span style={{ fontSize: 18, marginBottom: 12, display: 'block' }}>{icon}</span>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.15em',
        textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 26, color: 'var(--text)',
        letterSpacing: '-0.02em',
      }}>{value}</div>
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10, marginTop: 4,
        color: deltaPositive ? 'var(--green)' : 'var(--text3)',
      }}>{delta}</div>
    </div>
  )
}
