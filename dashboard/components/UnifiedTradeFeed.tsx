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

  const filterTrade = useCallback((trade: LiveTrade): boolean => {
    if (mode === 'insider' && !trade.is_insider_suspect) return false
    if (mode === 'whales' && !trade.is_whale) return false

    if (filter.minUsdValue && trade.usd_value < filter.minUsdValue) return false
    if (filter.maxUsdValue && trade.usd_value > filter.maxUsdValue) return false
    if (filter.whalesOnly && !trade.is_whale) return false
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
      subscription.unsubscribe()
    }
  }, [mode, filter, isPaused, maxTrades, filterTrade, fetchRecentTrades, onConnectionChange])

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
    if (value >= 10000) return 'text-amber-400 font-semibold'
    if (value >= 1000) return 'text-emerald-400'
    return 'text-gray-300'
  }

  const getScoreColor = (score: number | undefined) => {
    if (!score) return 'text-gray-500'
    if (score >= 85) return 'text-red-400'
    if (score >= 70) return 'text-orange-400'
    return 'text-yellow-400'
  }

  const modeTitle = {
    all: 'Live Trades',
    insider: 'Insider Trades',
    whales: 'Whale Trades'
  }

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800/50">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white">{modeTitle[mode]}</h2>
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          </div>
          <div className="flex items-center gap-3">
            {tradeCount > 0 && (
              <span className="text-sm text-gray-500 px-3 py-1.5 bg-gray-800/50 rounded-lg">
                {tradeCount.toLocaleString()} seen
              </span>
            )}
            <button
              onClick={() => {
                setTrades([])
                setTradeCount(0)
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 bg-gray-800/50 hover:bg-gray-700/50 hover:text-white transition-all"
            >
              Clear
            </button>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                isPaused
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white'
              }`}
            >
              {isPaused ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
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
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium text-lg">
              {mode === 'insider' ? 'No insider trades yet' :
               mode === 'whales' ? 'No whale trades yet' :
               'Waiting for trades...'}
            </p>
            <p className="text-gray-600 text-base mt-1">
              {mode === 'insider'
                ? 'Trades from suspected insiders will appear here'
                : mode === 'whales'
                ? 'Trades of $10K or more will appear here'
                : 'Live trades will stream in real-time'
              }
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/30">
            {trades.map((trade, idx) => {
              const isInsider = trade.is_insider_suspect

              return (
                <div
                  key={trade.id || idx}
                  className={`
                    px-5 py-4 transition-all group
                    hover:bg-gray-800/30
                    ${isInsider && mode === 'all' ? 'border-l-4 border-orange-500 bg-orange-500/5' : ''}
                  `}
                >
                  <div className="flex items-start gap-4">
                    {/* Score Badge (if insider) */}
                    {isInsider && (
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${
                        (trade.trader_insider_score || 0) >= 85 ? 'bg-red-500/20 text-red-400' :
                        (trade.trader_insider_score || 0) >= 70 ? 'bg-orange-500/20 text-orange-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {trade.trader_insider_score || '?'}
                      </div>
                    )}

                    {/* Trade Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`text-sm font-bold px-2.5 py-1 rounded ${
                          trade.side === 'BUY' ? 'bg-emerald-500/80 text-white' : 'bg-red-500/80 text-white'
                        }`}>
                          {trade.side}
                        </span>
                        <a
                          href={`https://polymarket.com/profile/${trade.trader_address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-white hover:text-blue-300 text-lg font-semibold truncate max-w-[250px] flex items-center gap-2 transition-colors"
                        >
                          {trade.trader_username || formatAddress(trade.trader_address)}
                          <svg className="w-4 h-4 text-gray-500 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                        {isInsider && mode === 'all' && (
                          <span className="text-xs px-2 py-1 rounded bg-orange-500/80 text-white font-semibold">
                            INSIDER
                          </span>
                        )}
                        {trade.is_whale && (
                          <span className="text-amber-400 text-sm font-bold">WHALE</span>
                        )}
                      </div>

                      <div className="text-gray-400 text-base mt-2">
                        <span className="text-gray-300 font-medium">{trade.outcome || 'Position'}</span>
                        {' on '}
                        <span className="text-gray-500">{trade.market_slug || 'Unknown'}</span>
                        {' @ '}
                        <span className="text-gray-300 font-semibold">{(trade.price * 100).toFixed(0)}%</span>
                      </div>

                      {/* Red Flags */}
                      {isInsider && trade.trader_red_flags && trade.trader_red_flags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {trade.trader_red_flags.slice(0, 3).map((flag, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                            >
                              {flag}
                            </span>
                          ))}
                          {trade.trader_red_flags.length > 3 && (
                            <span className="text-xs text-gray-500">+{trade.trader_red_flags.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right side: Value & Time */}
                    <div className="text-right flex-shrink-0">
                      <div className={`font-mono text-xl font-semibold ${getValueColor(trade.usd_value)}`}>
                        {formatUsd(trade.usd_value)}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {formatTime(trade.executed_at)}
                      </div>
                      {trade.processing_latency_ms !== undefined && trade.processing_latency_ms !== null && (
                        <div className={`text-xs mt-0.5 ${trade.processing_latency_ms > 500 ? 'text-amber-500' : 'text-gray-600'}`}>
                          {trade.processing_latency_ms}ms
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-800/50 flex justify-between items-center">
        <span className="text-sm text-gray-500">
          {trades.length} trade{trades.length !== 1 ? 's' : ''}
        </span>
        <span className={`text-sm flex items-center gap-2 ${isConnected ? 'text-emerald-500' : 'text-red-500'}`}>
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {isConnected ? 'Connected' : 'Reconnecting...'}
        </span>
      </div>
    </div>
  )
}
