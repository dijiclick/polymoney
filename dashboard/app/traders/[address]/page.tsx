'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import TraderProfileSkeleton from '@/components/TraderProfileSkeleton'
import DataSourceBadge from '@/components/DataSourceBadge'
import { TraderProfileResponse, TraderFetchError, ParsedTrade } from '@/lib/types/trader'

export default function TraderDetailPage() {
  const params = useParams()
  const address = params.address as string

  const [data, setData] = useState<TraderProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<TraderFetchError | null>(null)

  async function fetchTrader(forceRefresh = false) {
    if (forceRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const url = `/api/traders/${address}${forceRefresh ? '?refresh=true' : ''}`
      const response = await fetch(url)

      if (!response.ok) {
        const err = await response.json()
        throw err
      }

      const traderData: TraderProfileResponse = await response.json()
      setData(traderData)
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        setError(err as TraderFetchError)
      } else {
        setError({
          error: 'Failed to fetch trader data',
          code: 'API_ERROR',
          details: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (address) {
      fetchTrader()
    }
  }, [address])

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const formatMoney = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '$0'
    const absVal = Math.abs(value)
    const sign = value >= 0 ? '' : '-'
    if (absVal >= 1000000) return `${sign}$${(absVal / 1000000).toFixed(2)}M`
    if (absVal >= 1000) return `${sign}$${(absVal / 1000).toFixed(1)}K`
    return `${sign}$${absVal.toFixed(2)}`
  }

  const formatPercent = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '0%'
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
  }

  const formatTradeTime = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp * 1000
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  if (loading) {
    return <TraderProfileSkeleton />
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-red-400 mb-4">
          {error.code === 'NOT_FOUND' ? 'Trader Not Found' : 'Error Loading Trader'}
        </h2>
        <p className="text-gray-400 mb-2">{error.error}</p>
        {error.details && (
          <p className="text-gray-500 text-sm mb-4">{error.details}</p>
        )}
        <div className="flex justify-center gap-4">
          <button
            onClick={() => fetchTrader(true)}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white"
          >
            Try Again
          </button>
          <Link href="/live" className="text-blue-400 hover:underline py-2">
            Back to Live Feed
          </Link>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-400">
        No data available
      </div>
    )
  }

  const { metrics, positions, trades } = data

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">
            {data.username || formatAddress(address)}
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500 font-mono">{address}</span>
            <a
              href={`https://polymarket.com/profile/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              View on Polymarket
            </a>
          </div>
        </div>
        <DataSourceBadge
          source={data.source}
          freshness={data.dataFreshness}
          cachedAt={data.cachedAt}
          onRefresh={() => fetchTrader(true)}
          refreshing={refreshing}
        />
      </div>

      {/* Warning banner */}
      {data.warning && (
        <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-200 px-4 py-2 rounded mb-6 text-sm">
          {data.warning}
        </div>
      )}

      {/* Portfolio Value */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <div className="text-gray-400 text-sm mb-1">Portfolio Value</div>
        <div className="text-3xl font-bold text-blue-400">
          {formatMoney(metrics.portfolioValue)}
        </div>
      </div>

      {/* Metrics Table - 7d vs 30d */}
      <div className="bg-gray-800 rounded-lg overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left py-3 px-4 text-gray-400 font-medium">Metric</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">7 Days</th>
              <th className="text-right py-3 px-4 text-gray-400 font-medium">30 Days</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-700/50">
              <td className="py-3 px-4 text-gray-300">PnL</td>
              <td className={`py-3 px-4 text-right font-mono ${metrics.metrics7d.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatMoney(metrics.metrics7d.pnl)}
              </td>
              <td className={`py-3 px-4 text-right font-mono ${metrics.metrics30d.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatMoney(metrics.metrics30d.pnl)}
              </td>
            </tr>
            <tr className="border-b border-gray-700/50">
              <td className="py-3 px-4 text-gray-300">ROI</td>
              <td className={`py-3 px-4 text-right font-mono ${metrics.metrics7d.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPercent(metrics.metrics7d.roi)}
              </td>
              <td className={`py-3 px-4 text-right font-mono ${metrics.metrics30d.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPercent(metrics.metrics30d.roi)}
              </td>
            </tr>
            <tr className="border-b border-gray-700/50">
              <td className="py-3 px-4 text-gray-300">Volume</td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {formatMoney(metrics.metrics7d.volume)}
              </td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {formatMoney(metrics.metrics30d.volume)}
              </td>
            </tr>
            <tr className="border-b border-gray-700/50">
              <td className="py-3 px-4 text-gray-300">Drawdown</td>
              <td className="py-3 px-4 text-right font-mono text-red-400">
                -{metrics.metrics7d.drawdown.toFixed(1)}%
              </td>
              <td className="py-3 px-4 text-right font-mono text-red-400">
                -{metrics.metrics30d.drawdown.toFixed(1)}%
              </td>
            </tr>
            <tr className="border-b border-gray-700/50">
              <td className="py-3 px-4 text-gray-300">Trades</td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {metrics.metrics7d.tradeCount}
              </td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {metrics.metrics30d.tradeCount}
              </td>
            </tr>
            <tr>
              <td className="py-3 px-4 text-gray-300">Win Rate</td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {metrics.metrics7d.winRate.toFixed(1)}%
              </td>
              <td className="py-3 px-4 text-right font-mono text-gray-300">
                {metrics.metrics30d.winRate.toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Trade Activity */}
      <div className="bg-gray-800 rounded-lg mb-6">
        <div className="p-4 border-b border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Recent Trades</h2>
            {metrics.avgTradeIntervalHours > 0 && (
              <span className="text-sm text-gray-400">
                Avg interval: {metrics.avgTradeIntervalHours < 1
                  ? `${Math.round(metrics.avgTradeIntervalHours * 60)}m`
                  : `${metrics.avgTradeIntervalHours.toFixed(1)}h`}
              </span>
            )}
          </div>
        </div>

        {trades && trades.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-800">
                <tr className="text-xs text-gray-500">
                  <th className="text-left py-2 px-4">Time</th>
                  <th className="text-left py-2 px-4">Side</th>
                  <th className="text-left py-2 px-4">Market</th>
                  <th className="text-right py-2 px-4">Price</th>
                  <th className="text-right py-2 px-4">Value</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade: ParsedTrade, idx: number) => (
                  <tr key={trade.txHash || idx} className="border-t border-gray-700/30 hover:bg-gray-750">
                    <td className="py-2 px-4 text-sm text-gray-400">
                      {formatTradeTime(trade.timestamp)}
                    </td>
                    <td className="py-2 px-4">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        trade.side === 'BUY' ? 'bg-green-600/80' : 'bg-red-600/80'
                      }`}>
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-sm text-gray-300 truncate max-w-[200px]" title={trade.market}>
                      {trade.market}
                      {trade.outcome && (
                        <span className="text-gray-500 ml-1">({trade.outcome})</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right text-sm text-gray-400">
                      {(trade.price * 100).toFixed(0)}¢
                    </td>
                    <td className="py-2 px-4 text-right text-sm font-mono text-gray-300">
                      {formatMoney(trade.usdValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No recent trades available
          </div>
        )}
      </div>

      {/* Current Positions */}
      <div className="bg-gray-800 rounded-lg">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold">
            Current Positions ({positions.length})
          </h2>
        </div>

        {positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="text-left py-2 px-4">Market</th>
                  <th className="text-left py-2 px-4">Outcome</th>
                  <th className="text-right py-2 px-4">Size</th>
                  <th className="text-right py-2 px-4">Entry</th>
                  <th className="text-right py-2 px-4">Now</th>
                  <th className="text-right py-2 px-4">Value</th>
                  <th className="text-right py-2 px-4">PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => (
                  <tr key={`${pos.conditionId}-${idx}`} className="border-t border-gray-700/30 hover:bg-gray-750">
                    <td className="py-3 px-4 text-sm text-gray-300 truncate max-w-[180px]" title={pos.title || pos.conditionId}>
                      {pos.title || `${pos.conditionId.slice(0, 12)}...`}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {pos.outcome || `#${pos.outcomeIndex}`}
                    </td>
                    <td className="py-3 px-4 text-right text-sm font-mono text-gray-300">
                      {pos.size.toFixed(1)}
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-gray-400">
                      {(pos.avgPrice * 100).toFixed(0)}¢
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-gray-400">
                      {(pos.currentPrice * 100).toFixed(0)}¢
                    </td>
                    <td className="py-3 px-4 text-right text-sm font-mono text-gray-300">
                      {formatMoney(pos.currentValue)}
                    </td>
                    <td className={`py-3 px-4 text-right text-sm font-mono ${pos.cashPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatMoney(pos.cashPnl)}
                      <span className="text-gray-500 text-xs ml-1">
                        ({pos.percentPnl >= 0 ? '+' : ''}{pos.percentPnl.toFixed(0)}%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No active positions
          </div>
        )}
      </div>
    </div>
  )
}
