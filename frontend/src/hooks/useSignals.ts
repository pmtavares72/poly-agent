'use client'
import useSWR from 'swr'
import { fetchSignals, fetchOpenSignals, fetchOpenSignalsLive } from '@/lib/api'

export function useSignals(params?: { status?: string; limit?: number; offset?: number; mode?: string }) {
  const key = `/signals?${JSON.stringify(params ?? {})}`
  const { data, error, isLoading } = useSWR(key, () => fetchSignals(params), {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading }
}

export function useOpenSignals() {
  const { data, error, isLoading } = useSWR('/signals/open', fetchOpenSignals, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading }
}

export function useOpenSignalsLive(mode?: string) {
  const key = mode ? `/signals/open/live?mode=${mode}` : '/signals/open/live'
  const { data, error, isLoading, mutate } = useSWR(key, () => fetchOpenSignalsLive(mode), {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading, mutate }
}
