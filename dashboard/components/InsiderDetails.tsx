'use client'

import { useEffect, useState } from 'react'
import { supabase, Trader } from '@/lib/supabase'

interface InsiderDetailsProps {
  address: string | null
  onClose?: () => void
}

interface Position {
  market_slug: string
  market_title: string
  outcome: string
  size: number
  avg_price: number
  current_price: number
  pnl: number
}

export default function InsiderDetails({ address, onClose }: InsiderDetailsProps) {
  const [trader, setTrader] = useState<Trader | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (address) {
      fetchTraderDetails()
    } else {
      setTrader(null)
      setPositions([])
    }
  }, [address])

  async function fetchTraderDetails() {
    if (!address) return
    setLoading(true)

    // Fetch trader
    const { data: traderData } = await supabase
      .from('traders')
      .select('*')
      .eq('address', address)
      .single()

    if (traderData) {
      setTrader(traderData)
    }

    // Fetch positions
    const { data: posData } = await supabase
      .from('trader_positions')
      .select('*')
      .eq('address', address)
      .order('current_value', { ascending: false })
      .limit(10)

    setPositions(posData || [])
    setLoading(false)
  }

  const formatUsd = (value: number | null | undefined) => {
    if (value == null) return '-'
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`

  const getScoreColor = (score: number | undefined) => {
    if (!score) return 'text-gray-400'
    if (score >= 85) return 'text-red-400'
    if (score >= 70) return 'text-orange-400'
    return 'text-yellow-400'
  }

  const getLevelBadge = (level: string | undefined) => {
    switch (level) {
      case 'very_high':
        return 'bg-red-500/20 text-red-400 border-red-500/50'
      case 'high':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/50'
      case 'moderate':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
    }
  }

  if (!address) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">Select a suspect</div>
          <div className="text-sm">Click on a trader from the list to see details</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (!trader) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-gray-500">Trader not found</div>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="truncate">
            <div className="font-semibold">
              {trader.username || formatAddress(trader.address)}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {trader.address}
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1"
            >
              x
            </button>
          )}
        </div>
        <a
          href={`/traders/${trader.address}`}
          className="text-xs text-blue-400 hover:underline"
        >
          View Full Profile
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Insider Score */}
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Insider Score
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-4xl font-bold ${getScoreColor(trader.insider_score)}`}>
              {trader.insider_score || 0}
            </div>
            <div className="flex-1">
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    (trader.insider_score || 0) >= 85 ? 'bg-red-500' :
                    (trader.insider_score || 0) >= 70 ? 'bg-orange-500' :
                    'bg-yellow-500'
                  }`}
                  style={{ width: `${trader.insider_score || 0}%` }}
                />
              </div>
            </div>
          </div>
          {trader.insider_level && (
            <span className={`inline-block mt-2 text-xs px-2 py-1 rounded border ${getLevelBadge(trader.insider_level)}`}>
              {trader.insider_level.replace('_', ' ').toUpperCase()}
            </span>
          )}
        </div>

        {/* Red Flags */}
        {trader.insider_red_flags && trader.insider_red_flags.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              Red Flags
            </div>
            <div className="space-y-1">
              {trader.insider_red_flags.map((flag, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm"
                >
                  <span className="text-red-400">!</span>
                  <span className="text-red-300">{flag}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Score Breakdown */}
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Score Breakdown
          </div>
          <div className="space-y-2 text-sm">
            <ScoreBar
              label="New + Profit"
              value={getNewAccountScore(trader)}
              max={25}
            />
            <ScoreBar
              label="Concentration"
              value={getConcentrationScore(trader)}
              max={25}
            />
            <ScoreBar
              label="Entry Prob"
              value={getEntryProbScore(trader)}
              max={20}
            />
            <ScoreBar
              label="Few Markets"
              value={getFewMarketsScore(trader)}
              max={15}
            />
            <ScoreBar
              label="Position Size"
              value={getPositionSizeScore(trader)}
              max={15}
            />
          </div>
        </div>

        {/* Stats */}
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
            Stats
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Account Age" value={`${trader.account_age_days || 0} days`} />
            <Stat label="Total PnL" value={formatUsd(trader.total_pnl)} highlight={trader.total_pnl > 0} />
            <Stat label="Markets" value={`${trader.unique_markets_30d || 0}`} />
            <Stat label="Win Rate" value={`${(trader.win_rate_30d || 0).toFixed(0)}%`} />
            <Stat label="Concentration" value={`${(trader.position_concentration || 0).toFixed(0)}%`} warn={(trader.position_concentration || 0) > 50} />
            <Stat label="Max Position" value={formatUsd(trader.max_position_size)} />
          </div>
        </div>

        {/* Current Positions */}
        {positions.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              Current Positions
            </div>
            <div className="space-y-2">
              {positions.map((pos, i) => (
                <div key={i} className="bg-gray-700/50 rounded p-2 text-sm">
                  <div className="font-medium text-gray-200 truncate">
                    {pos.market_slug || 'Unknown'}
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{pos.outcome} @ {((pos.avg_price || 0) * 100).toFixed(0)}%</span>
                    <span className={pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {formatUsd(pos.pnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-700">
        <button
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
          onClick={() => {
            // Add to watchlist
          }}
        >
          + Add to Watchlist
        </button>
      </div>
    </div>
  )
}

// Helper components
function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 text-gray-400 text-xs">{label}</div>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-10 text-right text-xs text-gray-400">
        {value}/{max}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
  warn
}: {
  label: string
  value: string
  highlight?: boolean
  warn?: boolean
}) {
  return (
    <div className="bg-gray-700/30 rounded p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`font-medium ${
        warn ? 'text-red-400' : highlight ? 'text-green-400' : 'text-white'
      }`}>
        {value}
      </div>
    </div>
  )
}

// Score calculation helpers (mirror the backend logic)
function getNewAccountScore(trader: Trader): number {
  const age = trader.account_age_days || 365
  const pnl = trader.total_pnl || 0
  if (age <= 14 && pnl >= 5000) return 25
  if (age <= 30 && pnl >= 2000) return 20
  if (age <= 30 && pnl >= 500) return 12
  if (age <= 60 && pnl >= 1000) return 6
  return 0
}

function getConcentrationScore(trader: Trader): number {
  const conc = trader.position_concentration || 0
  if (conc >= 80) return 25
  if (conc >= 60) return 20
  if (conc >= 50) return 15
  if (conc >= 40) return 8
  return 0
}

function getEntryProbScore(trader: Trader): number {
  const entry = trader.avg_entry_probability || 50
  if (entry <= 15) return 20
  if (entry <= 25) return 16
  if (entry <= 30) return 12
  if (entry <= 35) return 6
  return 0
}

function getFewMarketsScore(trader: Trader): number {
  const markets = trader.unique_markets_30d || 10
  if (markets === 1) return 15
  if (markets === 2) return 12
  if (markets <= 3) return 8
  if (markets <= 5) return 4
  return 0
}

function getPositionSizeScore(trader: Trader): number {
  const maxPos = trader.max_position_size || 0
  if (maxPos >= 50000) return 15
  if (maxPos >= 20000) return 12
  if (maxPos >= 10000) return 9
  if (maxPos >= 5000) return 6
  if (maxPos >= 2000) return 3
  return 0
}
