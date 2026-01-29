'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type Status = 'healthy' | 'degraded' | 'down'

interface ServiceStatus {
  status: Status
  latency_ms: number
  detail?: string
  last_trade_at?: string
  last_wallet_update?: string
  wallet_count?: number
  wallet_discovery_enabled?: boolean
}

export interface HealthData {
  overall: Status
  services: {
    vps_service: ServiceStatus
    polymarket_api: ServiceStatus
    supabase: ServiceStatus
  }
  checked_at: string
}

export function useServerHealth(pollInterval: number = 60000) {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setHealth(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const setPollInterval = useCallback((ms: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(fetchHealth, ms)
  }, [fetchHealth])

  useEffect(() => {
    fetchHealth()
    intervalRef.current = setInterval(fetchHealth, pollInterval)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchHealth, pollInterval])

  return { health, isLoading, error, refetch: fetchHealth, setPollInterval }
}
