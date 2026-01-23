'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import StatCard from '@/components/StatCard'
import TraderProfileSkeleton from '@/components/TraderProfileSkeleton'
import DataSourceBadge from '@/components/DataSourceBadge'
import { TraderProfileResponse, TraderFetchError } from '@/lib/types/trader'

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

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const formatMoney = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '$0.00'
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(2)}`
  }

  const formatPercent = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '0.0%'
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
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
          <Link href="/traders" className="text-blue-400 hover:underline py-2">
            Back to Traders
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

  const { metrics, scores, positions } = data

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">
            {data.username || formatAddress(address)}
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
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            {scores && scores.copytradeScore >= 60 && (
              <span className="bg-blue-600 px-3 py-1 rounded-full text-sm">
                Copy Trade
              </span>
            )}
            {scores && scores.botScore >= 60 && (
              <span className="bg-purple-600 px-3 py-1 rounded-full text-sm">
                Likely Bot
              </span>
            )}
            {scores && scores.insiderScore >= 60 && (
              <span className="bg-red-600 px-3 py-1 rounded-full text-sm">
                Insider Suspect
              </span>
            )}
          </div>
          <DataSourceBadge
            source={data.source}
            freshness={data.dataFreshness}
            cachedAt={data.cachedAt}
            onRefresh={() => fetchTrader(true)}
            refreshing={refreshing}
          />
        </div>
      </div>

      {/* Warning banner if data is stale */}
      {data.warning && (
        <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-200 px-4 py-3 rounded mb-6">
          {data.warning}
        </div>
      )}

      {/* Main Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Portfolio Value"
          value={formatMoney(metrics.portfolioValue)}
          color="blue"
        />
        <StatCard
          title="Total PnL"
          value={formatMoney(metrics.totalPnl)}
          color={metrics.totalPnl >= 0 ? 'green' : 'red'}
        />
        <StatCard
          title="Win Rate (30d)"
          value={`${(metrics.winRate30d || 0).toFixed(1)}%`}
          color={metrics.winRate30d >= 60 ? 'green' : 'gray'}
        />
        <StatCard
          title="ROI"
          value={formatPercent(metrics.roiPercent)}
          color={metrics.roiPercent >= 0 ? 'green' : 'red'}
        />
      </div>

      {/* Scores */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Classification Scores</h2>
        {scores ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Copy Trade Score</span>
                <span className="font-bold">{scores.copytradeScore}/100</span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${scores.copytradeScore}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Bot Score</span>
                <span className="font-bold">{scores.botScore}/100</span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500"
                  style={{ width: `${scores.botScore}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-400">Insider Score</span>
                <span className="font-bold">{scores.insiderScore}/100</span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${scores.insiderScore}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">
            Classification scores not available. This trader hasn&apos;t been processed by the analysis pipeline yet.
          </p>
        )}
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* Trading Activity */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Trading Activity</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Trades (30d)</dt>
              <dd>{metrics.tradeCount30d || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Trades (All Time)</dt>
              <dd>{metrics.tradeCountAllTime || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Unique Markets (30d)</dt>
              <dd>{metrics.uniqueMarkets30d || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Trade Frequency</dt>
              <dd>{(metrics.tradeFrequency || 0).toFixed(1)}/day</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Account Age</dt>
              <dd>{metrics.accountAgeDays ? `${metrics.accountAgeDays} days` : 'N/A'}</dd>
            </div>
          </dl>
        </div>

        {/* Performance */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Performance</h3>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Win Rate (All Time)</dt>
              <dd>{(metrics.winRateAllTime || 0).toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Max Drawdown</dt>
              <dd className="text-red-400">{(metrics.maxDrawdown || 0).toFixed(1)}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Realized PnL</dt>
              <dd className={metrics.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {formatMoney(metrics.realizedPnl)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Unrealized PnL</dt>
              <dd className={metrics.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {formatMoney(metrics.unrealizedPnl)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Night Trade Ratio</dt>
              <dd>{(metrics.nightTradeRatio || 0).toFixed(0)}%</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Position Summary */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h3 className="text-lg font-semibold mb-4">Position Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-gray-400 text-sm">Active Positions</p>
            <p className="text-xl font-bold">{metrics.activePositions || 0}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Closed Positions</p>
            <p className="text-xl font-bold">{data.closedPositionsCount || 0}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Avg Position Size</p>
            <p className="text-xl font-bold">{formatMoney(metrics.avgPositionSize)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Position Concentration</p>
            <p className="text-xl font-bold">{(metrics.positionConcentration || 0).toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Current Positions */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Current Positions ({positions.length})</h3>
        {positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-gray-400 text-sm">
                  <th className="text-left pb-3">Market</th>
                  <th className="text-left pb-3">Outcome</th>
                  <th className="text-right pb-3">Size</th>
                  <th className="text-right pb-3">Avg Price</th>
                  <th className="text-right pb-3">Current</th>
                  <th className="text-right pb-3">Value</th>
                  <th className="text-right pb-3">PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => (
                  <tr key={`${pos.conditionId}-${pos.outcomeIndex}-${idx}`} className="border-t border-gray-700">
                    <td className="py-3 max-w-xs">
                      <span className="truncate block" title={pos.title || pos.conditionId}>
                        {pos.title || `${pos.conditionId.slice(0, 10)}...`}
                      </span>
                    </td>
                    <td className="py-3">{pos.outcome || `Outcome ${pos.outcomeIndex}`}</td>
                    <td className="py-3 text-right">{pos.size.toFixed(2)}</td>
                    <td className="py-3 text-right">{(pos.avgPrice * 100).toFixed(1)}c</td>
                    <td className="py-3 text-right">{(pos.currentPrice * 100).toFixed(1)}c</td>
                    <td className="py-3 text-right">{formatMoney(pos.currentValue)}</td>
                    <td className={`py-3 text-right ${pos.cashPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatMoney(pos.cashPnl)} ({pos.percentPnl >= 0 ? '+' : ''}{pos.percentPnl.toFixed(1)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">No current positions</p>
        )}
      </div>
    </div>
  )
}
