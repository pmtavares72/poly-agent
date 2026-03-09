'use client'
import useSWR from 'swr'
import { fetchStrategies, fetchStrategy, fetchStrategySignals, fetchStrategyStats } from '@/lib/api'

export function useStrategies() {
  const { data, error, isLoading, mutate } = useSWR('/strategies', fetchStrategies, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { strategies: data?.strategies, error, isLoading, mutate }
}

export function useStrategy(slug: string) {
  const { data, error, isLoading, mutate } = useSWR(
    `/strategies/${slug}`,
    () => fetchStrategy(slug),
    { refreshInterval: 30_000, revalidateOnFocus: true }
  )
  return { strategy: data, error, isLoading, mutate }
}

export function useStrategySignals(slug: string, params?: { status?: string; limit?: number; offset?: number }) {
  const key = `/strategies/${slug}/signals?${JSON.stringify(params ?? {})}`
  const { data, error, isLoading } = useSWR(key, () => fetchStrategySignals(slug, params), {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  })
  return { signals: data, error, isLoading }
}

export function useStrategyStats(slug: string) {
  const { data, error, isLoading } = useSWR(
    `/strategies/${slug}/stats`,
    () => fetchStrategyStats(slug),
    { refreshInterval: 15_000, revalidateOnFocus: true }
  )
  return { stats: data, error, isLoading }
}
