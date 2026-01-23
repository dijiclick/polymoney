'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, LiveTrade, TradeFilter } from '@/lib/supabase'

interface UnifiedTradeFeedProps {
  mode: 'all' | 'insider'
  filter: TradeFilter
  onTraderSelect?: (address: string) => void
  selectedTraderAddress?: string | null
  onTradeReceived?: (address: string) => void
  maxTrades?: number
}

export default function UnifiedTradeFeed({
  mode,
  filter,
  onTraderSelect,
  selectedTraderAddress,
  onTradeReceived,
  maxTrades = 100
}: UnifiedTradeFeedProps) {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [tradeCount, setTradeCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const filterTrade = useCallback((trade: LiveTrade): boolean => {
    // In insider mode, only show insider suspects
    if (mode === 'insider' && !trade.is_insider_suspect) return false

    // Apply additional filters
    if (filter.minUsdValue && trade.usd_value < filter.minUsdValue) return false
    if (filter.maxUsdValue && trade.usd_value > filter.maxUsdValue) return false
    if (filter.whalesOnly && !trade.is_whale) return false
    if (filter.watchlistOnly && !trade.is_watchlist) return false
    if (filter.knownTradersOnly && !trade.is_known_trader) return false
    if (filter.insidersOnly && !trade.is_insider_suspect) return false
    if (filter.minInsiderScore && (trade.trader_insider_score || 0) < filter.minInsiderScore) return false
    if (filter.sides && !filter.sides.includes(trade.side)) return false
    if (filter.categories && trade.category && !filter.categories.includes(trade.category)) return false
    if (filter.marketSlug && trade.market_slug !== filter.marketSlug) return false
    if (filter.traderAddress && trade.trader_address.toLowerCase() !== filter.traderAddress.toLowerCase()) return false

    return true
  }, [mode, filter])

  const fetchRecentTrades = useCallback(async () => {
    let query = supabase
      .from('live_trades')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(maxTrades)

    // Mode-based filter
    if (mode === 'insider') {
      query = query.eq('is_insider_suspect', true)
    }

    // Apply server-side filters
    if (filter.minUsdValue) query = query.gte('usd_value', filter.minUsdValue)
    if (filter.maxUsdValue) query = query.lte('usd_value', filter.maxUsdValue)
    if (filter.whalesOnly) query = query.eq('is_whale', true)
    if (filter.watchlistOnly) query = query.eq('is_watchlist', true)
    if (filter.knownTradersOnly) query = query.eq('is_known_trader', true)
    if (filter.insidersOnly) query = query.eq('is_insider_suspect', true)
    if (filter.minInsiderScore) query = query.gte('trader_insider_score', filter.minInsiderScore)
    if (filter.traderAddress) query = query.eq('trader_address', filter.traderAddress.toLowerCase())
    if (filter.marketSlug) query = query.eq('market_slug', filter.marketSlug)

    const { data } = await query
    setTrades(data || [])
  }, [mode, filter, maxTrades])

  useEffect(() => {
    fetchRecentTrades()

    const channelName = `unified_trades_feed_${mode}`
    const subscription = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_trades' },
        (payload) => {
          if (!isPaused) {
            const newTrade = payload.new as LiveTrade
            setTradeCount(c => c + 1)

            if (filterTrade(newTrade)) {
              onTradeReceived?.(newTrade.trader_address.toLowerCase())
              setTrades(prev => [newTrade, ...prev.slice(0, maxTrades - 1)])
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
  }, [mode, filter, isPaused, maxTrades, filterTrade, onTradeReceived, fetchRecentTrades])

  useEffect(() => {
    fetchRecentTrades()
  }, [fetchRecentTrades])

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

  const getValueColor = (value: number) => {
    if (value >= 50000) return 'text-red-400 font-bold'
    if (value >= 10000) return 'text-yellow-400 font-semibold'
    if (value >= 1000) return 'text-green-400'
    if (value >= 100) return 'text-white'
    return 'text-gray-400'
  }

  const getScoreColor = (score: number | undefined) => {
    if (!score) return 'text-gray-400'
    if (score >= 85) return 'text-red-400'
    if (score >= 70) return 'text-orange-400'
    return 'text-yellow-400'
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {mode === 'insider' ? 'Insider Trades' : 'Live Trades'}
            </h2>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {tradeCount > 0 && (
              <span className="text-xs text-gray-500">
                {tradeCount.toLocaleString()} trades seen
              </span>
            )}
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
              className={`px-3 py-1 rounded text-sm ${
                isPaused ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </div>

      {/* Trade List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-3">
              {mode === 'insider' ? 'No insider trades yet' : 'Waiting for trades...'}
            </div>
            <div className="text-sm">
              {mode === 'insider'
                ? 'Trades from suspected insiders will appear here'
                : 'Live trades will appear here as they happen'
              }
            </div>
            <div className="text-xs mt-2 text-gray-600">
              Make sure the trade monitor service is running
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {trades.map((trade, idx) => {
              const isSelected = selectedTraderAddress?.toLowerCase() === trade.trader_address.toLowerCase()
              const isInsider = trade.is_insider_suspect

              return (
                <div
                  key={trade.id || idx}
                  onClick={() => onTraderSelect?.(trade.trader_address)}
                  className={`
                    p-4 transition-colors cursor-pointer
                    ${isSelected ? 'bg-blue-900/30 border-l-2 border-blue-500' : 'hover:bg-gray-750'}
                    ${isInsider && mode === 'all' ? 'border-l-2 border-orange-500 bg-orange-900/10' : ''}
                    ${trade.is_whale ? 'bg-yellow-900/5' : ''}
                    ${trade.is_watchlist && !isInsider ? 'bg-blue-900/5' : ''}
                  `}
                >
                  {/* Time */}
                  <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
                    <span>{formatTime(trade.executed_at)}</span>
                    {trade.processing_latency_ms !== undefined && trade.processing_latency_ms !== null && (
                      <span className={`${trade.processing_latency_ms > 500 ? 'text-yellow-500' : 'text-gray-600'}`}>
                        {trade.processing_latency_ms}ms
                      </span>
                    )}
                  </div>

                  {/* Main Content */}
                  <div className="flex items-start gap-3">
                    {/* Score Badge (if insider) */}
                    {isInsider && (
                      <div className={`px-2 py-1 rounded text-sm font-bold ${getScoreColor(trade.trader_insider_score)}`}>
                        {trade.trader_insider_score || '?'}
                      </div>
                    )}

                    {/* Trade Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          trade.side === 'BUY' ? 'bg-green-600/80' : 'bg-red-600/80'
                        }`}>
                          {trade.side}
                        </span>
                        <a
                          href={`/traders/${trade.trader_address}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-400 hover:underline text-sm truncate max-w-[150px]"
                          title={trade.trader_address}
                        >
                          {trade.trader_username || formatAddress(trade.trader_address)}
                        </a>
                        {isInsider && mode === 'all' && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-orange-600/80">
                            INSIDER
                          </span>
                        )}
                        {trade.is_whale && (
                          <span className="text-yellow-500 text-xs font-semibold">WHALE</span>
                        )}
                        {trade.is_watchlist && (
                          <span className="text-blue-400 text-xs">WATCHING</span>
                        )}
                        {trade.is_known_trader && trade.trader_classification && trade.trader_classification !== 'insider' && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            trade.trader_classification === 'copytrade' ? 'bg-blue-600/60' :
                            trade.trader_classification === 'bot' ? 'bg-purple-600/60' : 'bg-gray-600/60'
                          }`}>
                            {trade.trader_classification}
                          </span>
                        )}
                      </div>

                      <div className="text-gray-400 text-sm mt-1">
                        <span className="font-medium text-gray-300">{trade.outcome || 'Position'}</span>
                        {' on '}
                        <span className="text-gray-500">{trade.market_slug || 'Unknown market'}</span>
                        {' @ '}
                        <span className="text-gray-500">{(trade.price * 100).toFixed(0)}%</span>
                      </div>

                      {/* Red Flags (if insider) */}
                      {isInsider && trade.trader_red_flags && trade.trader_red_flags.length > 0 && (
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

                    {/* Value */}
                    <div className={`font-mono text-right ${getValueColor(trade.usd_value)}`}>
                      {formatUsd(trade.usd_value)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
        <span>Showing {trades.length} trades</span>
        <span>{isConnected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  )
}
