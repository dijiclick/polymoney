'use client'

import { InsiderFilter } from '@/lib/supabase'

interface InsiderFilterBarProps {
  filter: InsiderFilter
  onChange: (filter: InsiderFilter) => void
}

export default function InsiderFilterBar({ filter, onChange }: InsiderFilterBarProps) {
  const minScore = filter.minScore || 50

  return (
    <div className="flex items-center gap-3 px-1 py-2 flex-wrap">
      {/* Score slider */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Score</span>
        <input
          type="range"
          min={30}
          max={90}
          step={5}
          value={minScore}
          onChange={(e) => onChange({ ...filter, minScore: parseInt(e.target.value) })}
          className="w-20 h-1 bg-white/10 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/80"
        />
        <span className="text-[11px] text-gray-400 tabular-nums w-6">{minScore}+</span>
      </div>

      <div className="w-px h-4 bg-white/10" />

      {/* Toggle filters */}
      <button
        onClick={() => onChange({ ...filter, freshWalletsOnly: !filter.freshWalletsOnly })}
        className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
          filter.freshWalletsOnly
            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
            : 'text-gray-500 hover:text-gray-400 border border-white/5 hover:border-white/10'
        }`}
      >
        Fresh wallets
      </button>

      <button
        onClick={() => onChange({ ...filter, extremeOddsOnly: !filter.extremeOddsOnly })}
        className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
          filter.extremeOddsOnly
            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
            : 'text-gray-500 hover:text-gray-400 border border-white/5 hover:border-white/10'
        }`}
      >
        Extreme odds
      </button>

      <button
        onClick={() => onChange({ ...filter, copyableOnly: !filter.copyableOnly })}
        className={`text-[10px] px-2 py-1 rounded-full transition-colors ${
          filter.copyableOnly
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'text-gray-500 hover:text-gray-400 border border-white/5 hover:border-white/10'
        }`}
      >
        Copyable only
      </button>
    </div>
  )
}
