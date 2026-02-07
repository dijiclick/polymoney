'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, InsiderAlert, InsiderFilter } from '@/lib/supabase'

interface UseInsiderAlertsOptions {
  filter: InsiderFilter
  maxAlerts?: number
}

interface UseInsiderAlertsReturn {
  alerts: InsiderAlert[]
  isConnected: boolean
  alertCount: number
  clearAlerts: () => void
}

function filterAlert(alert: InsiderAlert, f: InsiderFilter): boolean {
  if (f.minScore && alert.score_total < f.minScore) return false
  if (f.freshWalletsOnly && alert.score_wallet_age < 60) return false
  if (f.extremeOddsOnly && alert.score_extreme_odds < 60) return false
  if (f.copyableOnly && alert.profitability_status !== 'copyable') return false
  return true
}

export function useInsiderAlerts({ filter, maxAlerts = 100 }: UseInsiderAlertsOptions): UseInsiderAlertsReturn {
  const [alerts, setAlerts] = useState<InsiderAlert[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  const filterRef = useRef(filter)

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  const fetchAlerts = useCallback(async () => {
    let query = supabase
      .from('insider_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(maxAlerts)

    if (filter.minScore) query = query.gte('score_total', filter.minScore)
    if (filter.freshWalletsOnly) query = query.gte('score_wallet_age', 60)
    if (filter.extremeOddsOnly) query = query.gte('score_extreme_odds', 60)
    if (filter.copyableOnly) query = query.eq('profitability_status', 'copyable')

    const { data } = await query
    setAlerts(data || [])
    setAlertCount(data?.length || 0)
  }, [filter, maxAlerts])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  useEffect(() => {
    const channel = supabase.channel('insider_feed')

    channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'insider_alerts' },
        (payload) => {
          const newAlert = payload.new as InsiderAlert
          if (filterAlert(newAlert, filterRef.current)) {
            setAlertCount(c => c + 1)
            setAlerts(prev => {
              // Insert sorted by score (highest first), then recency
              const updated = [newAlert, ...prev]
              updated.sort((a, b) => {
                if (b.score_total !== a.score_total) return b.score_total - a.score_total
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              })
              return updated.slice(0, maxAlerts)
            })
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [maxAlerts])

  const clearAlerts = useCallback(() => {
    setAlerts([])
    setAlertCount(0)
  }, [])

  return {
    alerts,
    isConnected,
    alertCount,
    clearAlerts,
  }
}
