'use client'

import { useEffect, useState } from 'react'
import { supabase, TradeAlert } from '@/lib/supabase'

export default function AlertPanel() {
  const [alerts, setAlerts] = useState<TradeAlert[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Fetch initial alerts
    fetchAlerts()

    // Subscribe to new alerts
    const subscription = supabase
      .channel('trade_alerts_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_alerts' },
        (payload) => {
          const newAlert = payload.new as TradeAlert
          setAlerts(prev => [newAlert, ...prev.slice(0, 49)])
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function fetchAlerts() {
    const { data } = await supabase
      .from('trade_alerts')
      .select('*')
      .eq('acknowledged', false)
      .order('created_at', { ascending: false })
      .limit(50)

    setAlerts(data || [])
  }

  async function acknowledgeAlert(alertId: number) {
    await supabase
      .from('trade_alerts')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .eq('id', alertId)

    setAlerts(prev => prev.filter(a => a.id !== alertId))
  }

  async function acknowledgeAll() {
    const ids = alerts.map(a => a.id)
    if (ids.length === 0) return

    await supabase
      .from('trade_alerts')
      .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
      .in('id', ids)

    setAlerts([])
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
    return date.toLocaleDateString()
  }

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'border-l-red-500 bg-red-900/20'
      case 'warning':
        return 'border-l-yellow-500 bg-yellow-900/10'
      default:
        return 'border-l-blue-500 bg-blue-900/10'
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '🚨'
      case 'warning':
        return '⚠️'
      default:
        return 'ℹ️'
    }
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  return (
    <div className="bg-gray-800 rounded-lg">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Alerts</h2>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          {alerts.length > 0 && (
            <span className="px-2 py-0.5 bg-red-600 rounded-full text-xs font-semibold">
              {alerts.length}
            </span>
          )}
        </div>
        {alerts.length > 0 && (
          <button
            onClick={acknowledgeAll}
            className="text-xs text-gray-400 hover:text-gray-300"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Alert List */}
      <div className="max-h-[500px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <div className="text-2xl mb-2">🔔</div>
            <div className="text-sm">No pending alerts</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`p-3 border-l-2 ${getSeverityStyles(alert.severity)} hover:bg-gray-750 transition-colors`}
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span>{getSeverityIcon(alert.severity)}</span>
                      <span className="font-medium text-sm truncate">{alert.title}</span>
                    </div>
                    {alert.description && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">
                        {alert.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                      <span>{formatTime(alert.created_at)}</span>
                      <span>•</span>
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
                    className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-gray-200"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      {alerts.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
          <span>
            {alerts.filter(a => a.severity === 'critical').length} critical,{' '}
            {alerts.filter(a => a.severity === 'warning').length} warnings
          </span>
        </div>
      )}
    </div>
  )
}
