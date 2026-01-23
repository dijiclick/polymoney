'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, Trader } from '@/lib/supabase'
import StatCard from '@/components/StatCard'

interface Position {
  id: number
  market_title: string
  outcome: string
  size: number
  avg_price: number
  current_price: number
  pnl: number
  pnl_percent: number
}

export default function TraderDetailPage() {
  const params = useParams()
  const address = params.address as string

  const [trader, setTrader] = useState<Trader | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (address) {
      fetchTrader()
      fetchPositions()
    }
  }, [address])

  async function fetchTrader() {
    const { data, error } = await supabase
      .from('traders')
      .select('*')
      .eq('address', address)
      .single()

    if (error) {
      console.error('Error fetching trader:', error)
    }

    setTrader(data)
    setLoading(false)
  }

  async function fetchPositions() {
    const { data, error } = await supabase
      .from('trader_positions')
      .select('*')
      .eq('address', address)
      .order('current_value', { ascending: false })

    if (error) {
      console.error('Error fetching positions:', error)
    }

    setPositions(data || [])
  }

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const formatMoney = (value: number) => {
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(2)}`
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-400">
        Loading trader data...
      </div>
    )
  }

  if (!trader) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-red-400 mb-4">Trader Not Found</h2>
        <p className="text-gray-400 mb-4">
          The trader with address {formatAddress(address)} was not found.
        </p>
        <Link href="/traders" className="text-blue-400 hover:underline">
          Back to Traders
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">
            {trader.username || formatAddress(address)}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-400 font-mono text-sm">{address}</span>
            <a
              href={`https://polymarket.com/profile/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline text-sm"
            >
              View on Polymarket
            </a>
          </div>
        </div>
        <div className="flex gap-2">
          {trader.copytrade_score >= 60 && (
            <span className="bg-blue-600 px-3 py-1 rounded-full text-sm">
              Copy Trade
            </span>
          )}
          {trader.bot_score >= 60 && (
            <span className="bg-purple-600 px-3 py-1 rounded-full text-sm">
              Likely Bot
            </span>
          )}
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Portfolio Value"
          value={formatMoney(trader.portfolio_value)}
          color="blue"
        />
        <StatCard
          title="Total PnL"
          value={formatMoney(trader.total_pnl)}
          color={trader.total_pnl >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Win Rate (30d)"
          value={`${trader.win_rate_30d.toFixed(1)}%`}
          color={trader.win_rate_30d >= 60 ? 'green' : 'gray'}
        />
        <StatCard
          title="ROI"
          value={`${trader.roi_percent >= 0 ? '+' : ''}${trader.roi_percent.toFixed(1)}%`}
          color={trader.roi_percent >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Scores */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Classification Scores</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-400">Copy Trade Score</span>
              <span className="font-bold">{trader.copytrade_score}/100</span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${trader.copytrade_score}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-400">Bot Score</span>
              <span className="font-bold">{trader.bot_score}/100</span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500"
                style={{ width: `${trader.bot_score}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* Trading Activity */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Trading Activity</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Trades (30d)</dt>
              <dd>{trader.trade_count_30d}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Trades (All Time)</dt>
              <dd>{trader.trade_count_alltime}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Unique Markets (30d)</dt>
              <dd>{trader.unique_markets_30d}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Trade Frequency</dt>
              <dd>{trader.trade_frequency?.toFixed(1) || 'N/A'}/day</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Account Age</dt>
              <dd>{trader.account_age_days} days</dd>
            </div>
          </dl>
        </div>

        {/* Performance */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Performance</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Win Rate (All Time)</dt>
              <dd>{trader.win_rate_alltime.toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Max Drawdown</dt>
              <dd className="text-red-400">{trader.max_drawdown.toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Realized PnL</dt>
              <dd className={trader.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {formatMoney(trader.total_pnl)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Night Trade Ratio</dt>
              <dd>{trader.night_trade_ratio?.toFixed(0) || 'N/A'}%</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Current Positions */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Current Positions ({positions.length})</h3>
        {positions.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="text-gray-400 text-sm">
                <th className="text-left pb-3">Market</th>
                <th className="text-left pb-3">Outcome</th>
                <th className="text-right pb-3">Size</th>
                <th className="text-right pb-3">Avg Price</th>
                <th className="text-right pb-3">Current</th>
                <th className="text-right pb-3">PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.id} className="border-t border-gray-700">
                  <td className="py-3 max-w-xs truncate">{pos.market_title}</td>
                  <td className="py-3">{pos.outcome}</td>
                  <td className="py-3 text-right">{pos.size?.toFixed(2)}</td>
                  <td className="py-3 text-right">{(pos.avg_price * 100).toFixed(0)}c</td>
                  <td className="py-3 text-right">{(pos.current_price * 100).toFixed(0)}c</td>
                  <td className={`py-3 text-right ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatMoney(pos.pnl)} ({pos.pnl_percent >= 0 ? '+' : ''}{pos.pnl_percent?.toFixed(1)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-gray-500 text-center py-4">No current positions</p>
        )}
      </div>
    </div>
  )
}
