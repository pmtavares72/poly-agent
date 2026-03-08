import type { Signal } from '@/types'
import { SignalCard } from './SignalCard'
import { Badge } from '@/components/ui/Badge'

interface ActiveSignalsProps {
  signals: Signal[]
}

export function ActiveSignals({ signals }: ActiveSignalsProps) {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Active Signals</div>
        <Badge variant="open" label={`● ${signals.length} open`} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {signals.length === 0 ? (
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 11,
            color: 'var(--text3)', padding: '20px 0',
          }}>No active signals</div>
        ) : (
          signals.map(s => <SignalCard key={s.id} signal={s} />)
        )}
      </div>
    </div>
  )
}
