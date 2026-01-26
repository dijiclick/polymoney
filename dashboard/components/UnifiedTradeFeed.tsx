'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, LiveTrade, TradeFilter } from '@/lib/supabase'

interface UnifiedTradeFeedProps {
  mode: 'all' | 'whales' | 'insider'
  filter: TradeFilter
  onConnectionChange?: (connected: boolean) => void
  maxTrades?: number
}

export default function UnifiedTradeFeed({
  mode,
  filter,
  onConnectionChange,
  maxTrades = 100
}: UnifiedTradeFeedProps) {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [tradeCount, setTradeCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef(filter)
  const isPausedRef = useRef(isPaused)

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const filterTrade = useCallback((trade: LiveTrade, currentFilter: TradeFilter, currentMode: string): boolean => {
    if (currentMode === 'insider' && !trade.is_insider_suspect) return false
    if (currentMode === 'whales' && !trade.is_whale) return false

    if (currentFilter.minUsdValue && trade.usd_value < currentFilter.minUsdValue) return false
    if (currentFilter.maxUsdValue && trade.usd_value > currentFilter.maxUsdValue) return false
    if (currentFilter.whalesOnly && !trade.is_whale) return false
    if (currentFilter.knownTradersOnly && !trade.is_known_trader) return false
    if (currentFilter.insidersOnly && !trade.is_insider_suspect) return false
    if (currentFilter.minInsiderScore && (trade.trader_insider_score || 0) < currentFilter.minInsiderScore) return false
    if (currentFilter.sides && !currentFilter.sides.includes(trade.side)) return false
    if (currentFilter.categories && trade.category && !currentFilter.categories.includes(trade.category)) return false
    if (currentFilter.marketSlug && trade.market_slug !== currentFilter.marketSlug) return false
    if (currentFilter.traderAddress && trade.trader_address.toLowerCase() !== currentFilter.traderAddress.toLowerCase()) return false

    return true
  }, [])

  const fetchRecentTrades = useCallback(async () => {
    let query = supabase
      .from('live_trades')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(maxTrades)

    if (mode === 'insider') {
      query = query.eq('is_insider_suspect', true)
    } else if (mode === 'whales') {
      query = query.eq('is_whale', true)
    }

    if (filter.minUsdValue) query = query.gte('usd_value', filter.minUsdValue)
    if (filter.maxUsdValue) query = query.lte('usd_value', filter.maxUsdValue)
    if (filter.whalesOnly) query = query.eq('is_whale', true)
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
  }, [fetchRecentTrades])

  useEffect(() => {
    const channelName = `unified_trades_feed_${mode}`
    const channel = supabase.channel(channelName)

    channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_trades' },
        (payload) => {
          if (!isPausedRef.current) {
            const newTrade = payload.new as LiveTrade
            setTradeCount(c => c + 1)

            if (filterTrade(newTrade, filterRef.current, mode)) {
              setTrades(prev => [newTrade, ...prev.slice(0, maxTrades - 1)])
            }
          }
        }
      )
      .subscribe((status) => {
        const connected = status === 'SUBSCRIBED'
        setIsConnected(connected)
        onConnectionChange?.(connected)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [mode, maxTrades, filterTrade, onConnectionChange])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const mins = Math.floor(diff / 60000)

    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    return date.toLocaleDateString()
  }

  const formatUsd = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const getValueColor = (value: number) => {
    if (value >= 50000) return 'text-red-400'
    if (value >= 10000) return 'text-amber-400'
    if (value >= 1000) return 'text-emerald-400'
    return 'text-gray-400'
  }

  return (
    <div className="glass rounded-xl h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500">
              {trades.length} trades {tradeCount > 0 && `(${tradeCount} seen)`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setTrades([])
                setTradeCount(0)
              }}
              className="px-2 py-1 rounded-md text-[10px] text-gray-500 hover:text-white hover:bg-white/5 transition-all"
            >
              Clear
            </button>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-2 py-1 rounded-md text-[10px] transition-all flex items-center gap-1 ${
                isPaused
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-gray-500 hover:text-white hover:bg-white/5'
              }`}
            >
              {isPaused ? (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                  Pause
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Trade List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.02] mb-3">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">
              {mode === 'insider' ? 'No insider trades yet' :
               mode === 'whales' ? 'No whale trades yet' :
               'Waiting for trades...'}
            </p>
            <p className="text-gray-600 text-xs mt-1">
              {mode === 'insider'
                ? 'Suspected insider trades will appear here'
                : mode === 'whales'
                ? 'Trades $10K+ will appear here'
                : 'Live trades will stream in real-time'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.02]">
            {trades.map((trade, idx) => {
              const isInsider = trade.is_insider_suspect

              return (
                <div
                  key={trade.id || idx}
                  className={`
                    px-4 py-3 transition-all group hover:bg-white/[0.02]
                    ${isInsider && mode === 'all' ? 'border-l-2 border-orange-500/50 bg-orange-500/[0.02]' : ''}
                  `}
                >
                  <div className="flex items-start gap-3">
                    {/* Score Badge (if insider) */}
                    {isInsider && (
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-semibold ${
                        (trade.trader_insider_score || 0) >= 85 ? 'bg-red-500/10 text-red-400' :
                        (trade.trader_insider_score || 0) >= 70 ? 'bg-orange-500/10 text-orange-400' :
                        'bg-yellow-500/10 text-yellow-400'
                      }`}>
                        {trade.trader_insider_score || '?'}
                      </div>
                    )}

                    {/* Trade Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          trade.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {trade.side}
                        </span>
                        <a
                          href={`https://polymarket.com/profile/${trade.trader_address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-300 hover:text-white text-xs font-medium truncate max-w-[180px] transition-colors"
                        >
                          {trade.trader_username || formatAddress(trade.trader_address)}
                        </a>
                        {isInsider && mode === 'all' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
                            INSIDER
                          </span>
                        )}
                        {trade.is_whale && (
                          <span className="text-[9px] text-amber-400">WHALE</span>
                        )}
                      </div>

                      <div className="text-gray-600 text-[11px] mt-1 truncate">
                        <span className="text-gray-500">{trade.outcome || 'Position'}</span>
                        {' · '}
                        <span className="text-gray-600">{trade.market_slug || 'Unknown'}</span>
                        {' @ '}
                        <span className="text-gray-500">{(trade.price * 100).toFixed(0)}%</span>
                      </div>

                      {/* Red Flags */}
                      {isInsider && trade.trader_red_flags && trade.trader_red_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {trade.trader_red_flags.slice(0, 2).map((flag, i) => (
                            <span
                              key={i}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/5 text-red-400/80"
                            >
                              {flag}
                            </span>
                          ))}
                          {trade.trader_red_flags.length > 2 && (
                            <span className="text-[9px] text-gray-600">+{trade.trader_red_flags.length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side: Value & Time */}
                    <div className="text-right flex-shrink-0">
                      <div className={`font-mono text-sm ${getValueColor(trade.usd_value)}`}>
                        {formatUsd(trade.usd_value)}
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {formatTime(trade.executed_at)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
