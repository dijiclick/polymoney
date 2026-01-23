'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, LiveTrade, TradeFilter } from '@/lib/supabase'

interface LiveTradeFeedProps {
  filter?: TradeFilter
  maxTrades?: number
}

export default function LiveTradeFeed({
  filter = {},
  maxTrades = 100
}: LiveTradeFeedProps) {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [tradeCount, setTradeCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter trades client-side for real-time updates
  const filterTrade = useCallback((trade: LiveTrade): boolean => {
    if (filter.minUsdValue && trade.usd_value < filter.minUsdValue) return false
    if (filter.maxUsdValue && trade.usd_value > filter.maxUsdValue) return false
    if (filter.whalesOnly && !trade.is_whale) return false
    if (filter.watchlistOnly && !trade.is_watchlist) return false
    if (filter.knownTradersOnly && !trade.is_known_trader) return false
    if (filter.sides && !filter.sides.includes(trade.side)) return false
    if (filter.categories && trade.category && !filter.categories.includes(trade.category)) return false
    if (filter.marketSlug && trade.market_slug !== filter.marketSlug) return false
    if (filter.traderAddress && trade.trader_address !== filter.traderAddress.toLowerCase()) return false
    return true
  }, [filter])

  useEffect(() => {
    // Fetch initial trades
    fetchRecentTrades()

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('live_trades_feed')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_trades' },
        (payload) => {
          if (!isPaused) {
            const newTrade = payload.new as LiveTrade
            setTradeCount(c => c + 1)
            if (filterTrade(newTrade)) {
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
  }, [filter, isPaused, maxTrades, filterTrade])

  async function fetchRecentTrades() {
    let query = supabase
      .from('live_trades')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(maxTrades)

    // Apply server-side filters where possible
    if (filter.minUsdValue) {
      query = query.gte('usd_value', filter.minUsdValue)
    }
    if (filter.whalesOnly) {
      query = query.eq('is_whale', true)
    }
    if (filter.watchlistOnly) {
      query = query.eq('is_watchlist', true)
    }
    if (filter.traderAddress) {
      query = query.eq('trader_address', filter.traderAddress.toLowerCase())
    }

    const { data } = await query
    setTrades(data || [])
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
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
    return 'text-gray-300'
  }

  return (
    <div className="bg-gray-800 rounded-lg">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Live Trade Feed</h2>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-gray-500">
            {tradeCount > 0 && `${tradeCount.toLocaleString()} trades seen`}
          </span>
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

      {/* Trade List */}
      <div
        ref={listRef}
        className="max-h-[600px] overflow-y-auto"
        style={{ scrollBehavior: 'smooth' }}
      >
        {trades.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="mb-2">Waiting for trades...</div>
            <div className="text-xs">Make sure the trade monitor service is running</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {trades.map((trade, idx) => (
              <div
                key={trade.id || idx}
                className={`p-3 hover:bg-gray-750 transition-colors ${
                  trade.is_whale ? 'bg-yellow-900/10' : ''
                } ${trade.is_watchlist ? 'border-l-2 border-blue-500' : ''}`}
              >
                <div className="flex justify-between items-start gap-4">
                  {/* Left: Trader + Action */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        trade.side === 'BUY' ? 'bg-green-600/80' : 'bg-red-600/80'
                      }`}>
                        {trade.side}
                      </span>
                      <a
                        href={`/traders/${trade.trader_address}`}
                        className="text-blue-400 hover:underline text-sm truncate max-w-[150px]"
                        title={trade.trader_address}
                      >
                        {trade.trader_username || formatAddress(trade.trader_address)}
                      </a>
                      {trade.is_known_trader && trade.trader_classification && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          trade.trader_classification === 'copytrade' ? 'bg-blue-600/60' :
                          trade.trader_classification === 'bot' ? 'bg-purple-600/60' : 'bg-gray-600/60'
                        }`}>
                          {trade.trader_classification}
                        </span>
                      )}
                      {trade.is_whale && (
                        <span className="text-yellow-500 text-xs font-semibold">WHALE</span>
                      )}
                      {trade.is_watchlist && (
                        <span className="text-blue-400 text-xs">WATCHING</span>
                      )}
                    </div>
                    <div className="text-gray-400 text-sm mt-1 truncate">
                      <span className="font-medium text-gray-300">{trade.outcome || 'Position'}</span>
                      {' on '}
                      <span className="text-gray-500">{trade.market_slug || trade.condition_id?.slice(0, 12) || 'Unknown'}</span>
                    </div>
                  </div>

                  {/* Right: Value + Time */}
                  <div className="text-right flex-shrink-0">
                    <div className={`font-mono ${getValueColor(trade.usd_value)}`}>
                      {formatUsd(trade.usd_value)}
                    </div>
                    <div className="text-gray-500 text-xs">
                      {formatTime(trade.executed_at)}
                      {trade.processing_latency_ms !== undefined && trade.processing_latency_ms !== null && (
                        <span className={`ml-1 ${trade.processing_latency_ms > 500 ? 'text-yellow-500' : 'text-gray-600'}`}>
                          ({trade.processing_latency_ms}ms)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
        <span>Showing {trades.length} trades</span>
        <span>{isConnected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  )
}
