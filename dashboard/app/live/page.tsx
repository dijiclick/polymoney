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
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    async function fetchAlertCount() {
      const { count } = await supabase
        .from('trade_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('acknowledged', false)
      setAlertCount(count || 0)
    }

    async function fetchDiscoveryStats() {
      const { count: walletsCount } = await supabase
        .from('wallets')
        .select('*', { count: 'exact', head: true })

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

    const alertSubscription = supabase
      .channel('alert_count_channel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'trade_alerts' },
        () => fetchAlertCount()
      )
      .subscribe()

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
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Trades</p>
                    <p className="text-base font-bold text-white">{discoveryStats.tradesCount.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/50 px-4 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Wallets</p>
                    <p className="text-base font-bold text-white">{discoveryStats.totalWallets.toLocaleString()}</p>
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
        onTabChange={(tab) => {
          setActiveTab(tab)
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
                onConnectionChange={setIsConnected}
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

      {/* Mobile Sidebar Toggle */}
      <button
        onClick={() => setShowMobileSidebar(!showMobileSidebar)}
        className="lg:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/25 flex items-center justify-center hover:bg-blue-500 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>
    </div>
  )
}
