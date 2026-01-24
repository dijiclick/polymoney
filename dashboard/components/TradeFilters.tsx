'use client'

import { useState } from 'react'
import { TradeFilter } from '@/lib/supabase'

interface TradeFiltersProps {
  filter: TradeFilter
  onChange: (filter: TradeFilter) => void
}

export default function TradeFilters({ filter, onChange }: TradeFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const updateFilter = (updates: Partial<TradeFilter>) => {
    onChange({ ...filter, ...updates })
  }

  const clearFilters = () => {
    onChange({})
  }

  const hasActiveFilters = Object.values(filter).some(v =>
    v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : true)
  )

  const presetFilters = [
    { label: 'All', value: 0 },
    { label: '$100+', value: 100 },
    { label: '$500+', value: 500 },
    { label: '$1K+', value: 1000 },
    { label: '$10K+', value: 10000 },
    { label: '$50K+', value: 50000 },
  ]

  const isPresetActive = (value: number) => {
    if (value === 0) return !filter.minUsdValue && !filter.whalesOnly && !filter.insidersOnly && !filter.watchlistOnly
    return filter.minUsdValue === value && !filter.whalesOnly && !filter.insidersOnly && !filter.watchlistOnly
  }

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800/50 p-4 mb-4">
      {/* Quick Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Amount Presets */}
        <div className="flex gap-1.5">
          {presetFilters.map((preset) => (
            <button
              key={preset.label}
              onClick={() => onChange(preset.value === 0 ? {} : { minUsdValue: preset.value })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                isPresetActive(preset.value)
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white border border-gray-700/50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-gray-700/50 mx-1" />

        {/* Type Filters */}
        <div className="flex gap-1.5">
          <button
            onClick={() => updateFilter({ whalesOnly: !filter.whalesOnly })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              filter.whalesOnly
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white border border-gray-700/50'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
            Whales
          </button>
          <button
            onClick={() => updateFilter({ insidersOnly: !filter.insidersOnly })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              filter.insidersOnly
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white border border-gray-700/50'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Insiders
          </button>
          <button
            onClick={() => updateFilter({ watchlistOnly: !filter.watchlistOnly })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              filter.watchlistOnly
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-white border border-gray-700/50'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Watchlist
          </button>
        </div>

        <div className="flex-1" />

        {/* Expand Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 flex items-center gap-1.5 transition-all"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          More
          {hasActiveFilters && !isExpanded && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
          )}
        </button>
      </div>

      {/* Advanced Filters */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-800/50 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Min USD Value */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Min Value</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={filter.minUsdValue || ''}
                onChange={(e) => updateFilter({
                  minUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
                })}
                placeholder="0"
                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg pl-7 pr-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Max USD Value */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Max Value</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={filter.maxUsdValue || ''}
                onChange={(e) => updateFilter({
                  maxUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
                })}
                placeholder="No max"
                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg pl-7 pr-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
              />
            </div>
          </div>

          {/* Trader Address */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Trader Address</label>
            <input
              type="text"
              value={filter.traderAddress || ''}
              onChange={(e) => updateFilter({
                traderAddress: e.target.value || undefined
              })}
              placeholder="0x..."
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-blue-500/50 focus:outline-none"
            />
          </div>

          {/* Market Slug */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Market</label>
            <input
              type="text"
              value={filter.marketSlug || ''}
              onChange={(e) => updateFilter({
                marketSlug: e.target.value || undefined
              })}
              placeholder="Market slug..."
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
            />
          </div>

          {/* Side Filter */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">Side</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateFilter({
                  sides: filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? undefined
                    : ['BUY']
                })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                }`}
              >
                BUY
              </button>
              <button
                onClick={() => updateFilter({
                  sides: filter.sides?.includes('SELL') && filter.sides.length === 1
                    ? undefined
                    : ['SELL']
                })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter.sides?.includes('SELL') && filter.sides.length === 1
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          {/* Known Traders */}
          <div className="flex items-end">
            <button
              onClick={() => updateFilter({ knownTradersOnly: !filter.knownTradersOnly })}
              className={`w-full px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                filter.knownTradersOnly
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 border border-gray-700/50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Known Only
            </button>
          </div>
        </div>
      )}

      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="mt-4 pt-3 border-t border-gray-800/50 flex justify-end">
          <button
            onClick={clearFilters}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-800/50 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear all filters
          </button>
        </div>
      )}
    </div>
  )
}
