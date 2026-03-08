'use client'
import useSWR from 'swr'
import { fetchConfig, updateConfig } from '@/lib/api'
import type { BotConfig } from '@/types'

export function useConfig() {
  const { data, error, isLoading, mutate } = useSWR('/config', fetchConfig, {
    refreshInterval: 10_000,
  })

  async function saveConfig(cfg: Partial<Omit<BotConfig, 'id' | 'updated_at'>>) {
    const updated = await updateConfig(cfg)
    await mutate(updated, false)
    return updated
  }

  return { config: data, error, isLoading, saveConfig }
}
