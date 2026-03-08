'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { login, getAuthUser } from '@/lib/auth'
import { LogoMark } from '@/components/ui/LogoMark'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('admin@polyagent.io')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getAuthUser()) router.push('/dashboard')
  }, [router])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTimeout(() => {
      if (login(email, password)) {
        router.push('/dashboard')
      } else {
        setError('Invalid credentials')
        setLoading(false)
      }
    }, 600)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {/* Radial gradients */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 80% 60% at 20% 80%, rgba(0,232,122,0.06) 0%, transparent 60%),
          radial-gradient(ellipse 60% 80% at 80% 20%, rgba(124,58,237,0.08) 0%, transparent 60%),
          radial-gradient(ellipse 40% 40% at 50% 50%, rgba(0,194,255,0.04) 0%, transparent 70%)
        `,
      }} />

      {/* Grid background */}
      <div className="login-grid-bg" style={{ position: 'absolute', inset: 0 }} />

      {/* Scan line */}
      <div className="animate-scan" style={{
        position: 'absolute', width: '100%', height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(0,232,122,0.4), transparent)',
      }} />

      {/* Floating data artifacts */}
      <div style={{
        position: 'absolute', top: '15%', left: '8%',
        opacity: 0.15, fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--green)', lineHeight: 1.8,
      }}>
        BOND_HUNTER v2.1<br />
        WIN_RATE: 91.3%<br />
        SIGNALS: 847<br />
        PNL: +$2,341.22
      </div>
      <div style={{
        position: 'absolute', bottom: '20%', right: '6%',
        opacity: 0.12, fontFamily: 'var(--mono)', fontSize: 10,
        color: 'var(--purple)', lineHeight: 1.8, textAlign: 'right',
      }}>
        KELLY: 0.25<br />
        MIN_PROB: 0.95<br />
        MAX_HRS: 48<br />
        FEE: 0.5%
      </div>

      {/* Login card */}
      <div style={{
        position: 'relative', zIndex: 10,
        width: 420, maxWidth: 'calc(100vw - 32px)',
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 20, padding: '48px 40px',
        boxShadow: '0 0 0 1px rgba(0,232,122,0.05), 0 40px 80px rgba(0,0,0,0.6), 0 0 120px rgba(0,232,122,0.04), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <LogoMark size="md" />
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>PolyAgent</span>
        </div>

        <div style={{
          fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)',
          letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 36,
        }}>Prediction Market Intelligence</div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
          <div className="animate-pulse-dot" style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--green)', boxShadow: '0 0 8px var(--green)',
          }} />
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--green)',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>System Online · 1 strategy active</span>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text3)',
            marginBottom: 8, display: 'block',
          }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="trader@polyagent.io"
            style={{
              width: '100%', background: 'var(--bg2)',
              border: '1px solid var(--border2)', borderRadius: 10,
              padding: '12px 16px', color: 'var(--text)',
              fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
              marginBottom: 20, transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--green)'
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--green-dim)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border2)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />

          <label style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text3)',
            marginBottom: 8, display: 'block',
          }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••••••"
            style={{
              width: '100%', background: 'var(--bg2)',
              border: '1px solid var(--border2)', borderRadius: 10,
              padding: '12px 16px', color: 'var(--text)',
              fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
              marginBottom: 20, transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--green)'
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--green-dim)'
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border2)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          />

          {error && (
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)',
              marginBottom: 12, textAlign: 'center',
            }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: 14,
              background: loading ? 'var(--green-dim)' : 'var(--green)',
              color: loading ? 'var(--green)' : '#000',
              border: loading ? '1px solid rgba(0,232,122,0.3)' : 'none',
              borderRadius: 10, fontFamily: 'var(--sans)', fontSize: 14,
              fontWeight: 700, letterSpacing: '0.05em', cursor: loading ? 'default' : 'pointer',
              marginTop: 8, transition: 'all 0.2s',
              boxShadow: loading ? 'none' : '0 0 30px var(--green-glow)',
            }}
          >{loading ? 'CONNECTING...' : 'CONNECT →'}</button>
        </form>

        <div style={{
          marginTop: 24, textAlign: 'center',
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--text3)', letterSpacing: '0.06em',
        }}>SECURED · AES-256 · NO KEYS STORED</div>
      </div>
    </div>
  )
}
