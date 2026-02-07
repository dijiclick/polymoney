'use client'

import { InsiderAlert } from '@/lib/supabase'

interface InsiderAlertCardProps {
  alert: InsiderAlert
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
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
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

function formatWalletAge(days: number | undefined, nonce: number | undefined) {
  if (days === undefined && nonce === undefined) return null
  if (days !== undefined && days <= 1) return 'new wallet'
  if (days !== undefined && days <= 7) return `${days}d old`
  if (days !== undefined && days <= 30) return `${days}d old`
  if (nonce !== undefined && nonce <= 5) return `${nonce} txns`
  return null
}

function formatVolume(vol: number | undefined) {
  if (!vol) return null
  if (vol >= 1000000) return `$${(vol / 1000000).toFixed(1)}M/d`
  if (vol >= 1000) return `$${(vol / 1000).toFixed(0)}K/d`
  return `$${vol.toFixed(0)}/d`
}

function getScoreColor(score: number) {
  if (score >= 80) return { badge: 'bg-red-500/20 text-red-400 border-red-500/30', border: 'border-l-red-500', bg: 'bg-red-500/[0.03]' }
  if (score >= 60) return { badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30', border: 'border-l-orange-500', bg: 'bg-orange-500/[0.02]' }
  return { badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', border: 'border-l-yellow-500', bg: '' }
}

const SIGNAL_STYLES: Record<string, string> = {
  'Fresh Wallet': 'bg-purple-500/15 text-purple-400',
  'Extreme Odds': 'bg-red-500/15 text-red-400',
  'Oversized': 'bg-amber-500/15 text-amber-400',
  'Niche Market': 'bg-blue-500/15 text-blue-400',
  'High Conviction': 'bg-cyan-500/15 text-cyan-400',
  'Category Expert': 'bg-emerald-500/15 text-emerald-400',
}

function ProfitabilityBadge({ status, copyScore, pf }: { status: string, copyScore?: number, pf?: number }) {
  switch (status) {
    case 'copyable':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
          <span className="text-emerald-500">●</span>
          Copyable{copyScore ? ` (${copyScore})` : ''}
          {pf ? ` · PF ${pf.toFixed(1)}` : ''}
        </span>
      )
    case 'profitable':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
          <span className="text-amber-500">●</span>
          Profitable{pf ? ` · PF ${pf.toFixed(1)}` : ''}
        </span>
      )
    case 'unprofitable':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
          <span className="text-gray-600">●</span>
          Unprofitable
        </span>
      )
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
          <span className="animate-pulse">◌</span>
          Awaiting analysis
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-600">
          <span>○</span>
          Unknown
        </span>
      )
  }
}

export default function InsiderAlertCard({ alert, isSelected, isNew, onSelect }: InsiderAlertCardProps) {
  const colors = getScoreColor(alert.score_total)
  const walletAge = formatWalletAge(alert.wallet_age_days, alert.wallet_nonce)
  const marketVol = formatVolume(alert.market_daily_volume)

  return (
    <div
      onClick={onSelect}
      className={`
        group cursor-pointer transition-all duration-200
        border-l-[3px] ${colors.border} ${colors.bg}
        rounded-r-lg
        ${isSelected ? 'bg-white/[0.06] ring-1 ring-white/10' : 'hover:bg-white/[0.04]'}
        ${isNew ? 'animate-fade-in' : ''}
      `}
    >
      {/* Row 1: Score + Signal Badges */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
        <span className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold border ${colors.badge}`}>
          {alert.score_total}
        </span>
        <div className="flex flex-wrap gap-1 min-w-0">
          {alert.signals.map((signal) => (
            <span
              key={signal}
              className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${SIGNAL_STYLES[signal] || 'bg-gray-500/10 text-gray-400'}`}
            >
              {signal}
            </span>
          ))}
        </div>
      </div>

      {/* Row 2: Trade Info */}
      <div className="flex items-center gap-2 px-3 py-1">
        {/* Trader */}
        <div className="flex items-center gap-1.5 min-w-0 shrink-0">
          <span className="text-xs text-gray-300 font-medium truncate max-w-[120px]">
            {alert.trader_username || formatAddress(alert.trader_address)}
          </span>
          {walletAge && (
            <span className="text-[9px] text-purple-400/80 bg-purple-500/10 px-1 py-0.5 rounded shrink-0">
              {walletAge}
            </span>
          )}
        </div>

        {/* Side + Market */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
            alert.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
          }`}>
            {alert.side}
          </span>
          <span className="text-[11px] text-gray-500 truncate">
            {alert.outcome && <span className="text-gray-400">{alert.outcome}</span>}
            {alert.outcome && alert.market_slug && ' · '}
            {alert.market_slug || ''}
          </span>
        </div>

        {/* Price + Value */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-gray-500 tabular-nums hidden sm:inline">
            @{(alert.price * 100).toFixed(0)}¢
          </span>
          <span className={`text-xs font-semibold tabular-nums ${
            alert.usd_value >= 50000 ? 'text-red-400' :
            alert.usd_value >= 10000 ? 'text-amber-400' :
            alert.usd_value >= 1000 ? 'text-emerald-400' : 'text-gray-400'
          }`}>
            {formatUsd(alert.usd_value)}
          </span>
        </div>
      </div>

      {/* Row 3: Profitability + Context */}
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
        <ProfitabilityBadge
          status={alert.profitability_status}
          copyScore={alert.copy_score ?? undefined}
          pf={alert.profit_factor_30d ?? undefined}
        />
        <span className="text-gray-700">·</span>
        {marketVol && (
          <>
            <span className="text-[10px] text-gray-600">Vol: {marketVol}</span>
            <span className="text-gray-700">·</span>
          </>
        )}
        <span className="text-[10px] text-gray-600">{formatTime(alert.executed_at)}</span>
      </div>
    </div>
  )
}
