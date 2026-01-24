'use client'

import { WalletFilter } from '@/lib/supabase'

interface Props {
  filter: WalletFilter
  onChange: (filter: WalletFilter) => void
}

export default function WalletFilters({ filter, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-4 items-end">
      {/* Min Portfolio Value */}
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Min Portfolio
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          <input
            type="number"
            value={filter.minBalance ?? ''}
            onChange={(e) => onChange({ ...filter, minBalance: e.target.value === '' ? 0 : parseInt(e.target.value) })}
            placeholder="0"
            min={0}
            step={100}
            className="w-full bg-gray-800/50 rounded-xl pl-8 pr-4 py-3 text-white border border-gray-700/50 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          />
        </div>
      </div>

      {/* Min Win Rate */}
      <div className="flex-1 min-w-[200px]">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Min Win Rate
        </label>
        <div className="relative">
          <input
            type="number"
            value={filter.minWinRate ?? ''}
            onChange={(e) => onChange({ ...filter, minWinRate: e.target.value === '' ? 0 : parseInt(e.target.value) })}
            placeholder="0"
            min={0}
            max={100}
            step={5}
            className="w-full bg-gray-800/50 rounded-xl pl-4 pr-8 py-3 text-white border border-gray-700/50 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
        </div>
      </div>
    </div>
  )
}
