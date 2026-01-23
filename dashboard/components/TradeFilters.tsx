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
    { label: 'All Trades', filter: {} },
    { label: 'Whales Only', filter: { whalesOnly: true } },
    { label: '$1K+', filter: { minUsdValue: 1000 } },
    { label: '$10K+', filter: { minUsdValue: 10000 } },
    { label: '$50K+', filter: { minUsdValue: 50000 } },
    { label: 'Watchlist', filter: { watchlistOnly: true } },
    { label: 'Known Traders', filter: { knownTradersOnly: true } },
  ]

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      {/* Quick Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        {presetFilters.map((preset) => {
          const isActive = JSON.stringify(filter) === JSON.stringify(preset.filter)
          return (
            <button
              key={preset.label}
              onClick={() => onChange(preset.filter)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {preset.label}
            </button>
          )
        })}
      </div>

      {/* Expand/Collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-sm text-gray-400 hover:text-gray-300 flex items-center gap-1"
      >
        {isExpanded ? '▼' : '▶'} Advanced Filters
        {hasActiveFilters && !isExpanded && (
          <span className="ml-2 px-2 py-0.5 bg-blue-600 rounded-full text-xs">Active</span>
        )}
      </button>

      {/* Advanced Filters */}
      {isExpanded && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Min USD Value */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Min USD Value</label>
            <input
              type="number"
              value={filter.minUsdValue || ''}
              onChange={(e) => updateFilter({
                minUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
              })}
              placeholder="e.g. 1000"
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Max USD Value */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Max USD Value</label>
            <input
              type="number"
              value={filter.maxUsdValue || ''}
              onChange={(e) => updateFilter({
                maxUsdValue: e.target.value ? parseFloat(e.target.value) : undefined
              })}
              placeholder="e.g. 100000"
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Trader Address */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Trader Address</label>
            <input
              type="text"
              value={filter.traderAddress || ''}
              onChange={(e) => updateFilter({
                traderAddress: e.target.value || undefined
              })}
              placeholder="0x..."
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* Market Slug */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Market Slug</label>
            <input
              type="text"
              value={filter.marketSlug || ''}
              onChange={(e) => updateFilter({
                marketSlug: e.target.value || undefined
              })}
              placeholder="e.g. will-trump-win"
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Side Filter */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Trade Side</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateFilter({
                  sides: filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? undefined
                    : ['BUY']
                })}
                className={`flex-1 px-3 py-2 rounded text-sm ${
                  filter.sides?.includes('BUY') && filter.sides.length === 1
                    ? 'bg-green-600'
                    : 'bg-gray-700 hover:bg-gray-600'
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
                className={`flex-1 px-3 py-2 rounded text-sm ${
                  filter.sides?.includes('SELL') && filter.sides.length === 1
                    ? 'bg-red-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          {/* Checkboxes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Options</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filter.whalesOnly || false}
                  onChange={(e) => updateFilter({ whalesOnly: e.target.checked || undefined })}
                  className="rounded bg-gray-700"
                />
                Whales Only ($10K+)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filter.watchlistOnly || false}
                  onChange={(e) => updateFilter({ watchlistOnly: e.target.checked || undefined })}
                  className="rounded bg-gray-700"
                />
                Watchlist Only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filter.knownTradersOnly || false}
                  onChange={(e) => updateFilter({ knownTradersOnly: e.target.checked || undefined })}
                  className="rounded bg-gray-700"
                />
                Known Traders Only
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <button
            onClick={clearFilters}
            className="text-sm text-red-400 hover:text-red-300"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  )
}
