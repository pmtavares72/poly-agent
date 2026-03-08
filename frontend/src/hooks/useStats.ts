'use client'
import useSWR from 'swr'
import { fetchStats } from '@/lib/api'

export function useStats() {
  const { data, error, isLoading } = useSWR('/stats', fetchStats, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  return { stats: data, error, isLoading }
}
