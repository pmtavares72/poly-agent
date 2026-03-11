'use client'
import useSWR from 'swr'
import { fetchCredentials } from '@/lib/api'

export function useCredentials() {
  const { data, error, isLoading, mutate } = useSWR('/settings/credentials', fetchCredentials, {
    refreshInterval: 30_000,
  })

  return { credentials: data, error, isLoading, mutate }
}
