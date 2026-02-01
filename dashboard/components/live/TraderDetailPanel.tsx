'use client'

import { useState, useEffect, useCallback } from 'react'
import { LiveTrade } from '@/lib/supabase'
import PnlChart, { ClosedPosition } from './PnlChart'

interface Position {
  conditionId: string
  title: string
  outcome: string
  size: number
  avgPrice: number
  currentPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
}

interface TraderData {
  address: string
  username?: string
  positions: Position[]
  closedPositions?: ClosedPosition[]
  closedPositionsCount: number
  metrics?: any
  copyScore?: number
  copyMetrics?: {
    profitFactor30d: number
    profitFactorAll: number
    diffWinRate30d: number
    diffWinRateAll: number
    weeklyProfitRate: number
    avgTradesPerDay: number
    medianProfitPct: number | null
    edgeTrend: number
    calmarRatio: number
  }
}

interface TraderDetailPanelProps {
  address: string
  trades: LiveTrade[]
  onClose: () => void
}

function formatMoney(value: number) {
  if (value === undefined || value === null) return '-'
  const absValue = Math.abs(value)
  if (absValue >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
  if (absValue >= 1000) return `$${(value / 1000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

function formatPercent(value: number) {
  if (value === undefined || value === null) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatUsd(value: number) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

export default function TraderDetailPanel({ address, trades, onClose }: TraderDetailPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TraderData | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'feed'>('feed')
  const [copied, setCopied] = useState(false)

  const fetchTraderData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Use cached data to match table score (no recalculation)
      const res = await fetch(`/api/traders/${address}?refresh=false&lite=true`)
      if (!res.ok) throw new Error('Failed to fetch')
      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [address])

  // Fetch data only once when modal opens - NO auto-refresh
  useEffect(() => {
    fetchTraderData()
  }, [fetchTraderData])

  const copyAddress = () => {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const traderTrades = trades.filter(t => t.trader_address.toLowerCase() === address.toLowerCase()).slice(0, 15)
  const displayName = data?.username && !data.username.startsWith('0x')
    ? data.username
    : formatAddress(address)

  const getPnlColor = (v: number) => v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-500'

  return (
    <div className="glass rounded-xl h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-medium text-[10px]">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-white truncate">{displayName}</h3>
            <div className="flex items-center gap-1.5">
              <button onClick={copyAddress} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
                {copied ? 'Copied!' : formatAddress(address)}
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <span className="text-gray-700">|</span>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-0.5 transition-colors"
              >
                Polymarket
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 md:p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative w-6 h-6">
              <div className="absolute inset-0 rounded-full border border-white/10"></div>
              <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
            </div>
            <p className="text-gray-600 mt-3 text-xs">Loading...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-red-400 text-xs mb-2">{error}</p>
            <button onClick={fetchTraderData} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs text-white transition-colors">
              Retry
            </button>
          </div>
        ) : data ? (
          <>
            {/* Copy Score Banner */}
            {(() => {
              const score = Math.round(data.copyScore || 0)
              let scoreBg: string, scoreText: string, scoreLabel: string
              if (score >= 80) {
                scoreBg = 'from-amber-500/20 to-amber-600/10 border-amber-500/30'
                scoreText = 'text-amber-300'
                scoreLabel = 'Excellent'
              } else if (score >= 60) {
                scoreBg = 'from-emerald-500/15 to-emerald-600/10 border-emerald-500/25'
                scoreText = 'text-emerald-400'
                scoreLabel = 'Good'
              } else if (score >= 40) {
                scoreBg = 'from-blue-500/10 to-blue-600/5 border-blue-500/20'
                scoreText = 'text-blue-400'
                scoreLabel = 'Average'
              } else {
                scoreBg = 'from-white/[0.04] to-white/[0.02] border-white/[0.06]'
                scoreText = 'text-gray-500'
                scoreLabel = 'Low'
              }
              return (
                <div className={`mx-3 mt-3 mb-1 px-4 py-3 rounded-lg bg-gradient-to-r ${scoreBg} border`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[9px] text-gray-500 uppercase tracking-wider">Copy Score</p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className={`text-2xl font-extrabold tabular-nums ${scoreText}`}>{score}</span>
                        <span className={`text-xs font-medium ${scoreText} opacity-70`}>{scoreLabel}</span>
                      </div>
                    </div>
                    <div className="text-right space-y-0.5">
                      {data.copyMetrics && (
                        <>
                          <p className="text-[9px] text-gray-500">
                            PF <span className="text-gray-400 font-medium">{data.copyMetrics.profitFactor30d.toFixed(1)}</span>
                            {' / '}
                            Calmar <span className="text-gray-400 font-medium">{data.copyMetrics.calmarRatio.toFixed(1)}</span>
                          </p>
                          <p className="text-[9px] text-gray-500">
                            Weekly <span className="text-gray-400 font-medium">{data.copyMetrics.weeklyProfitRate.toFixed(0)}%</span>
                            {' / '}
                            Edge <span className={`font-medium ${data.copyMetrics.edgeTrend >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {data.copyMetrics.edgeTrend.toFixed(2)}x
                            </span>
                          </p>
                          <p className="text-[9px] text-gray-500">
                            Diff WR <span className="text-gray-400 font-medium">{data.copyMetrics.diffWinRate30d.toFixed(1)}%</span>
                            {' / '}
                            <span className="text-gray-400 font-medium">{data.copyMetrics.avgTradesPerDay.toFixed(1)}</span>/d
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-px bg-white/5 border-b border-white/5">
              <div className="bg-[var(--background)] px-4 py-3">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider">Portfolio</p>
                <p className="text-sm font-semibold text-white tabular-nums mt-0.5">
                  {formatMoney(data.metrics?.portfolioValue || 0)}
                </p>
              </div>
              <div className="bg-[var(--background)] px-4 py-3">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider">Total PnL</p>
                <p className={`text-sm font-semibold tabular-nums mt-0.5 ${getPnlColor(data.metrics?.totalPnl || 0)}`}>
                  {formatMoney(data.metrics?.totalPnl || 0)}
                </p>
              </div>
              <div className="bg-[var(--background)] px-4 py-3">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider">Win Rate</p>
                <p className={`text-sm font-semibold tabular-nums mt-0.5 ${
                  (data.metrics?.winRateAllTime || 0) >= 60 ? 'text-emerald-400' :
                  (data.metrics?.winRateAllTime || 0) >= 50 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {data.metrics?.winRateAllTime ? `${data.metrics.winRateAllTime.toFixed(1)}%` : '-'}
                </p>
              </div>
              <div className="bg-[var(--background)] px-4 py-3">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider">ROI</p>
                <p className={`text-sm font-semibold tabular-nums mt-0.5 ${getPnlColor(data.metrics?.roiPercent || 0)}`}>
                  {data.metrics?.roiPercent ? formatPercent(data.metrics.roiPercent) : '-'}
                </p>
              </div>
            </div>

            {/* PnL Chart */}
            <PnlChart closedPositions={data.closedPositions || []} />

            <div className="border-t border-white/5" />

            {/* Tabs */}
            <div className="flex gap-1 px-4 pt-2 pb-2 border-b border-white/5">
              <button
                onClick={() => setActiveTab('feed')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  activeTab === 'feed' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Feed ({traderTrades.length})
              </button>
              <button
                onClick={() => setActiveTab('open')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  activeTab === 'open' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Open ({data.positions?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('closed')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  activeTab === 'closed' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Closed ({data.closedPositions?.length || data.closedPositionsCount || 0})
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-4">
              {/* Feed tab - recent trades from live feed */}
              {activeTab === 'feed' && (
                <div className="space-y-1">
                  {traderTrades.length > 0 ? (
                    traderTrades.map((trade, i) => (
                      <div key={trade.id || i} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-white/[0.02]">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          trade.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}>
                          {trade.side}
                        </span>
                        <span className="text-[11px] text-gray-400 truncate flex-1">
                          {trade.outcome} · {trade.market_slug}
                        </span>
                        <span className="text-[11px] text-gray-300 tabular-nums">{formatUsd(trade.usd_value)}</span>
                        <span className="text-[10px] text-gray-600 tabular-nums">{formatTime(trade.executed_at)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-gray-600 py-4">No trades from this trader in current feed</p>
                  )}
                </div>
              )}

              {/* Open positions tab */}
              {activeTab === 'open' && (
                <div className="space-y-1.5">
                  {data.positions && data.positions.length > 0 ? (
                    data.positions.map((pos, i) => (
                      <div key={`${pos.conditionId}-${pos.outcome}-${i}`} className="bg-white/[0.02] rounded-lg p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-gray-300 truncate">{pos.title || 'Unknown Market'}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[9px] px-1 py-0.5 rounded ${
                                pos.outcome === 'Yes' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                {pos.outcome}
                              </span>
                              <span className="text-[9px] text-gray-600">{pos.size?.toFixed(1)} @ {(pos.avgPrice * 100).toFixed(0)}c</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-[11px] text-gray-300 tabular-nums">{formatMoney(pos.currentValue || 0)}</p>
                            <p className={`text-[10px] tabular-nums ${getPnlColor(pos.cashPnl || 0)}`}>
                              {formatMoney(pos.cashPnl || 0)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-gray-600 py-4">No open positions</p>
                  )}
                </div>
              )}

              {/* Closed positions tab */}
              {activeTab === 'closed' && (
                <div className="space-y-1.5">
                  {data.closedPositions && data.closedPositions.length > 0 ? (
                    data.closedPositions.slice(0, 30).map((pos, i) => (
                      <div key={`${pos.conditionId}-${i}`} className="bg-white/[0.02] rounded-lg p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-gray-300 truncate">{pos.title || 'Unknown Market'}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`text-[9px] px-1 py-0.5 rounded ${
                                pos.isWin ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                {pos.isWin ? 'WIN' : 'LOSS'}
                              </span>
                              <span className="text-[9px] text-gray-600">{pos.outcome} @ {(pos.avgPrice * 100).toFixed(0)}c</span>
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-center">
                            <p className="text-[11px] text-gray-400 tabular-nums">
                              {formatMoney(pos.size * pos.avgPrice)}
                            </p>
                            <p className="text-[9px] text-gray-600 mt-0.5">invested</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-[11px] tabular-nums ${getPnlColor(pos.realizedPnl || 0)}`}>
                              {pos.size > 0 && pos.avgPrice > 0 && (
                                <span className={`text-[9px] ${getPnlColor(pos.realizedPnl || 0)} mr-1`}>
                                  ({(pos.realizedPnl || 0) >= 0 ? '+' : ''}{((pos.realizedPnl / (pos.size * pos.avgPrice)) * 100).toFixed(1)}%)
                                </span>
                              )}
                              {formatMoney(pos.realizedPnl || 0)}
                            </p>
                            {pos.resolvedAt && (
                              <p className="text-[9px] text-gray-500 mt-1">
                                {new Date(pos.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-xs text-gray-600 py-4">No closed positions</p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
