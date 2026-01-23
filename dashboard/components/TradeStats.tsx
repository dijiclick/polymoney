'use client'

import { useEffect, useState } from 'react'
import { supabase, TradeStats } from '@/lib/supabase'

export default function TradeStatsCard() {
  const [stats, setStats] = useState<TradeStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchStats() {
    try {
      const { data } = await supabase
        .from('v_trade_volume_24h')
        .select('*')
        .single()

      if (data) {
        setStats(data as TradeStats)
      }
    } catch (error) {
      console.error('Failed to fetch trade stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return '0'
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toLocaleString()
  }

  const formatUsd = (num: number | null | undefined) => {
    if (num === null || num === undefined) return '$0'
    return `$${formatNumber(num)}`
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-4">Last 24 Hours</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-2xl font-bold text-white">
            {formatNumber(stats?.total_trades)}
          </div>
          <div className="text-xs text-gray-500">Total Trades</div>
        </div>

        <div>
          <div className="text-2xl font-bold text-green-400">
            {formatUsd(stats?.total_volume)}
          </div>
          <div className="text-xs text-gray-500">Total Volume</div>
        </div>

        <div>
          <div className="text-xl font-semibold text-white">
            {formatNumber(stats?.unique_traders)}
          </div>
          <div className="text-xs text-gray-500">Unique Traders</div>
        </div>

        <div>
          <div className="text-xl font-semibold text-white">
            {formatNumber(stats?.unique_markets)}
          </div>
          <div className="text-xs text-gray-500">Active Markets</div>
        </div>

        <div>
          <div className="text-xl font-semibold text-yellow-400">
            {formatNumber(stats?.whale_trades)}
          </div>
          <div className="text-xs text-gray-500">Whale Trades</div>
        </div>

        <div>
          <div className="text-xl font-semibold text-yellow-400">
            {formatUsd(stats?.whale_volume)}
          </div>
          <div className="text-xs text-gray-500">Whale Volume</div>
        </div>

        <div>
          <div className="text-lg font-medium text-white">
            {formatUsd(stats?.avg_trade_size)}
          </div>
          <div className="text-xs text-gray-500">Avg Trade Size</div>
        </div>

        <div>
          <div className="text-lg font-medium text-white">
            {formatUsd(stats?.largest_trade)}
          </div>
          <div className="text-xs text-gray-500">Largest Trade</div>
        </div>
      </div>

      {stats?.avg_latency_ms !== undefined && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="text-xs text-gray-500">
            Avg Latency: <span className={`font-medium ${
              stats.avg_latency_ms < 300 ? 'text-green-400' :
              stats.avg_latency_ms < 500 ? 'text-yellow-400' : 'text-red-400'
            }`}>{Math.round(stats.avg_latency_ms)}ms</span>
          </div>
        </div>
      )}
    </div>
  )
}
