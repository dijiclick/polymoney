'use client'

import { useState } from 'react'
import { LiveTrade } from '@/lib/supabase'
import TraderHoverCard from './TraderHoverCard'

interface TradeRowProps {
  trade: LiveTrade
  isSelected: boolean
  isNew: boolean
  onSelect: () => void
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatUsd(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function getValueColor(value: number) {
  if (value >= 50000) return 'text-red-400'
  if (value >= 10000) return 'text-amber-400'
  if (value >= 1000) return 'text-emerald-400'
  return 'text-gray-400'
}

function getBorderColor(trade: LiveTrade) {
  if (trade.is_insider_suspect) return 'border-l-red-500'
  if (trade.is_whale) return 'border-l-amber-500'
  if (trade.is_known_trader) return 'border-l-blue-500'
  return 'border-l-transparent'
}

function getScoreColor(score: number) {
  if (score >= 85) return 'bg-red-500/15 text-red-400'
  if (score >= 70) return 'bg-orange-500/15 text-orange-400'
  if (score >= 55) return 'bg-yellow-500/15 text-yellow-400'
  return 'bg-gray-500/10 text-gray-400'
}

export default function TradeRow({ trade, isSelected, isNew, onSelect }: TradeRowProps) {
  const [copied, setCopied] = useState(false)

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(trade.trader_address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const openPolymarket = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(`https://polymarket.com/profile/${trade.trader_address}`, '_blank')
  }

  const animClass = isNew
    ? trade.side === 'BUY' ? 'animate-trade-flash-buy' : 'animate-trade-flash-sell'
    : ''

  return (
    <div
      onClick={onSelect}
      className={`
        group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors
        border-l-[3px] ${getBorderColor(trade)}
        ${isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}
        ${animClass}
      `}
    >
      {/* Score */}
      <div className="w-8 flex-shrink-0 flex justify-center">
        {trade.is_insider_suspect && trade.trader_insider_score ? (
          <span className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold ${getScoreColor(trade.trader_insider_score)}`}>
            {trade.trader_insider_score}
          </span>
        ) : null}
      </div>

      {/* Side */}
      <div className="w-10 flex-shrink-0">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
          trade.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
        }`}>
          {trade.side}
        </span>
      </div>

      {/* Trader */}
      <div className="w-[130px] flex-shrink-0 min-w-0">
        <div className="flex items-center gap-1.5">
          <TraderHoverCard address={trade.trader_address}>
            <span className="text-xs text-gray-300 truncate font-medium cursor-default">
              {trade.trader_username || formatAddress(trade.trader_address)}
            </span>
          </TraderHoverCard>
          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={copyAddress} className="p-0.5 hover:bg-white/10 rounded" title="Copy address">
              {copied ? (
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            <button onClick={openPolymarket} className="p-0.5 hover:bg-white/10 rounded" title="Open on Polymarket">
              <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Market */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 truncate">
          <span className="text-gray-400">{trade.outcome || 'Position'}</span>
          {' · '}
          {trade.market_slug || 'Unknown'}
        </p>
      </div>

      {/* Price */}
      <div className="w-12 flex-shrink-0 text-right">
        <span className="text-[11px] text-gray-400 tabular-nums">
          {(trade.price * 100).toFixed(0)}%
        </span>
      </div>

      {/* Value */}
      <div className="w-16 flex-shrink-0 text-right">
        <span className={`text-xs font-medium tabular-nums ${getValueColor(trade.usd_value)}`}>
          {formatUsd(trade.usd_value)}
        </span>
      </div>

      {/* Time */}
      <div className="w-10 flex-shrink-0 text-right">
        <span className="text-[10px] text-gray-600 tabular-nums">
          {formatTime(trade.executed_at)}
        </span>
      </div>

      {/* Flags */}
      <div className="w-14 flex-shrink-0 flex items-center justify-end gap-1">
        {trade.is_insider_suspect && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium">INS</span>
        )}
        {trade.is_whale && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">WHL</span>
        )}
        {trade.trader_red_flags && trade.trader_red_flags.length > 0 && (
          <span className="text-[8px] text-red-400/60" title={trade.trader_red_flags.join(', ')}>
            {trade.trader_red_flags.length}F
          </span>
        )}
      </div>
    </div>
  )
}
