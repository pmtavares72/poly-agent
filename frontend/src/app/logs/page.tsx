'use client'
import useSWR from 'swr'
import { AppShell } from '@/components/layout/AppShell'
import { fetchScanLogs } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import type { ScanLog } from '@/types'

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: ok ? 'var(--green)' : 'var(--red)',
      boxShadow: ok ? '0 0 5px var(--green)' : '0 0 5px var(--red)',
      marginRight: 6, flexShrink: 0,
    }} />
  )
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)', minWidth: 24, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function ScanCard({ log }: { log: ScanLog }) {
  const ok = !log.error && log.finished_at !== null
  const inProgress = !log.finished_at
  const total = log.markets_checked || 1

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${log.error ? 'rgba(255,61,90,0.3)' : inProgress ? 'rgba(0,194,255,0.2)' : 'var(--border)'}`,
      borderRadius: 12, padding: '16px 18px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Left accent */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: log.error ? 'var(--red)' : inProgress ? 'var(--cyan)' : log.signals_found > 0 ? 'var(--green)' : 'var(--border2)',
        borderRadius: '3px 0 0 3px',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot ok={ok} />
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>
              Scan #{log.id}
              {inProgress && (
                <span style={{ marginLeft: 8, color: 'var(--cyan)', fontSize: 9, letterSpacing: '0.08em' }}>● IN PROGRESS</span>
              )}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
              {timeAgo(log.started_at)}
              {log.duration_sec !== null && <> · {log.duration_sec}s</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {log.signals_found > 0 && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: 'var(--green-dim)', color: 'var(--green)',
              border: '1px solid rgba(0,232,122,0.25)',
            }}>
              +{log.signals_found} SIGNALS
            </span>
          )}
          {log.signals_resolved > 0 && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: 'rgba(0,194,255,0.08)', color: 'var(--cyan)',
              border: '1px solid rgba(0,194,255,0.2)',
            }}>
              {log.signals_resolved} RESOLVED
            </span>
          )}
          {log.error && (
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: 'var(--red-dim)', color: 'var(--red)',
              border: '1px solid rgba(255,61,90,0.25)',
            }}>
              ERROR
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px' }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Markets
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
              <span>Fetched</span>
              <span style={{ color: 'var(--text2)' }}>{log.markets_fetched}</span>
            </div>
            <Bar value={log.markets_checked} max={log.markets_fetched} color="var(--cyan)" />
            <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--text3)' }}>
              {log.markets_checked} passed pre-filters
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', marginBottom: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Filtered out
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[
              { label: 'Wash trading', value: log.skipped_wash, color: 'var(--red)' },
              { label: 'Bad spread', value: log.skipped_spread, color: 'var(--yellow)' },
              { label: 'No CLOB data', value: log.skipped_no_data, color: 'var(--text3)' },
              { label: 'Price out of range', value: log.skipped_price, color: 'var(--text3)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)' }}>
                <span>{label}</span>
                <span style={{ color: value > 0 ? color : 'var(--text3)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {log.error && (
        <div style={{
          marginTop: 10, padding: '6px 10px',
          background: 'var(--red-dim)', border: '1px solid rgba(255,61,90,0.2)',
          borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--red)',
          wordBreak: 'break-all',
        }}>
          ⚠ {log.error}
        </div>
      )}
    </div>
  )
}

export default function LogsPage() {
  const { data, isLoading, mutate } = useSWR('/scan-logs', () => fetchScanLogs(50), {
    refreshInterval: 15_000,
  })

  const logs = data?.data ?? []
  const total = data?.total ?? 0

  const totalSignals = logs.reduce((s, l) => s + (l.signals_found || 0), 0)
  const totalResolved = logs.reduce((s, l) => s + (l.signals_resolved || 0), 0)
  const errors = logs.filter(l => l.error).length
  const avgDuration = logs.filter(l => l.duration_sec).length > 0
    ? Math.round(logs.reduce((s, l) => s + (l.duration_sec || 0), 0) / logs.filter(l => l.duration_sec).length)
    : null

  return (
    <AppShell activePage="logs">
      <div style={{ padding: '28px 32px', maxWidth: 900 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
              Scan History
            </h1>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', margin: '4px 0 0' }}>
              {total} executions logged · auto-refresh 15s
            </p>
          </div>
          <button
            onClick={() => mutate()}
            style={{
              padding: '7px 14px', background: 'transparent',
              color: 'var(--cyan)', border: '1px solid rgba(0,194,255,0.3)',
              borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11,
              cursor: 'pointer', letterSpacing: '0.06em',
            }}
          >
            ↻ Refresh
          </button>
        </div>

        {/* Summary KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total Scans', value: total, color: 'var(--text)' },
            { label: 'Signals Found', value: totalSignals, color: 'var(--green)' },
            { label: 'Signals Resolved', value: totalResolved, color: 'var(--cyan)' },
            { label: errors > 0 ? `${errors} Errors` : 'No Errors', value: avgDuration !== null ? `${avgDuration}s avg` : '—', color: errors > 0 ? 'var(--red)' : 'var(--text3)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px',
            }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                {label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.02em' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Log list */}
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, height: 120 }} />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '48px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 14, color: 'var(--text2)', fontWeight: 600, marginBottom: 6 }}>No scans yet</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)' }}>
              Start the bot and run a scan to see execution history here.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {logs.map(log => <ScanCard key={log.id} log={log} />)}
          </div>
        )}
      </div>
    </AppShell>
  )
}
