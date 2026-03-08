const KEY = 'polyagent_auth'

export function login(email: string, password: string): boolean {
  if (email === 'admin@polyagent.io' && password === 'admin') {
    localStorage.setItem(KEY, JSON.stringify({ authenticated: true, name: 'P. Tavares', initials: 'PT' }))
    return true
  }
  return false
}

export function logout(): void {
  localStorage.removeItem(KEY)
}

export function getAuthUser(): { name: string; initials: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data.authenticated ? { name: data.name, initials: data.initials } : null
  } catch {
    return null
  }
}
