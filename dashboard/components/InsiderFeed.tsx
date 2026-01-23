'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, LiveTrade } from '@/lib/supabase'

interface InsiderFeedProps {
  selectedAddresses?: string[]
  minScore?: number
  onTradeReceived?: (address: string) => void
}

type FilterMode = 'all' | 'selected' | 'high_risk'

export default function InsiderFeed({
  selectedAddresses = [],
  minScore = 60,
  onTradeReceived
}: InsiderFeedProps) {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [tradeCount, setTradeCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter trades based on mode
  const filterTrade = useCallback((trade: LiveTrade): boolean => {
    // Must be insider suspect
    if (!trade.is_insider_suspect) return false

    if (filterMode === 'selected' && selectedAddresses.length > 0) {
      return selectedAddresses.includes(trade.trader_address.toLowerCase())
    }

    if (filterMode === 'high_risk') {
      return (trade.trader_insider_score || 0) >= 80
    }

    return true
  }, [filterMode, selectedAddresses])

  useEffect(() => {
    // Fetch initial trades
    fetchRecentTrades()

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('insider_trades_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_trades' },
        (payload) => {
          if (!isPaused) {
            const newTrade = payload.new as LiveTrade
            if (newTrade.is_insider_suspect) {
              setTradeCount(c => c + 1)
              onTradeReceived?.(newTrade.trader_address.toLowerCase())
              if (filterTrade(newTrade)) {
                setTrades(prev => [newTrade, ...prev.slice(0, 99)])
              }
            }
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      subscription.unsubscribe()
    }
  }, [filterMode, selectedAddresses, isPaused, filterTrade, onTradeReceived])

  async function fetchRecentTrades() {
    let query = supabase
      .from('live_trades')
      .select('*')
      .eq('is_insider_suspect', true)
      .order('received_at', { ascending: false })
      .limit(100)

    if (filterMode === 'high_risk') {
      query = query.gte('trader_insider_score', 80)
    }

    if (filterMode === 'selected' && selectedAddresses.length > 0) {
      query = query.in('trader_address', selectedAddresses)
    }

    const { data } = await query
    setTrades(data || [])
  }

  // Refetch when filter changes
  useEffect(() => {
    fetchRecentTrades()
  }, [filterMode, selectedAddresses])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const mins = Math.floor(diff / 60000)

    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return date.toLocaleDateString()
  }

  const formatUsd = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const getScoreColor = (score: number | undefined) => {
    if (!score) return 'text-gray-400'
    if (score >= 85) return 'text-red-400'
    if (score >= 70) return 'text-orange-400'
    return 'text-yellow-400'
  }

  const getScoreBg = (score: number | undefined) => {
    if (!score) return 'bg-gray-700'
    if (score >= 85) return 'bg-red-500/20'
    if (score >= 70) return 'bg-orange-500/20'
    return 'bg-yellow-500/20'
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Live Insider Trades</h2>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setTrades([])
                setTradeCount(0)
              }}
              className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600"
            >
              Clear
            </button>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-3 py-1 rounded text-sm ${isPaused ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

        {/* Filter Mode */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1 rounded text-sm ${
              filterMode === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            All Insiders
          </button>
          <button
            onClick={() => setFilterMode('high_risk')}
            className={`px-3 py-1 rounded text-sm ${
              filterMode === 'high_risk'
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            Score 80+
          </button>
          {selectedAddresses.length > 0 && (
            <button
              onClick={() => setFilterMode('selected')}
              className={`px-3 py-1 rounded text-sm ${
                filterMode === 'selected'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Selected ({selectedAddresses.length})
            </button>
          )}
        </div>
      </div>

      {/* Trade List */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
      >
        {trades.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-3">No insider trades yet</div>
            <div className="text-sm">Trades from suspected insiders will appear here</div>
            <div className="text-xs mt-2 text-gray-600">
              Make sure the trade monitor service is running
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {trades.map((trade, idx) => (
              <div
                key={trade.id || idx}
                className={`p-4 hover:bg-gray-750 transition-colors ${getScoreBg(trade.trader_insider_score)}`}
              >
                {/* Time */}
                <div className="text-xs text-gray-500 mb-2">
                  {formatTime(trade.executed_at)}
                </div>

                {/* Main Content */}
                <div className="flex items-start gap-3">
                  {/* Score Badge */}
                  <div className={`px-2 py-1 rounded text-sm font-bold ${getScoreColor(trade.trader_insider_score)}`}>
                    {trade.trader_insider_score || '?'}
                  </div>

                  {/* Trade Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`/traders/${trade.trader_address}`}
                        className="text-blue-400 hover:underline text-sm"
                      >
                        {trade.trader_username || formatAddress(trade.trader_address)}
                      </a>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        trade.side === 'BUY' ? 'bg-green-600/80' : 'bg-red-600/80'
                      }`}>
                        {trade.side}
                      </span>
                      <span className={`font-mono font-semibold ${
                        trade.usd_value >= 10000 ? 'text-yellow-400' : 'text-white'
                      }`}>
                        {formatUsd(trade.usd_value)}
                      </span>
                    </div>

                    <div className="text-gray-400 text-sm mt-1">
                      <span className="text-gray-300">{trade.outcome || 'Position'}</span>
                      {' on '}
                      <span className="text-gray-500">{trade.market_slug || 'Unknown market'}</span>
                      {' @ '}
                      <span className="text-gray-500">{(trade.price * 100).toFixed(0)}%</span>
                    </div>

                    {/* Red Flags */}
                    {trade.trader_red_flags && trade.trader_red_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {trade.trader_red_flags.slice(0, 3).map((flag, i) => (
                          <span
                            key={i}
                            className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400"
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
        <span>
          {tradeCount > 0 && `${tradeCount} insider trades seen · `}
          Showing {trades.length} trades
        </span>
        <span>{isConnected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  )
}
