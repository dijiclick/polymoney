'use client'

import { useState, useCallback, useEffect } from 'react'
import TradeFeedTabs, { TabId } from '@/components/TradeFeedTabs'
import UnifiedTradeFeed from '@/components/UnifiedTradeFeed'
import TradeFilters from '@/components/TradeFilters'
import ContextSidebar from '@/components/ContextSidebar'
import InsiderAlerts from '@/components/InsiderAlerts'
import { TradeFilter, supabase } from '@/lib/supabase'

interface DiscoveryStats {
  totalWallets: number
  tradesCount: number
}

export default function LiveTradePage() {
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [activeAddresses, setActiveAddresses] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<TradeFilter>({})
  const [alertCount, setAlertCount] = useState(0)
  const [showMobileSidebar, setShowMobileSidebar] = useState(false)
  const [discoveryStats, setDiscoveryStats] = useState<DiscoveryStats>({ totalWallets: 0, tradesCount: 0 })

  // Fetch unacknowledged alert count and discovery stats
  useEffect(() => {
    async function fetchAlertCount() {
      const { count } = await supabase
        .from('trade_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('acknowledged', false)
      setAlertCount(count || 0)
    }

    async function fetchDiscoveryStats() {
      // Get total wallets count
      const { count: walletsCount } = await supabase
        .from('wallets')
        .select('*', { count: 'exact', head: true })

      // Get total trades count (>= $100)
      const { count: tradesCount } = await supabase
        .from('live_trades')
        .select('*', { count: 'exact', head: true })

      setDiscoveryStats({
        totalWallets: walletsCount || 0,
        tradesCount: tradesCount || 0
      })
    }

    fetchAlertCount()
    fetchDiscoveryStats()

    // Subscribe to alert changes
    const alertSubscription = supabase
      .channel('alert_count_channel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_alerts' },
        () => fetchAlertCount()
      )
      .subscribe()

    // Subscribe to wallet changes for discovery stats
    const walletSubscription = supabase
      .channel('wallet_stats_channel')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wallets' },
        () => fetchDiscoveryStats()
      )
      .subscribe()

    return () => {
      alertSubscription.unsubscribe()
      walletSubscription.unsubscribe()
    }
  }, [])

  // Track active traders (recently traded)
  const handleTradeReceived = useCallback((address: string) => {
    setActiveAddresses(prev => {
      const next = new Set(prev)
      next.add(address)
      setTimeout(() => {
        setActiveAddresses(current => {
          const updated = new Set(current)
          updated.delete(address)
          return updated
        })
      }, 30000)
      return next
    })
  }, [])

  // Get effective filter based on tab
  const getEffectiveFilter = useCallback((): TradeFilter => {
    if (activeTab === 'insider') {
      return { ...filter, insidersOnly: true }
    }
    return filter
  }, [activeTab, filter])

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Trade Monitor</h1>
          <p className="text-gray-400 text-sm">
            Real-time trade monitoring with insider detection
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Discovery Stats */}
          <div className="hidden md:flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5 text-gray-400">
              <span className="text-blue-400 font-medium">{discoveryStats.tradesCount.toLocaleString()}</span>
              <span>trades ($100+)</span>
            </div>
            <span className="text-gray-600">|</span>
            <div className="flex items-center gap-1.5 text-gray-400">
              <span className="text-green-400 font-medium">{discoveryStats.totalWallets.toLocaleString()}</span>
              <span>wallets analyzed</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Connected
          </div>
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setShowMobileSidebar(!showMobileSidebar)}
            className="lg:hidden px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600"
          >
            {showMobileSidebar ? 'Hide Panel' : 'Show Panel'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <TradeFeedTabs
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab)
          // Reset filter when switching tabs
          if (tab === 'alerts') {
            setFilter({})
          }
        }}
        alertCount={alertCount}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 min-h-0 mt-4">
        {/* Left: Feed + Filters */}
        <div className="flex-1 lg:w-[65%] flex flex-col min-h-0">
          {activeTab !== 'alerts' && (
            <TradeFilters
              filter={filter}
              onChange={setFilter}
            />
          )}

          <div className="flex-1 min-h-0">
            {activeTab === 'alerts' ? (
              <InsiderAlerts />
            ) : (
              <UnifiedTradeFeed
                mode={activeTab === 'insider' ? 'insider' :
                      activeTab === 'whales' ? 'whales' :
                      activeTab === 'watchlist' ? 'watchlist' : 'all'}
                filter={getEffectiveFilter()}
                onTraderSelect={setSelectedAddress}
                selectedTraderAddress={selectedAddress}
                onTradeReceived={handleTradeReceived}
              />
            )}
          </div>
        </div>

        {/* Right: Context Sidebar */}
        <div className={`
          lg:w-[35%] min-h-0
          ${showMobileSidebar ? 'block' : 'hidden lg:block'}
          ${showMobileSidebar ? 'fixed inset-0 z-50 bg-gray-900/95 p-4 lg:relative lg:p-0 lg:bg-transparent' : ''}
        `}>
          {showMobileSidebar && (
            <button
              onClick={() => setShowMobileSidebar(false)}
              className="lg:hidden absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <ContextSidebar
            selectedAddress={selectedAddress}
            onSelectTrader={setSelectedAddress}
            activeAddresses={activeAddresses}
            showCompactSuspectList={activeTab !== 'alerts'}
          />
        </div>
      </div>

      {/* Footer Legend */}
      <div className="mt-4 flex items-center justify-between text-xs text-gray-500 border-t border-gray-700 pt-4">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded border-l-2 border-orange-500 bg-orange-900/30" /> Insider
          </span>
          <span className="flex items-center gap-1">
            <span className="text-yellow-500 font-semibold">WHALE</span> = $10K+
          </span>
          <span className="flex items-center gap-1">
            <span className="text-red-400">85+</span> /
            <span className="text-orange-400">70+</span> /
            <span className="text-yellow-400">60+</span> = Score
          </span>
        </div>
        <div className="hidden sm:block">
          Run <code className="bg-gray-700 px-1 rounded">py -m src.realtime.service</code> to start
        </div>
      </div>
    </div>
  )
}
