'use client'
import { useEffect, useState } from 'react'
import { getAuthUser } from '@/lib/auth'

export function useAuth() {
  const [user, setUser] = useState<{ name: string; initials: string } | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setUser(getAuthUser())
    setChecked(true)
  }, [])

  return { user, isAuthenticated: !!user, checked }
}
