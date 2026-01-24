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
  const [activeTab, setActiveTab] = useState<'positions' | 'trades'>('positions')

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

  const formatMoney = (value: number | undefined | null, showSign = false) => {
    if (value === undefined || value === null) return '$0'
    const absVal = Math.abs(value)
    const sign = showSign ? (value >= 0 ? '+' : '-') : (value < 0 ? '-' : '')
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

  const formatAccountAge = (createdAt?: string) => {
    if (!createdAt) return null
    const created = new Date(createdAt)
    const now = new Date()
    const diffMs = now.getTime() - created.getTime()
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (days < 30) return `${days} days`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
    const years = Math.floor(months / 12)
    const remainingMonths = months % 12
    if (remainingMonths === 0) return `${years} year${years !== 1 ? 's' : ''}`
    return `${years}y ${remainingMonths}m`
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) {
    return <TraderProfileSkeleton />
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-900/30 mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-red-400 mb-2">
          {error.code === 'NOT_FOUND' ? 'Trader Not Found' : 'Error Loading Trader'}
        </h2>
        <p className="text-gray-400 mb-2">{error.error}</p>
        {error.details && (
          <p className="text-gray-500 text-sm mb-6">{error.details}</p>
        )}
        <div className="flex justify-center gap-4">
          <button
            onClick={() => fetchTrader(true)}
            className="bg-blue-600 hover:bg-blue-700 px-6 py-2.5 rounded-lg text-white font-medium transition-colors"
          >
            Try Again
          </button>
          <Link href="/wallets" className="text-gray-400 hover:text-white px-6 py-2.5 transition-colors">
            Back to Wallets
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
  const pnlColor = (val: number) => val >= 0 ? 'text-green-400' : 'text-red-400'
  const pnlBg = (val: number) => val >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'

  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-800/50 rounded-2xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold">
              {(data.username || address)[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {data.username || formatAddress(address)}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm text-gray-400 bg-gray-700/50 px-2 py-0.5 rounded font-mono">
                  {formatAddress(address)}
                </code>
                <button
                  onClick={() => copyToClipboard(address)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy address"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <a
                  href={`https://polymarket.com/profile/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                  title="View on Polymarket"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              {data.accountCreatedAt && (
                <div className="text-sm text-gray-500 mt-1">
                  Trading for {formatAccountAge(data.accountCreatedAt)}
                </div>
              )}
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
      </div>

      {/* Warning banner */}
      {data.warning && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm">{data.warning}</span>
        </div>
      )}

      {/* Key Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* Portfolio Value */}
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Portfolio</div>
          <div className="text-2xl font-bold text-white">
            {formatMoney(metrics.portfolioValue)}
          </div>
        </div>

        {/* Overall PnL */}
        <div className={`rounded-xl p-4 ${pnlBg(metrics.totalPnl)}`}>
          <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Total PnL</div>
          <div className={`text-2xl font-bold ${pnlColor(metrics.totalPnl)}`}>
            {formatMoney(metrics.totalPnl, true)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            <span className={pnlColor(metrics.realizedPnl || 0)}>
              {formatMoney(metrics.realizedPnl, true)} realized
            </span>
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-gray-800 rounded-xl p-4">
          <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Win Rate</div>
          <div className="text-2xl font-bold text-white">
            {metrics.winRateAllTime?.toFixed(1) || 0}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {metrics.totalPositions || 0} closed positions
          </div>
        </div>

        {/* ROI */}
        <div className={`rounded-xl p-4 ${pnlBg(metrics.roiPercent || 0)}`}>
          <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Overall ROI</div>
          <div className={`text-2xl font-bold ${pnlColor(metrics.roiPercent || 0)}`}>
            {formatPercent(metrics.roiPercent)}
          </div>
        </div>
      </div>

      {/* Performance Comparison - 7d vs 30d */}
      <div className="bg-gray-800 rounded-xl mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Performance</h2>
          {data.goldskyEnhanced && (
            <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              On-chain data
            </span>
          )}
        </div>
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-700">
          {/* 7 Day Performance */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-400">Last 7 Days</span>
              <span className={`text-lg font-bold ${pnlColor(metrics.metrics7d?.pnl || 0)}`}>
                {formatMoney(metrics.metrics7d?.pnl, true)}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">ROI</span>
                <span className={`font-mono text-sm ${pnlColor(metrics.metrics7d?.roi || 0)}`}>
                  {formatPercent(metrics.metrics7d?.roi)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Win Rate</span>
                <div className="text-right">
                  <span className="font-mono text-sm text-gray-300">
                    {metrics.metrics7d?.winRate?.toFixed(1) || 0}%
                  </span>
                  {metrics.metrics7d?.positionsResolved !== undefined && (
                    <span className="text-xs text-gray-500 ml-1">
                      ({metrics.metrics7d.positionsResolved} resolved)
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Volume</span>
                <span className="font-mono text-sm text-gray-300">
                  {formatMoney(metrics.metrics7d?.volume)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Trades</span>
                <span className="font-mono text-sm text-gray-300">
                  {metrics.metrics7d?.tradeCount || 0}
                </span>
              </div>
            </div>
          </div>

          {/* 30 Day Performance */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-400">Last 30 Days</span>
              <span className={`text-lg font-bold ${pnlColor(metrics.metrics30d?.pnl || 0)}`}>
                {formatMoney(metrics.metrics30d?.pnl, true)}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">ROI</span>
                <span className={`font-mono text-sm ${pnlColor(metrics.metrics30d?.roi || 0)}`}>
                  {formatPercent(metrics.metrics30d?.roi)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Win Rate</span>
                <div className="text-right">
                  <span className="font-mono text-sm text-gray-300">
                    {metrics.metrics30d?.winRate?.toFixed(1) || 0}%
                  </span>
                  {metrics.metrics30d?.positionsResolved !== undefined && (
                    <span className="text-xs text-gray-500 ml-1">
                      ({metrics.metrics30d.positionsResolved} resolved)
                    </span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Volume</span>
                <span className="font-mono text-sm text-gray-300">
                  {formatMoney(metrics.metrics30d?.volume)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Trades</span>
                <span className="font-mono text-sm text-gray-300">
                  {metrics.metrics30d?.tradeCount || 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{metrics.activePositions || 0}</div>
          <div className="text-xs text-gray-500">Active Positions</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{metrics.totalPositions || 0}</div>
          <div className="text-xs text-gray-500">Closed Positions</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-green-400">{Math.round((metrics.totalPositions || 0) * (metrics.winRateAllTime || 0) / 100)}</div>
          <div className="text-xs text-gray-500">Wins</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-red-400">{(metrics.totalPositions || 0) - Math.round((metrics.totalPositions || 0) * (metrics.winRateAllTime || 0) / 100)}</div>
          <div className="text-xs text-gray-500">Losses</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-white">{metrics.tradeCountAllTime || 0}</div>
          <div className="text-xs text-gray-500">Total Trades</div>
        </div>
      </div>

      {/* Tabs for Positions/Trades */}
      <div className="bg-gray-800 rounded-xl overflow-hidden">
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('positions')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'positions'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-400/5'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Positions ({positions.length})
          </button>
          <button
            onClick={() => setActiveTab('trades')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'trades'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-400/5'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Recent Trades ({trades?.length || 0})
          </button>
        </div>

        {/* Positions Tab */}
        {activeTab === 'positions' && (
          <div>
            {positions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-3 px-4 font-medium">Market</th>
                      <th className="text-left py-3 px-4 font-medium">Position</th>
                      <th className="text-right py-3 px-4 font-medium">Entry</th>
                      <th className="text-right py-3 px-4 font-medium">Current</th>
                      <th className="text-right py-3 px-4 font-medium">Value</th>
                      <th className="text-right py-3 px-4 font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {positions.map((pos, idx) => (
                      <tr key={`${pos.conditionId}-${idx}`} className="hover:bg-gray-700/20 transition-colors">
                        <td className="py-3 px-4">
                          <div className="text-sm text-gray-200 truncate max-w-[200px]" title={pos.title || pos.conditionId}>
                            {pos.title || `${pos.conditionId.slice(0, 12)}...`}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                              pos.outcome?.toLowerCase() === 'yes'
                                ? 'bg-green-500/20 text-green-400'
                                : pos.outcome?.toLowerCase() === 'no'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-gray-500/20 text-gray-400'
                            }`}>
                              {pos.outcome || `#${pos.outcomeIndex}`}
                            </span>
                            <span className="text-sm text-gray-500">
                              {pos.size.toFixed(1)} shares
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-mono text-gray-400">
                            {(pos.avgPrice * 100).toFixed(1)}¢
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-mono text-gray-300">
                            {(pos.currentPrice * 100).toFixed(1)}¢
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-mono text-gray-200">
                            {formatMoney(pos.currentValue)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className={`text-sm font-mono ${pnlColor(pos.cashPnl)}`}>
                            {formatMoney(pos.cashPnl, true)}
                          </div>
                          <div className={`text-xs ${pnlColor(pos.percentPnl)}`}>
                            {formatPercent(pos.percentPnl)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center">
                <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="text-gray-500">No active positions</p>
              </div>
            )}
          </div>
        )}

        {/* Trades Tab */}
        {activeTab === 'trades' && (
          <div>
            {trades && trades.length > 0 ? (
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-800">
                    <tr className="text-xs text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-3 px-4 font-medium">Time</th>
                      <th className="text-left py-3 px-4 font-medium">Action</th>
                      <th className="text-left py-3 px-4 font-medium">Market</th>
                      <th className="text-right py-3 px-4 font-medium">Price</th>
                      <th className="text-right py-3 px-4 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/30">
                    {trades.map((trade: ParsedTrade, idx: number) => (
                      <tr key={trade.txHash || idx} className="hover:bg-gray-700/20 transition-colors">
                        <td className="py-3 px-4">
                          <span className="text-sm text-gray-400">
                            {formatTradeTime(trade.timestamp)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs font-bold px-2 py-1 rounded ${
                            trade.side === 'BUY'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}>
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-sm text-gray-200 truncate max-w-[250px]" title={trade.market}>
                            {trade.market}
                          </div>
                          {trade.outcome && (
                            <div className="text-xs text-gray-500">{trade.outcome}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-mono text-gray-400">
                            {(trade.price * 100).toFixed(1)}¢
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-mono text-gray-200">
                            {formatMoney(trade.usdValue)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center">
                <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-gray-500">No recent trades available</p>
                <p className="text-xs text-gray-600 mt-1">Refresh to fetch live trade data</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
