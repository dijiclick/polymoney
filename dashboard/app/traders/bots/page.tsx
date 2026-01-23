'use client'

import { useEffect, useState } from 'react'
import { supabase, Trader } from '@/lib/supabase'
import TraderTable from '@/components/TraderTable'
import StatCard from '@/components/StatCard'

export default function BotsPage() {
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
      .gte('bot_score', minScore)
      .order('bot_score', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Error fetching traders:', error)
    }

    setTraders(data || [])
    setLoading(false)
  }

  const avgTradeFreq = traders.length > 0
    ? traders.reduce((sum, t) => sum + (t.trade_frequency || 0), 0) / traders.length
    : 0

  const avgNightRatio = traders.length > 0
    ? traders.reduce((sum, t) => sum + (t.night_trade_ratio || 0), 0) / traders.length
    : 0

  const totalPortfolio = traders.reduce((sum, t) => sum + t.portfolio_value, 0)

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Likely Bots</h1>
      <p className="text-gray-400 mb-8">
        Automated trading systems detected through behavioral patterns.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Bots Found"
          value={traders.length}
          color="purple"
        />
        <StatCard
          title="Avg Trade Frequency"
          value={`${avgTradeFreq.toFixed(1)}/day`}
        />
        <StatCard
          title="Avg Night Trading"
          value={`${avgNightRatio.toFixed(0)}%`}
        />
        <StatCard
          title="Total Portfolio"
          value={`$${(totalPortfolio / 1000).toFixed(0)}K`}
        />
      </div>

      {/* Filter */}
      <div className="flex gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Min Bot Score:</label>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="bg-gray-800 rounded px-3 py-2 w-20 border border-gray-700 focus:border-blue-500 outline-none"
          />
        </div>
      </div>

      {/* Info box */}
      <div className="bg-purple-900/30 border border-purple-500/30 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-purple-400 mb-2">Bot Detection Indicators</h3>
        <ul className="text-sm text-gray-300 space-y-1">
          <li>High trading frequency (10+ trades per day)</li>
          <li>Trades at all hours including night time</li>
          <li>Consistent position sizing with low variance</li>
          <li>Short hold duration (rapid trades)</li>
          <li>Low time variance between trades</li>
        </ul>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          Loading bots...
        </div>
      ) : (
        <TraderTable traders={traders} showScores={true} />
      )}
    </div>
  )
}
