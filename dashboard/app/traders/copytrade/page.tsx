'use client'

import { useEffect, useState } from 'react'
import { supabase, Trader } from '@/lib/supabase'
import TraderTable from '@/components/TraderTable'
import StatCard from '@/components/StatCard'

export default function CopyTradePage() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const [minScore, setMinScore] = useState(60)

  useEffect(() => {
    fetchTraders()
  }, [minScore])

  async function fetchTraders() {
    setLoading(true)

    const { data, error } = await supabase
      .from('traders')
      .select('*')
      .is('eliminated_at_step', null)
      .gte('copytrade_score', minScore)
      .order('copytrade_score', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching traders:', error)
    }

    setTraders(data || [])
    setLoading(false)
  }

  const avgWinRate = traders.length > 0
    ? traders.reduce((sum, t) => sum + t.win_rate_30d, 0) / traders.length
    : 0

  const avgROI = traders.length > 0
    ? traders.reduce((sum, t) => sum + t.roi_percent, 0) / traders.length
    : 0

  const totalPortfolio = traders.reduce((sum, t) => sum + t.portfolio_value, 0)

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Copy Trade Candidates</h1>
      <p className="text-gray-400 mb-8">
        Skilled human traders with consistent performance worth copying.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Found"
          value={traders.length}
          color="blue"
        />
        <StatCard
          title="Avg Win Rate"
          value={`${avgWinRate.toFixed(1)}%`}
          color="green"
        />
        <StatCard
          title="Avg ROI"
          value={`${avgROI >= 0 ? '+' : ''}${avgROI.toFixed(1)}%`}
          color={avgROI >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Total Portfolio"
          value={`$${(totalPortfolio / 1000).toFixed(0)}K`}
        />
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Min Copy Score:</label>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="bg-gray-800 rounded px-3 py-2 w-20 border border-gray-700 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-blue-400 mb-2">What makes a good copy trade candidate?</h3>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>Win rate above 60% in the last 30 days</li>
          <li>Account age of at least 60 days</li>
          <li>Diversified across 5+ unique markets</li>
          <li>Maximum drawdown under 30%</li>
          <li>Consistent trading frequency (not too sporadic)</li>
        </ul>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          Loading copy trade candidates...
        </div>
      ) : (
        <TraderTable traders={traders} showScores={true} />
      )}
    </div>
  )
}
