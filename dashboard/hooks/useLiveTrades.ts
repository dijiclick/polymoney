'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, LiveTrade, TradeFilter } from '@/lib/supabase'

interface UseLiveTradesOptions {
  filter: TradeFilter
  maxTrades?: number
}

interface UseLiveTradesReturn {
  trades: LiveTrade[]
  isConnected: boolean
  isPaused: boolean
  tradeCount: number
  totalSeen: number
  setIsPaused: (paused: boolean) => void
  clearTrades: () => void
}

function filterTrade(trade: LiveTrade, f: TradeFilter): boolean {
  if (f.minUsdValue && trade.usd_value < f.minUsdValue) return false
  if (f.maxUsdValue && trade.usd_value > f.maxUsdValue) return false
  if (f.whalesOnly && !trade.is_whale) return false
  if (f.knownTradersOnly && !trade.is_known_trader) return false
  if (f.insidersOnly && !trade.is_insider_suspect) return false
  if (f.minInsiderScore && (trade.trader_insider_score || 0) < f.minInsiderScore) return false
  if (f.sides && f.sides.length > 0 && !f.sides.includes(trade.side)) return false
  if (f.categories && f.categories.length > 0 && trade.category && !f.categories.includes(trade.category)) return false
  if (f.marketSlug && trade.market_slug !== f.marketSlug) return false
  if (f.traderAddress && trade.trader_address.toLowerCase() !== f.traderAddress.toLowerCase()) return false
  return true
}

export function useLiveTrades({ filter, maxTrades = 200 }: UseLiveTradesOptions): UseLiveTradesReturn {
  const [trades, setTrades] = useState<LiveTrade[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [tradeCount, setTradeCount] = useState(0)
  const [totalSeen, setTotalSeen] = useState(0)

  const filterRef = useRef(filter)
  const isPausedRef = useRef(isPaused)

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  const fetchRecentTrades = useCallback(async () => {
    let query = supabase
      .from('live_trades')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(maxTrades)

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
    setTradeCount(data?.length || 0)
  }, [filter, maxTrades])

  useEffect(() => {
    fetchRecentTrades()
  }, [fetchRecentTrades])

  useEffect(() => {
    const channel = supabase.channel('live_feed_unified')

    channel
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_trades' },
        (payload) => {
          setTotalSeen(c => c + 1)

          if (!isPausedRef.current) {
            const newTrade = payload.new as LiveTrade
            if (filterTrade(newTrade, filterRef.current)) {
              setTradeCount(c => c + 1)
              setTrades(prev => [newTrade, ...prev.slice(0, maxTrades - 1)])
            }
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [maxTrades])

  const clearTrades = useCallback(() => {
    setTrades([])
    setTradeCount(0)
    setTotalSeen(0)
  }, [])

  return {
    trades,
    isConnected,
    isPaused,
    tradeCount,
    totalSeen,
    setIsPaused,
    clearTrades,
  }
}
