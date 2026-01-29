'use client'

import { TradeFilter } from '@/lib/supabase'

interface LiveFilterBarProps {
  filter: TradeFilter
  onChange: (filter: TradeFilter) => void
}

interface Chip {
  key: string
  label: string
  isActive: boolean
  color: string
  onToggle: () => void
}

export default function LiveFilterBar({ filter, onChange }: LiveFilterBarProps) {
  const update = (updates: Partial<TradeFilter>) => onChange({ ...filter, ...updates })

  const chips: Chip[] = [
    {
      key: 'insiders',
      label: 'Insiders',
      isActive: !!filter.insidersOnly,
      color: 'orange',
      onToggle: () => {
        if (filter.insidersOnly) {
          const { insidersOnly, minInsiderScore, ...rest } = filter
          onChange(rest)
        } else {
          update({ insidersOnly: true, minInsiderScore: 40 })
        }
      },
    },
    {
      key: 'whales',
      label: 'Whales',
      isActive: !!filter.whalesOnly,
      color: 'amber',
      onToggle: () => {
        if (filter.whalesOnly) {
          const { whalesOnly, ...rest } = filter
          onChange(rest)
        } else {
          update({ whalesOnly: true })
        }
      },
    },
    {
      key: '1k',
      label: '$1K+',
      isActive: filter.minUsdValue === 1000,
      color: 'emerald',
      onToggle: () => update({ minUsdValue: filter.minUsdValue === 1000 ? undefined : 1000 }),
    },
    {
      key: '10k',
      label: '$10K+',
      isActive: filter.minUsdValue === 10000,
      color: 'emerald',
      onToggle: () => update({ minUsdValue: filter.minUsdValue === 10000 ? undefined : 10000 }),
    },
    {
      key: 'buy',
      label: 'BUY',
      isActive: filter.sides?.length === 1 && filter.sides[0] === 'BUY',
      color: 'emerald',
      onToggle: () => {
        if (filter.sides?.length === 1 && filter.sides[0] === 'BUY') {
          const { sides, ...rest } = filter
          onChange(rest)
        } else {
          update({ sides: ['BUY'] })
        }
      },
    },
    {
      key: 'sell',
      label: 'SELL',
      isActive: filter.sides?.length === 1 && filter.sides[0] === 'SELL',
      color: 'red',
      onToggle: () => {
        if (filter.sides?.length === 1 && filter.sides[0] === 'SELL') {
          const { sides, ...rest } = filter
          onChange(rest)
        } else {
          update({ sides: ['SELL'] })
        }
      },
    },
  ]

  const chipColorMap: Record<string, { active: string; inactive: string }> = {
    orange: { active: 'bg-orange-500/15 text-orange-400 border-orange-500/20', inactive: '' },
    amber: { active: 'bg-amber-500/15 text-amber-400 border-amber-500/20', inactive: '' },
    emerald: { active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', inactive: '' },
    red: { active: 'bg-red-500/15 text-red-400 border-red-500/20', inactive: '' },
  }

  const hasActiveFilters = Object.keys(filter).length > 0

  // Build active filter tags for display
  const activeTags: { label: string; onRemove: () => void }[] = []
  if (filter.insidersOnly) activeTags.push({ label: 'Insiders', onRemove: () => { const { insidersOnly, minInsiderScore, ...rest } = filter; onChange(rest) } })
  if (filter.whalesOnly) activeTags.push({ label: 'Whales', onRemove: () => { const { whalesOnly, ...rest } = filter; onChange(rest) } })
  if (filter.minUsdValue) activeTags.push({ label: `$${filter.minUsdValue >= 1000 ? `${filter.minUsdValue / 1000}K` : filter.minUsdValue}+`, onRemove: () => { const { minUsdValue, ...rest } = filter; onChange(rest) } })
  if (filter.sides?.length === 1) activeTags.push({ label: filter.sides[0], onRemove: () => { const { sides, ...rest } = filter; onChange(rest) } })
  if (filter.traderAddress) activeTags.push({ label: `${filter.traderAddress.slice(0, 8)}...`, onRemove: () => { const { traderAddress, ...rest } = filter; onChange(rest) } })
  if (filter.minInsiderScore && filter.minInsiderScore > 40) activeTags.push({ label: `Score ${filter.minInsiderScore}+`, onRemove: () => update({ minInsiderScore: 40 }) })

  return (
    <div className="space-y-2 mb-3">
      {/* Chips row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map(chip => (
          <button
            key={chip.key}
            onClick={chip.onToggle}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
              chip.isActive
                ? chipColorMap[chip.color].active
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
            }`}
          >
            {chip.label}
          </button>
        ))}

        <div className="hidden sm:block w-px h-5 bg-white/5 mx-1" />

        {/* Trader address input */}
        <div className="relative w-full sm:w-auto">
          <input
            type="text"
            value={filter.traderAddress || ''}
            onChange={(e) => update({ traderAddress: e.target.value || undefined })}
            placeholder="0x... or slug"
            className="w-full sm:w-[140px] bg-white/[0.02] border border-white/5 rounded-md px-2 py-1 text-[11px] font-mono text-gray-300 placeholder:text-gray-600 focus:border-white/15 focus:outline-none transition-colors"
          />
        </div>

        {hasActiveFilters && (
          <>
            <div className="flex-1" />
            <button
              onClick={() => onChange({})}
              className="px-2 py-1 rounded-md text-[10px] text-gray-500 hover:text-white hover:bg-white/5 transition-all flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear all
            </button>
          </>
        )}
      </div>

      {/* Insider score slider */}
      {filter.insidersOnly && (
        <div className="flex items-center gap-3 px-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider w-20">Score {filter.minInsiderScore || 40}+</span>
          <input
            type="range"
            min={40}
            max={100}
            step={5}
            value={filter.minInsiderScore || 40}
            onChange={(e) => update({ minInsiderScore: parseInt(e.target.value) })}
            className="flex-1 h-1 bg-white/5 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-400 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(251,146,60,0.3)]"
          />
          <span className="text-[10px] text-gray-600 tabular-nums w-6 text-right">100</span>
        </div>
      )}

      {/* Active filter tags */}
      {activeTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeTags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] text-[10px] text-gray-400"
            >
              {tag.label}
              <button
                onClick={tag.onRemove}
                className="hover:text-white transition-colors"
              >
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
