'use client'

import { useRef, useEffect, useState } from 'react'
import { LiveTrade } from '@/lib/supabase'
import TradeRow from './TradeRow'

interface TradeTableProps {
  trades: LiveTrade[]
  selectedAddress: string | null
  onSelectTrader: (address: string, username?: string) => void
}

export default function TradeTable({ trades, selectedAddress, onSelectTrader }: TradeTableProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [newTradeIds, setNewTradeIds] = useState<Set<string | number>>(new Set())
  const prevTradeIdsRef = useRef<Set<string | number>>(new Set())

  // Track new trades for flash animation
  useEffect(() => {
    const currentIds = new Set(trades.map(t => t.id || t.trade_id))
    const newIds = new Set<string | number>()

    currentIds.forEach(id => {
      if (!prevTradeIdsRef.current.has(id)) {
        newIds.add(id)
      }
    })

    if (newIds.size > 0) {
      setNewTradeIds(newIds)
      const timer = setTimeout(() => setNewTradeIds(new Set()), 1500)
      prevTradeIdsRef.current = currentIds
      return () => clearTimeout(timer)
    }

    prevTradeIdsRef.current = currentIds
  }, [trades])

  return (
    <div className="glass rounded-xl h-full flex flex-col overflow-hidden">
      {/* Sticky Header */}
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 border-b border-white/5 bg-[var(--surface)] sticky top-0 z-10">
        <div className="hidden sm:flex w-8 flex-shrink-0 justify-center">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Score</span>
        </div>
        <div className="w-10 flex-shrink-0">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Side</span>
        </div>
        <div className="w-[90px] sm:w-[130px] flex-shrink-0">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Trader</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Market</span>
        </div>
        <div className="hidden sm:block w-12 flex-shrink-0 text-right">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Price</span>
        </div>
        <div className="w-14 sm:w-16 flex-shrink-0 text-right">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Value</span>
        </div>
        <div className="w-8 sm:w-10 flex-shrink-0 text-right">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Time</span>
        </div>
        <div className="hidden sm:flex w-14 flex-shrink-0 justify-end">
          <span className="text-[9px] text-gray-600 uppercase tracking-wider">Flags</span>
        </div>
      </div>

      {/* Scrollable Trade List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 rounded-lg bg-white/[0.02] flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">Waiting for trades...</p>
            <p className="text-gray-600 text-xs mt-1">Live trades will stream in real-time</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.02]">
            {trades.map((trade, idx) => (
              <TradeRow
                key={trade.id || trade.trade_id || idx}
                trade={trade}
                isSelected={selectedAddress === trade.trader_address}
                isNew={newTradeIds.has(trade.id || trade.trade_id)}
                onSelect={() => onSelectTrader(trade.trader_address, trade.trader_username || undefined)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
