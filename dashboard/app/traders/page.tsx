'use client'

import { useEffect, useState } from 'react'
import { supabase, Trader } from '@/lib/supabase'
import TraderTable from '@/components/TraderTable'

export default function TradersPage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('copytrade_score')
  const [minBalance, setMinBalance] = useState(200)
  const [minWinRate, setMinWinRate] = useState(50)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTraders()
  }, [filter, sortBy, minBalance, minWinRate])

  async function fetchTraders() {
    setLoading(true)

    let query = supabase
      .from('traders')
      .select('*')
      .is('eliminated_at_step', null)
      .gte('portfolio_value', minBalance)
      .gte('win_rate_30d', minWinRate)
      .order(sortBy, { ascending: false })
      .limit(100)

    if (filter !== 'all') {
      query = query.eq('primary_classification', filter)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching traders:', error)
    }

    setTraders(data || [])
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">All Qualified Traders</h1>

      {/* Filters */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-gray-800 rounded px-4 py-2 border border-gray-700 focus:border-blue-500 outline-none"
        >
          <option value="all">All Profiles</option>
          <option value="copytrade">Copy Trade</option>
          <option value="bot">Bots</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="bg-gray-800 rounded px-4 py-2 border border-gray-700 focus:border-blue-500 outline-none"
        >
          <option value="copytrade_score">Copy Trade Score</option>
          <option value="bot_score">Bot Score</option>
          <option value="portfolio_value">Portfolio Value</option>
          <option value="win_rate_30d">Win Rate</option>
          <option value="roi_percent">ROI</option>
          <option value="total_pnl">Total PnL</option>
        </select>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Min Balance:</label>
          <input
            type="number"
            value={minBalance}
            onChange={(e) => setMinBalance(Number(e.target.value))}
            className="bg-gray-800 rounded px-3 py-2 w-24 border border-gray-700 focus:border-blue-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Min Win Rate:</label>
          <input
            type="number"
            value={minWinRate}
            onChange={(e) => setMinWinRate(Number(e.target.value))}
            className="bg-gray-800 rounded px-3 py-2 w-20 border border-gray-700 focus:border-blue-500 outline-none"
          />
          <span className="text-gray-400">%</span>
        </div>
      </div>

      {/* Results count */}
      <div className="text-gray-400 text-sm mb-4">
        Showing {traders.length} traders
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          Loading traders...
        </div>
      ) : (
        <TraderTable traders={traders} />
      )}
    </div>
  )
}
