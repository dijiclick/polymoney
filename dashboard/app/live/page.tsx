'use client'

import { useState, useCallback, useEffect } from 'react'
import TradeFeedTabs, { TabId } from '@/components/TradeFeedTabs'
import UnifiedTradeFeed from '@/components/UnifiedTradeFeed'
import TradeFilters from '@/components/TradeFilters'
import { TradeFilter, supabase } from '@/lib/supabase'

interface TradeStats {
  totalTrades: number
  activeTrades: number
}

export default function LiveTradePage() {
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [filter, setFilter] = useState<TradeFilter>({})
  const [tradeStats, setTradeStats] = useState<TradeStats>({ totalTrades: 0, activeTrades: 0 })
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    async function fetchTradeStats() {
      const { data } = await supabase
        .from('wallets')
        .select('total_trades, active_positions')

      if (data) {
        const totalTrades = data.reduce((sum, w) => sum + (w.total_trades || 0), 0)
        const activeTrades = data.reduce((sum, w) => sum + (w.active_positions || 0), 0)
        setTradeStats({ totalTrades, activeTrades })
      }
    }

    fetchTradeStats()

    const walletSubscription = supabase
      .channel('wallet_stats_channel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'wallets' },
        () => fetchTradeStats()
      )
      .subscribe()

    return () => {
      walletSubscription.unsubscribe()
    }
  }, [])

  const getEffectiveFilter = useCallback((): TradeFilter => {
    if (activeTab === 'insider') {
      return { ...filter, insidersOnly: true }
    }
    return filter
  }, [activeTab, filter])

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="mb-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white mb-1">
              Live Feed
            </h1>
            <p className="text-gray-600 text-xs">
              Real-time trade monitoring
            </p>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-2">
            <div className="glass rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center">
                  <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider">Total</p>
                  <p className="text-sm font-semibold text-white">{tradeStats.totalTrades.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="glass rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
                  <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 uppercase tracking-wider">Active</p>
                  <p className="text-sm font-semibold text-white">{tradeStats.activeTrades.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${isConnected ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-red-500/5 border border-red-500/10'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className={`text-[10px] font-medium ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <TradeFeedTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 mt-3">
        <TradeFilters
          filter={filter}
          onChange={setFilter}
        />

        <div className="flex-1 min-h-0">
          <UnifiedTradeFeed
            mode={activeTab === 'insider' ? 'insider' :
                  activeTab === 'whales' ? 'whales' : 'all'}
            filter={getEffectiveFilter()}
            onConnectionChange={setIsConnected}
          />
        </div>
      </div>
    </div>
  )
}
