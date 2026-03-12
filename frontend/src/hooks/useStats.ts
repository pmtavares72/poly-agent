'use client'
import useSWR from 'swr'
import { fetchStats } from '@/lib/api'

export function useStats(mode?: string) {
  const key = mode ? `/stats?mode=${mode}` : '/stats'
  const { data, error, isLoading } = useSWR(key, () => fetchStats(mode), {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { stats: data, error, isLoading }
}
