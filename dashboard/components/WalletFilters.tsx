'use client'

import { WalletFilter, WalletSource } from '@/lib/supabase'

interface Props {
  filter: WalletFilter
  onChange: (filter: WalletFilter) => void
}

const categories = [
  'All Categories',
  'OVERALL',
  'POLITICS',
  'SPORTS',
  'CRYPTO',
  'CULTURE',
  'MENTIONS',
  'WEATHER',
  'ECONOMICS',
  'TECH',
  'FINANCE'
]

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
            <option value="goldsky">Goldsky Only</option>
            <option value="leaderboard">Leaderboard Only</option>
            <option value="both">Both Sources</option>
          </select>
        </div>

        {/* Category Filter */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Category</label>
          <select
            value={filter.category || ''}
            onChange={(e) => onChange({ ...filter, category: e.target.value || undefined })}
            className="w-full bg-gray-700 rounded px-3 py-2 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat === 'All Categories' ? '' : cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Min Balance */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Min Balance ($)</label>
          <input
            type="number"
            value={filter.minBalance || 200}
            onChange={(e) => onChange({ ...filter, minBalance: parseInt(e.target.value) || 0 })}
            min={0}
            step={100}
            className="w-full bg-gray-700 rounded px-3 py-2 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}
