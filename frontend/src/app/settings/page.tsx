'use client'
import { useState, useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { useCredentials } from '@/hooks/useCredentials'
import { saveCredentials, testCredentials, fetchTradingMode } from '@/lib/api'
import type { CredentialsTestResponse } from '@/types'

const SIG_TYPE_OPTIONS = [
  { value: 1, label: 'POLY_PROXY (Email / Magic Link)' },
  { value: 0, label: 'EOA (MetaMask / Hardware Wallet)' },
  { value: 2, label: 'GNOSIS_SAFE (Multisig)' },
]

export default function SettingsPage() {
  const { credentials, isLoading, mutate } = useCredentials()

  const [privateKey, setPrivateKey] = useState('')
  const [sigType, setSigType] = useState(1)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<CredentialsTestResponse | null>(null)
  const [tradingMode, setTradingMode] = useState<string>('paper')

  useEffect(() => {
    if (credentials) {
      setSigType(credentials.signature_type ?? 1)
    }
  }, [credentials])

  useEffect(() => {
    fetchTradingMode().then(r => setTradingMode(r.mode)).catch(() => {})
  }, [])

  async function handleSave() {
    if (!privateKey.trim()) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    setTestResult(null)
    try {
      // Strip 0x prefix if user included it
      let pk = privateKey.trim()
      if (pk.startsWith('0x')) pk = pk.slice(2)
      const result = await saveCredentials({ private_key: pk, signature_type: sigType })
      await mutate()
      setPrivateKey('')
      setSaved(true)
      if (result.errors && result.errors.length > 0) {
        setSaveError(result.errors.join('; '))
      }
      setTimeout(() => setSaved(false), 5000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testCredentials()
      setTestResult(result)
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--bg2)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    color: 'var(--text)',
    fontFamily: 'var(--mono)',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: 'var(--mono)',
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    color: 'var(--text3)',
    marginBottom: 6,
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    borderRadius: 14,
    border: '1px solid var(--border)',
    padding: 24,
    marginBottom: 20,
  }

  return (
    <AppShell activePage="settings" title="Settings">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>Settings</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            Polymarket account credentials &middot; trading mode: {tradingMode.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: credentials?.configured ? 'var(--green)' : 'var(--red)',
            boxShadow: credentials?.configured ? '0 0 8px var(--green)' : '0 0 8px var(--red)',
          }} />
          <span style={{ fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 700 }}>
            Account Status
          </span>
        </div>

        {isLoading ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text3)' }}>Loading...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div>
              <div style={labelStyle}>Private Key</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: credentials?.configured ? 'var(--green)' : 'var(--text3)' }}>
                {credentials?.configured ? credentials.private_key_masked : 'Not configured'}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Funder Address</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: credentials?.funder_address ? 'var(--text)' : 'var(--text3)', wordBreak: 'break-all' }}>
                {credentials?.funder_address || 'Auto-derived on save'}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Signature Type</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>
                {SIG_TYPE_OPTIONS.find(o => o.value === credentials?.signature_type)?.label ?? 'Unknown'}
              </div>
            </div>
            <div>
              <div style={labelStyle}>API Credentials</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: credentials?.has_api_creds ? 'var(--green)' : 'var(--text3)' }}>
                {credentials?.has_api_creds ? 'Derived' : 'Not yet'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Configure Card */}
      <div style={cardStyle}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
          Configure Credentials
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', marginBottom: 20 }}>
          Paste your private key. The funder address and API credentials are auto-derived.
        </div>

        {/* Private Key */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Private Key (64 hex chars, without 0x prefix)</label>
          <input
            type="password"
            value={privateKey}
            onChange={e => setPrivateKey(e.target.value)}
            placeholder="paste your private key here..."
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,232,122,0.15)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border2)'; e.currentTarget.style.boxShadow = 'none' }}
          />
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
            Export from: polymarket.com/settings &rarr; Export Private Key
          </div>
        </div>

        {/* Signature Type */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Wallet Type</label>
          <select
            value={sigType}
            onChange={e => setSigType(Number(e.target.value))}
            style={{
              ...inputStyle,
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              paddingRight: 32,
            }}
          >
            {SIG_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
            If you log in to Polymarket with email &rarr; use POLY_PROXY
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleSave}
            disabled={saving || !privateKey.trim()}
            style={{
              padding: '10px 24px',
              background: privateKey.trim() ? 'var(--green)' : 'var(--surface2)',
              color: privateKey.trim() ? '#000' : 'var(--text3)',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'var(--sans)',
              fontSize: 13,
              fontWeight: 700,
              cursor: privateKey.trim() ? 'pointer' : 'not-allowed',
              opacity: saving ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            {saving ? 'Saving...' : 'Save & Derive'}
          </button>

          {credentials?.configured && (
            <button
              onClick={handleTest}
              disabled={testing}
              style={{
                padding: '10px 24px',
                background: 'transparent',
                color: 'var(--cyan)',
                border: '1px solid var(--cyan)',
                borderRadius: 8,
                fontFamily: 'var(--sans)',
                fontSize: 13,
                fontWeight: 600,
                cursor: testing ? 'not-allowed' : 'pointer',
                opacity: testing ? 0.6 : 1,
                transition: 'all 0.2s',
              }}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          )}

          {saved && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--green)' }}>
              Saved successfully
            </span>
          )}
          {saveError && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--red)' }}>
              {saveError}
            </span>
          )}
        </div>

        {/* Test Result */}
        {testResult && (
          <div style={{
            marginTop: 14,
            padding: '10px 14px',
            borderRadius: 8,
            background: testResult.success ? 'rgba(0,232,122,0.08)' : 'rgba(255,61,90,0.08)',
            border: `1px solid ${testResult.success ? 'var(--green)' : 'var(--red)'}`,
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: testResult.success ? 'var(--green)' : 'var(--red)',
          }}>
            {testResult.success ? 'CLOB API connection successful' : testResult.message}
            {testResult.open_orders !== undefined && (
              <span style={{ color: 'var(--text3)', marginLeft: 10 }}>
                ({testResult.open_orders} open orders)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info Card */}
      <div style={{ ...cardStyle, background: 'var(--bg2)', borderColor: 'var(--border)' }}>
        <div style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 700, marginBottom: 10, color: 'var(--text2)' }}>
          How it works
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
          1. Paste your private key (exported from polymarket.com/settings)<br />
          2. The system auto-derives your <strong style={{ color: 'var(--text2)' }}>funder address</strong> (proxy wallet) via CREATE2<br />
          3. The system auto-derives your <strong style={{ color: 'var(--text2)' }}>API credentials</strong> (key + secret + passphrase) via CLOB API<br />
          4. Click &quot;Test Connection&quot; to verify everything works<br />
          5. Credentials are stored in the database &mdash; never committed to git<br />
          <br />
          <strong style={{ color: 'var(--text2)' }}>OpenClaw deployment:</strong> Set POLYMARKET_PRIVATE_KEY as a secret in the OpenClaw panel.
          The system reads from DB first, then falls back to environment variables.
        </div>
      </div>
    </AppShell>
  )
}
