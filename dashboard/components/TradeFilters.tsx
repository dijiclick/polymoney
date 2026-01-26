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
    if (value === 0) return !filter.minUsdValue && !filter.whalesOnly && !filter.insidersOnly
    return filter.minUsdValue === value && !filter.whalesOnly && !filter.insidersOnly
  }

  return (
    <div className="glass rounded-xl p-3 mb-4">
      {/* Quick Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Amount Presets */}
        <div className="flex gap-1">
          {presetFilters.map((preset) => (
            <button
              key={preset.label}
              onClick={() => onChange(preset.value === 0 ? {} : { minUsdValue: preset.value })}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                isPresetActive(preset.value)
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/5 mx-1" />

        {/* Type Filters */}
        <div className="flex gap-1">
          <button
            onClick={() => updateFilter({ whalesOnly: !filter.whalesOnly })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
              filter.whalesOnly
                ? 'bg-amber-500/10 text-amber-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
            </svg>
            Whales
          </button>
          <button
            onClick={() => updateFilter({ insidersOnly: !filter.insidersOnly })}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1 ${
              filter.insidersOnly
                ? 'bg-orange-500/10 text-orange-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Insiders
          </button>
        </div>

        <div className="flex-1" />

        {/* Expand Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium text-gray-500 hover:text-gray-300 hover:bg-white/[0.03] flex items-center gap-1 transition-all"
        >
          <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
          More
          {hasActiveFilters && !isExpanded && (
            <span className="w-1 h-1 rounded-full bg-blue-400"></span>
          )}
        </button>
      </div>

      {/* Advanced Filters */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Min USD Value */}
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Min Value</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-xs">$</span>
              <input
                type="number"
                value={filter.minUsdValue || ''}
                onChange={(e) => updateFilter({
                  minUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
                })}
                placeholder="0"
                className="w-full bg-white/[0.02] border border-white/5 rounded-md pl-5 pr-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Max USD Value */}
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Max Value</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-xs">$</span>
              <input
                type="number"
                value={filter.maxUsdValue || ''}
                onChange={(e) => updateFilter({
                  maxUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
                })}
                placeholder="No max"
                className="w-full bg-white/[0.02] border border-white/5 rounded-md pl-5 pr-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Trader Address */}
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Trader</label>
            <input
              type="text"
              value={filter.traderAddress || ''}
              onChange={(e) => updateFilter({
                traderAddress: e.target.value || undefined
              })}
              placeholder="0x..."
              className="w-full bg-white/[0.02] border border-white/5 rounded-md px-2 py-1.5 text-xs font-mono text-white focus:border-white/20 focus:outline-none transition-colors"
            />
          </div>

          {/* Market Slug */}
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Market</label>
            <input
              type="text"
              value={filter.marketSlug || ''}
              onChange={(e) => updateFilter({
                marketSlug: e.target.value || undefined
              })}
              placeholder="Market slug..."
              className="w-full bg-white/[0.02] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors"
            />
          </div>

          {/* Side Filter */}
          <div>
            <label className="block text-[10px] text-gray-600 uppercase tracking-wider mb-1">Side</label>
            <div className="flex gap-1">
              <button
                onClick={() => updateFilter({
                  sides: filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? undefined
                    : ['BUY']
                })}
                className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-white/[0.02] text-gray-500 hover:text-gray-300'
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
                className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filter.sides?.includes('SELL') && filter.sides.length === 1
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-white/[0.02] text-gray-500 hover:text-gray-300'
                }`}
              >
                SELL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="mt-3 pt-2 border-t border-white/5 flex justify-end">
          <button
            onClick={clearFilters}
            className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/[0.03] transition-all"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}
