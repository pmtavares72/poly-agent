'use client'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { PnlPoint } from '@/types'
import { formatUSDC, formatDate } from '@/lib/format'

interface PnlChartProps {
  data: PnlPoint[]
  totalPnl: number
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border2)',
      borderRadius: 8, padding: '8px 12px',
      fontFamily: 'var(--mono)', fontSize: 11,
      color: 'var(--green)',
    }}>
      {formatUSDC(payload[0].value)}
    </div>
  )
}

export function PnlChart({ data, totalPnl }: PnlChartProps) {
  const formatted = data.map(p => ({
    ...p,
    date: formatDate(p.ts),
    value: p.cumulative_pnl,
  }))

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '22px 24px',
      marginBottom: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>PnL Evolution</div>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10,
          padding: '3px 8px', borderRadius: 4,
          background: 'var(--green-dim)', color: 'var(--green)',
          border: '1px solid rgba(0,232,122,0.2)',
        }}>{formatUSDC(totalPnl)} total</span>
      </div>

      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#00e87a" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#00e87a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date"
              tick={{ fontFamily: 'var(--mono)', fontSize: 8, fill: 'rgba(255,255,255,0.3)' }}
              tickLine={false} axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,232,122,0.2)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#00e87a"
              strokeWidth={2}
              fill="url(#pnlGrad)"
              dot={false}
              activeDot={{ r: 4, fill: '#00e87a', stroke: 'none' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
