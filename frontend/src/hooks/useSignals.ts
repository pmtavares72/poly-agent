'use client'
import useSWR from 'swr'
import { fetchSignals, fetchOpenSignals, fetchOpenSignalsLive } from '@/lib/api'

export function useSignals(params?: { status?: string; limit?: number; offset?: number }) {
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

export function useOpenSignalsLive() {
  const { data, error, isLoading, mutate } = useSWR('/signals/open/live', fetchOpenSignalsLive, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading, mutate }
}
