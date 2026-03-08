interface LogoMarkProps {
  size?: 'sm' | 'md'
}

export function LogoMark({ size = 'md' }: LogoMarkProps) {
  const dim = size === 'sm' ? { box: 28, font: 12, radius: 8 } : { box: 36, font: 16, radius: 10 }
  return (
    <div
      style={{
        width: dim.box, height: dim.box,
        background: 'var(--green)',
        borderRadius: dim.radius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--mono)',
        fontSize: dim.font,
        fontWeight: 500,
        color: '#000',
        boxShadow: '0 0 20px var(--green-glow)',
        flexShrink: 0,
      }}
    >
      P
    </div>
  )
}
