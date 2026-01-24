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
      // Get aggregated stats from wallets table
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
      {/* Hero Header */}
      <div className="relative overflow-hidden mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/10 via-blue-600/5 to-transparent"></div>
        <div className="relative py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-1 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                Live Trade Monitor
              </h1>
              <p className="text-gray-500 text-sm">
                Real-time trade monitoring with insider detection
              </p>
            </div>

            {/* Stats Cards */}
            <div className="flex items-center gap-3">
              <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/50 px-4 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Total Trades</p>
                    <p className="text-base font-bold text-white">{tradeStats.totalTrades.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/50 px-4 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Active Trades</p>
                    <p className="text-base font-bold text-white">{tradeStats.activeTrades.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isConnected ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span className={`text-xs font-medium ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <TradeFeedTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Main Content - Full Width */}
      <div className="flex-1 flex flex-col min-h-0 mt-4">
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
