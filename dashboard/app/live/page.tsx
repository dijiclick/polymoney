'use client'

import { useState } from 'react'
import LiveTradeFeed from '@/components/LiveTradeFeed'
import TradeFilters from '@/components/TradeFilters'
import AlertPanel from '@/components/AlertPanel'
import TradeStatsCard from '@/components/TradeStats'
import { TradeFilter } from '@/lib/supabase'

export default function LiveMonitorPage() {
  const [filter, setFilter] = useState<TradeFilter>({})

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Live Trade Monitor</h1>
        <p className="text-gray-400">
          Real-time feed of all Polymarket trades. Detect whales and track watched traders instantly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Feed (2/3 width on large screens) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Filters */}
          <TradeFilters filter={filter} onChange={setFilter} />

          {/* Live Feed */}
          <LiveTradeFeed filter={filter} maxTrades={200} />
        </div>

        {/* Sidebar (1/3 width on large screens) */}
        <div className="space-y-6">
          {/* 24h Stats */}
          <TradeStatsCard />

          {/* Alerts */}
          <AlertPanel />

          {/* Quick Actions */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => setFilter({ whalesOnly: true })}
                className="w-full px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded text-sm text-left"
              >
                🐋 Show Whales Only
              </button>
              <button
                onClick={() => setFilter({ watchlistOnly: true })}
                className="w-full px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-sm text-left"
              >
                👁️ Show Watchlist Only
              </button>
              <button
                onClick={() => setFilter({ minUsdValue: 50000 })}
                className="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm text-left"
              >
                🔥 Show $50K+ Trades
              </button>
              <button
                onClick={() => setFilter({})}
                className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm text-left"
              >
                📊 Show All Trades
              </button>
            </div>
          </div>

          {/* Service Status */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Service Info</h3>
            <div className="text-xs text-gray-500 space-y-1">
              <p>
                <span className="text-gray-400">Data Source:</span>{' '}
                Polymarket RTDS WebSocket
              </p>
              <p>
                <span className="text-gray-400">Whale Threshold:</span>{' '}
                $10,000+ USD
              </p>
              <p>
                <span className="text-gray-400">Target Latency:</span>{' '}
                {'<'}500ms
              </p>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-600">
                Run <code className="bg-gray-700 px-1 rounded">python -m src.realtime.service</code> to start monitoring
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
