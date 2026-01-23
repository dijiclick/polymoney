'use client'

import { useEffect, useState } from 'react'
import { supabase, TradeAlert } from '@/lib/supabase'

interface InsiderAlertsProps {
  maxAlerts?: number
}

export default function InsiderAlerts({ maxAlerts = 50 }: InsiderAlertsProps) {
  const [alerts, setAlerts] = useState<TradeAlert[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    fetchAlerts()

    // Subscribe to new alerts
    const subscription = supabase
      .channel('insider_alerts_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_alerts' },
        (payload) => {
          const newAlert = payload.new as TradeAlert
          // Only show insider-related alerts
          if (newAlert.alert_type === 'insider_activity' || newAlert.alert_type === 'whale_trade') {
            setAlerts(prev => [newAlert, ...prev.slice(0, maxAlerts - 1)])
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [maxAlerts])

  async function fetchAlerts() {
    const { data } = await supabase
      .from('trade_alerts')
      .select('*')
      .in('alert_type', ['insider_activity', 'whale_trade'])
      .eq('acknowledged', false)
      .order('created_at', { ascending: false })
      .limit(maxAlerts)

    setAlerts(data || [])
  }

  async function acknowledgeAlert(alertId: number) {
    await supabase
      .from('trade_alerts')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', alertId)

    setAlerts(prev => prev.filter(a => a.id !== alertId))
  }

  async function clearAllAlerts() {
    const ids = alerts.map(a => a.id)
    if (ids.length === 0) return

    await supabase
      .from('trade_alerts')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .in('id', ids)

    setAlerts([])
  }

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-l-red-500 bg-red-900/20'
      case 'warning':
        return 'border-l-yellow-500 bg-yellow-900/20'
      default:
        return 'border-l-blue-500 bg-blue-900/20'
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '!!!'
      case 'warning':
        return '!'
      default:
        return 'i'
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Alerts</h3>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {alerts.length > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {alerts.length}
              </span>
            )}
          </div>
          {alerts.length > 0 && (
            <button
              onClick={clearAllAlerts}
              className="text-xs text-gray-400 hover:text-white"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Alerts List */}
      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No unacknowledged alerts
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 border-l-2 ${getSeverityStyle(alert.severity)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${
                        alert.severity === 'critical' ? 'text-red-400' :
                        alert.severity === 'warning' ? 'text-yellow-400' : 'text-blue-400'
                      }`}>
                        {getSeverityIcon(alert.severity)}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {alert.title}
                      </span>
                    </div>
                    {alert.description && (
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {alert.description}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <span>{formatTimeAgo(alert.created_at)}</span>
                      <span>·</span>
                      <a
                        href={`/traders/${alert.trader_address}`}
                        className="text-blue-400 hover:underline"
                      >
                        {formatAddress(alert.trader_address)}
                      </a>
                    </div>
                  </div>
                  <button
                    onClick={() => acknowledgeAlert(alert.id)}
                    className="text-gray-500 hover:text-white p-1"
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
