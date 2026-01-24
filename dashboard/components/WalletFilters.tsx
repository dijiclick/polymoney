'use client'

import { WalletFilter, WalletSource } from '@/lib/supabase'

interface Props {
  filter: WalletFilter
  onChange: (filter: WalletFilter) => void
}

export default function WalletFilters({ filter, onChange }: Props) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Source Filter */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Source</label>
          <select
            value={filter.source || 'all'}
            onChange={(e) => onChange({ ...filter, source: e.target.value as WalletSource | 'all' })}
            className="w-full bg-gray-700 rounded px-3 py-2 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Sources</option>
            <option value="goldsky">Goldsky</option>
            <option value="live">Live Discovery</option>
          </select>
        </div>

        {/* Min Portfolio Value */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Min Portfolio ($)</label>
          <input
            type="number"
            value={filter.minBalance ?? ''}
            onChange={(e) => onChange({ ...filter, minBalance: e.target.value === '' ? 0 : parseInt(e.target.value) })}
            placeholder="0"
            min={0}
            step={100}
            className="w-full bg-gray-700 rounded px-3 py-2 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {/* Min Win Rate */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Min Win Rate (%)</label>
          <input
            type="number"
            value={filter.minWinRate ?? ''}
            onChange={(e) => onChange({ ...filter, minWinRate: e.target.value === '' ? 0 : parseInt(e.target.value) })}
            placeholder="0"
            min={0}
            max={100}
            step={5}
            className="w-full bg-gray-700 rounded px-3 py-2 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}
