'use client'
import useSWR from 'swr'
import { fetchNegRiskStats, fetchNegRiskOpenSignals, fetchNegRiskSignals } from '@/lib/api'

export function useNegRiskStats() {
  const { data, error, isLoading } = useSWR('/negrisk/stats', fetchNegRiskStats, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { stats: data, error, isLoading }
}

export function useNegRiskOpenSignals() {
  const { data, error, isLoading } = useSWR('/negrisk/signals/open', fetchNegRiskOpenSignals, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading }
}

export function useNegRiskSignals(params?: { status?: string; limit?: number; offset?: number }) {
  const key = `/negrisk/signals?${JSON.stringify(params ?? {})}`
  const { data, error, isLoading } = useSWR(key, () => fetchNegRiskSignals(params), {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading }
}
