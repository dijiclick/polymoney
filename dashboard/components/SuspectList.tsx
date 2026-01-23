'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, InsiderSuspect } from '@/lib/supabase'

interface SuspectListProps {
  onSelectTrader: (address: string | null) => void
  selectedAddress: string | null
  activeAddresses?: Set<string>
}

interface Filters {
  minScore: number
  maxAgeDays: number
  sortBy: 'score' | 'profit' | 'recent'
}

export default function SuspectList({
  onSelectTrader,
  selectedAddress,
  activeAddresses = new Set()
}: SuspectListProps) {
  const [suspects, setSuspects] = useState<InsiderSuspect[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>({
    minScore: 60,
    maxAgeDays: 365,
    sortBy: 'score'
  })

  const fetchSuspects = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('traders')
      .select(`
        address, username, portfolio_value, total_pnl, roi_percent,
        win_rate_30d, account_age_days, unique_markets_30d,
        position_concentration, max_position_size, avg_entry_probability,
        insider_score, insider_level, insider_red_flags,
        last_trade_at, last_updated_at
      `)
      .gte('insider_score', filters.minScore)
      .is('eliminated_at_step', null)

    if (filters.maxAgeDays < 365) {
      query = query.lte('account_age_days', filters.maxAgeDays)
    }

    // Sort
    if (filters.sortBy === 'score') {
      query = query.order('insider_score', { ascending: false })
    } else if (filters.sortBy === 'profit') {
      query = query.order('total_pnl', { ascending: false })
    } else {
      query = query.order('last_trade_at', { ascending: false, nullsFirst: false })
    }

    query = query.limit(100)

    const { data, error } = await query

    if (!error && data) {
      setSuspects(data as InsiderSuspect[])
    }
    setLoading(false)
  }, [filters])

  useEffect(() => {
    fetchSuspects()
  }, [fetchSuspects])

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-red-400'
    if (score >= 70) return 'text-orange-400'
    return 'text-yellow-400'
  }

  const getScoreBadge = (score: number) => {
    if (score >= 85) return 'bg-red-500/20 border-red-500/50'
    if (score >= 70) return 'bg-orange-500/20 border-orange-500/50'
    return 'bg-yellow-500/20 border-yellow-500/50'
  }

  const formatUsd = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const formatTimeAgo = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'Never'
    const diff = Date.now() - new Date(timestamp).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Insider Suspects</h2>
          <button
            onClick={fetchSuspects}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-gray-400">
              Score
              <select
                value={filters.minScore}
                onChange={(e) => setFilters(f => ({ ...f, minScore: Number(e.target.value) }))}
                className="bg-gray-700 rounded px-2 py-1 text-xs"
              >
                <option value={60}>60+</option>
                <option value={70}>70+</option>
                <option value={80}>80+</option>
                <option value={85}>85+</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-gray-400">
              Age
              <select
                value={filters.maxAgeDays}
                onChange={(e) => setFilters(f => ({ ...f, maxAgeDays: Number(e.target.value) }))}
                className="bg-gray-700 rounded px-2 py-1 text-xs"
              >
                <option value={7}>7d</option>
                <option value={14}>14d</option>
                <option value={30}>30d</option>
                <option value={60}>60d</option>
                <option value={365}>Any</option>
              </select>
            </label>
          </div>
          <div className="flex gap-1">
            {(['score', 'profit', 'recent'] as const).map(sort => (
              <button
                key={sort}
                onClick={() => setFilters(f => ({ ...f, sortBy: sort }))}
                className={`px-2 py-1 rounded text-xs ${
                  filters.sortBy === sort
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                {sort === 'score' ? 'Score' : sort === 'profit' ? 'Profit' : 'Recent'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Suspect List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading suspects...</div>
        ) : suspects.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="mb-2">No insider suspects found</div>
            <div className="text-xs">Run the pipeline to detect insiders</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {suspects.map((suspect) => {
              const isActive = activeAddresses.has(suspect.address.toLowerCase())
              const isSelected = selectedAddress === suspect.address

              return (
                <button
                  key={suspect.address}
                  onClick={() => onSelectTrader(isSelected ? null : suspect.address)}
                  className={`w-full p-3 text-left hover:bg-gray-750 transition-colors ${
                    isSelected ? 'bg-blue-900/30 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Score Badge */}
                    <div className={`px-2 py-1 rounded border text-sm font-bold ${getScoreBadge(suspect.insider_score)} ${getScoreColor(suspect.insider_score)}`}>
                      {suspect.insider_score}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate">
                          {suspect.username || formatAddress(suspect.address)}
                        </span>
                        {isActive && (
                          <span className="text-green-400 text-xs animate-pulse">Active</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatUsd(suspect.total_pnl)} profit
                        <span className="mx-1">·</span>
                        {suspect.account_age_days}d old
                      </div>
                      {suspect.insider_red_flags && suspect.insider_red_flags.length > 0 && (
                        <div className="text-xs text-red-400/80 mt-1 truncate">
                          {suspect.insider_red_flags[0]}
                        </div>
                      )}
                    </div>

                    {/* Last Activity */}
                    <div className="text-right text-xs text-gray-500">
                      {formatTimeAgo(suspect.last_trade_at)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
        Showing {suspects.length} suspects
      </div>
    </div>
  )
}
