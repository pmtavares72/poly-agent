'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetchBotStatus, enableBot, disableBot, scanNow, setTradingMode, togglePaperMode, toggleLiveMode } from '@/lib/api'

export function useBot() {
  const { data, error, isLoading, mutate } = useSWR('/bot', fetchBotStatus, {
    refreshInterval: 5_000,
  })
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  async function toggle() {
    setActionLoading(true)
    setActionError(null)
    try {
      if (data?.enabled) {
        await disableBot()
      } else {
        await enableBot()
      }
      await mutate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setActionLoading(false)
    }
  }

  async function triggerScan() {
    setActionLoading(true)
    setActionError(null)
    try {
      const result = await scanNow()
      await mutate()
      return result
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unknown error')
      return null
    } finally {
      setActionLoading(false)
    }
  }

  async function switchMode(mode: string) {
    setActionLoading(true)
    setActionError(null)
    try {
      await setTradingMode(mode)
      await mutate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setActionLoading(false)
    }
  }

  async function togglePaper(enabled: boolean) {
    setActionLoading(true)
    setActionError(null)
    try {
      await togglePaperMode(enabled)
      await mutate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setActionLoading(false)
    }
  }

  async function toggleLive(enabled: boolean) {
    setActionLoading(true)
    setActionError(null)
    try {
      await toggleLiveMode(enabled)
      await mutate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setActionLoading(false)
    }
  }

  return {
    bot: data,
    error,
    isLoading,
    actionLoading,
    actionError,
    toggle,
    triggerScan,
    switchMode,
    togglePaper,
    toggleLive,
  }
}
