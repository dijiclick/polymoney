'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import PnlChart, { ClosedPosition } from '@/components/live/PnlChart'

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
  endDate?: string
  marketSlug?: string
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

interface WalletData {
  address: string
  username?: string
  copy_score?: number
  profit_factor_30d?: number
  profit_factor_all?: number
  diff_win_rate_30d?: number
  diff_win_rate_all?: number
  weekly_profit_rate?: number
  avg_trades_per_day?: number
  roi_7d?: number
  roi_30d?: number
  drawdown_30d?: number
  balance?: number
  overall_pnl?: number
  overall_roi?: number
  overall_win_rate?: number
  total_positions?: number
  active_positions?: number
  drawdown_all?: number
  [key: string]: any
}

interface Props {
  address: string
  username?: string
  walletData?: WalletData
  isOpen: boolean
  onClose: () => void
  onDataUpdate?: (address: string, data: any) => void
}

// ── Main Modal ───────────────────────────────────────────────────────

export default function TraderDetailModal({ address, username, walletData, isOpen, onClose, onDataUpdate }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TraderData | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open')
  const [mounted, setMounted] = useState(false)

  // Build instant data from wallet table row (available immediately)
  const instantData: TraderData | null = walletData ? {
    address: walletData.address,
    username: walletData.username,
    positions: [],
    closedPositionsCount: walletData.total_positions || 0,
    metrics: {
      portfolioValue: walletData.balance || 0,
      totalPnl: walletData.overall_pnl || 0,
      winRateAllTime: walletData.overall_win_rate || 0,
      roiPercent: walletData.overall_roi || 0,
      activePositions: walletData.active_positions || 0,
      maxDrawdown: walletData.drawdown_all || 0,
    },
    copyScore: walletData.copy_score || 0,
    copyMetrics: {
      profitFactor30d: walletData.profit_factor_30d || 0,
      profitFactorAll: walletData.profit_factor_all || 0,
      diffWinRate30d: walletData.diff_win_rate_30d || 0,
      diffWinRateAll: walletData.diff_win_rate_all || 0,
      weeklyProfitRate: walletData.weekly_profit_rate || 0,
      avgTradesPerDay: walletData.avg_trades_per_day || 0,
      medianProfitPct: walletData.median_profit_pct ?? null,
      edgeTrend: (walletData.roi_30d || 0) > 0
        ? Math.round(((walletData.roi_7d || 0) / walletData.roi_30d!) * 100) / 100
        : 0,
      calmarRatio: (walletData.drawdown_30d || 0) > 0
        ? Math.round(((walletData.roi_30d || 0) / walletData.drawdown_30d!) * 100) / 100
        : (walletData.roi_30d || 0) > 0 ? 5.0 : 0,
    },
  } : null

  // Show instant data immediately, then replace with full API data
  const displayData = data || instantData

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (isOpen && address) {
      setData(null)
      fetchTraderData()
    }
  }, [isOpen, address])

  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  const fetchTraderData = async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch cached data only — no background refresh to avoid triggering
      // realtime subscription loops that unmount/remount the modal
      const res = await fetch(`/api/traders/${address}?refresh=false`)
      if (res.ok) {
        const result = await res.json()
        if (result.closedPositions?.length > 0 || result.positions?.length > 0) {
          setData(result)
          onDataUpdate?.(address, result)
          return
        }
      }

      // No cached positions — fetch fresh with lite mode (single request, no background refresh)
      const freshRes = await fetch(`/api/traders/${address}?refresh=true&lite=true`)
      if (!freshRes.ok) throw new Error('Failed to fetch trader data')
      const freshResult = await freshRes.json()
      setData(freshResult)
      onDataUpdate?.(address, freshResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const formatMoney = (value: number) => {
    if (value === undefined || value === null) return '-'
    const absValue = Math.abs(value)
    if (absValue >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (absValue >= 1000) return `$${(value / 1000).toFixed(2)}K`
    return `$${value.toFixed(2)}`
  }

  const formatPercent = (value: number) => {
    if (value === undefined || value === null) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const getPnlColor = (value: number) => {
    if (value === 0) return 'text-gray-500'
    return value > 0 ? 'text-emerald-400' : 'text-red-400'
  }

  const displayName = username && !username.startsWith('0x')
    ? username
    : `${address.slice(0, 6)}...${address.slice(-4)}`

  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-end md:items-center justify-center p-0 md:p-3" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal — nearly full size */}
      <div className="relative bg-[#0d0d12] border border-white/10 rounded-t-xl md:rounded-xl shadow-2xl w-full max-w-5xl max-h-[100vh] md:max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <span className="text-white font-medium text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <h2 className="text-sm font-medium text-white">{displayName}</h2>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-500 hover:text-gray-400 flex items-center gap-1 transition-colors"
              >
                View on Polymarket
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(100vh-56px)] md:max-h-[calc(95vh-56px)]">
          {!displayData && loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border border-white/10"></div>
                <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
              </div>
              <p className="text-gray-600 mt-3 text-xs">Loading...</p>
            </div>
          ) : error && !displayData ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={fetchTraderData}
                className="mt-3 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs text-white transition-colors"
              >
                Retry
              </button>
            </div>
          ) : displayData ? (
            <>
              {/* Copy Score Banner */}
              {(() => {
                const score = Math.round(displayData.copyScore || 0)
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
                  <div className={`mx-3 md:mx-5 mt-4 mb-2 px-4 md:px-5 py-3.5 rounded-lg bg-gradient-to-r ${scoreBg} border`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <p className="text-[9px] text-gray-500 uppercase tracking-wider">Copy Score</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className={`text-3xl font-extrabold tabular-nums ${scoreText}`}>{score}</span>
                          <span className={`text-sm font-medium ${scoreText} opacity-70`}>{scoreLabel}</span>
                        </div>
                      </div>
                      {displayData.copyMetrics && (
                        <div className="sm:text-right space-y-1">
                          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                            <div className="text-center">
                              <p className="text-[9px] text-gray-600 uppercase">Profit F.</p>
                              <p className="text-xs font-semibold text-gray-300 tabular-nums">{displayData.copyMetrics.profitFactor30d.toFixed(1)}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-[9px] text-gray-600 uppercase">Calmar</p>
                              <p className="text-xs font-semibold text-gray-300 tabular-nums">{displayData.copyMetrics.calmarRatio.toFixed(1)}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-[9px] text-gray-600 uppercase">Weekly</p>
                              <p className="text-xs font-semibold text-gray-300 tabular-nums">{displayData.copyMetrics.weeklyProfitRate.toFixed(0)}%</p>
                            </div>
                            <div className="text-center">
                              <p className="text-[9px] text-gray-600 uppercase">Edge</p>
                              <p className={`text-xs font-semibold tabular-nums ${displayData.copyMetrics.edgeTrend >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {displayData.copyMetrics.edgeTrend.toFixed(2)}x
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-[9px] text-gray-600 uppercase">Diff WR</p>
                              <p className="text-xs font-semibold text-gray-300 tabular-nums">{displayData.copyMetrics.diffWinRate30d.toFixed(1)}%</p>
                            </div>
                          </div>
                          <p className="text-[9px] text-gray-600">
                            {displayData.copyMetrics.avgTradesPerDay.toFixed(1)} trades/day
                            {(() => {
                              const gq = displayData.metrics?.metrics30d?.growthQuality || 0
                              if (gq <= 0) return null
                              const gqColor = gq >= 8 ? 'text-emerald-400' : gq >= 5 ? 'text-blue-400' : gq >= 3 ? 'text-amber-400' : 'text-red-400'
                              return <> · <span className={gqColor}>GQ {gq}/10</span></>
                            })()}
                          </p>
                        </div>
                      )}
                    </div>
                    {/* Hard filter warnings */}
                    {(() => {
                      const warnings: string[] = []
                      const m = displayData.metrics
                      const cm = displayData.copyMetrics
                      if (m && cm) {
                        if ((m.totalPnl || 0) < 0) warnings.push('Negative overall PnL')
                        if ((m.roiPercent || 0) < 0) warnings.push('Negative overall ROI')
                        if ((m.tradeCountAllTime || 0) < 30) warnings.push(`Only ${m.tradeCountAllTime || 0} trades (need 30+)`)
                        if (cm.profitFactor30d < 1.2) warnings.push(`PF30d ${cm.profitFactor30d.toFixed(2)} (need 1.2+)`)
                        if (cm.medianProfitPct == null || cm.medianProfitPct < 5.0) warnings.push(`Median profit ${cm.medianProfitPct?.toFixed(1) ?? '?'}% (need 5%+)`)
                        if (cm.avgTradesPerDay < 0.5) warnings.push(`${cm.avgTradesPerDay.toFixed(1)} trades/day (need 0.5+)`)
                        if (cm.avgTradesPerDay > 25) warnings.push(`${cm.avgTradesPerDay.toFixed(1)} trades/day (max 25)`)
                      }
                      if (warnings.length === 0) return null
                      return (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {warnings.map((w, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-400/80 border border-amber-500/20">
                              <span className="opacity-70">!</span> {w}
                            </span>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

              {/* PnL Chart — shows loading spinner while positions load */}
              {displayData.closedPositions && displayData.closedPositions.length > 0 ? (
                <PnlChart closedPositions={displayData.closedPositions} />
              ) : loading ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="relative w-6 h-6">
                    <div className="absolute inset-0 rounded-full border border-white/10"></div>
                    <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
                  </div>
                  <p className="text-gray-600 mt-2 text-[10px]">Loading chart...</p>
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-gray-600">No position history for chart</p>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-white/5" />

              {/* Tabs */}
              <div className="flex gap-1 px-4 md:px-6 pt-3 pb-3 border-b border-white/5">
                <button
                  onClick={() => setActiveTab('open')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'open'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Open ({displayData.positions?.length || 0})
                  {loading && !data && <span className="ml-1 text-gray-600">...</span>}
                </button>
                <button
                  onClick={() => setActiveTab('closed')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'closed'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Closed ({displayData.closedPositions?.length || displayData.closedPositionsCount || 0})
                  {loading && !data && <span className="ml-1 text-gray-600">...</span>}
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-3 md:p-5">
                {activeTab === 'open' && (
                  <div className="space-y-2">
                    {loading && !data ? (
                      <div className="text-center py-8 text-gray-600 text-xs">Loading positions...</div>
                    ) : displayData.positions && displayData.positions.length > 0 ? (
                      displayData.positions.map((position, index) => (
                        <div
                          key={`${position.conditionId}-${position.outcome}-${index}`}
                          className="bg-white/[0.02] rounded-lg p-3 hover:bg-white/[0.04] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-medium text-gray-300 truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  position.outcome === 'Yes'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {position.outcome}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {position.size?.toFixed(2)} @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-300">
                                {formatMoney(position.currentValue || 0)}
                              </p>
                              <p className={`text-[10px] ${getPnlColor(position.cashPnl || 0)}`}>
                                {formatMoney(position.cashPnl || 0)} ({formatPercent(position.percentPnl || 0)})
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-600 text-xs">
                        No open positions
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'closed' && (
                  <div className="space-y-2">
                    {displayData.closedPositions && displayData.closedPositions.length > 0 ? (
                      displayData.closedPositions.map((position, index) => (
                        <div
                          key={`${position.conditionId}-${index}`}
                          className="bg-white/[0.02] rounded-lg p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-medium text-gray-300 truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  position.isWin
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {position.isWin ? 'WIN' : 'LOSS'}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {position.outcome} @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                              </div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <p className={`text-xs ${getPnlColor(position.realizedPnl || 0)}`}>
                                {position.size > 0 && position.avgPrice > 0 && (
                                  <span className={`text-[10px] ${getPnlColor(position.realizedPnl || 0)} mr-1`}>
                                    ({(position.realizedPnl || 0) >= 0 ? '+' : ''}{((position.realizedPnl / (position.size * position.avgPrice)) * 100).toFixed(1)}%)
                                  </span>
                                )}
                                {formatMoney(position.realizedPnl || 0)}
                              </p>
                              {position.resolvedAt && (
                                <p className="text-[10px] text-gray-500 mt-1">
                                  {new Date(position.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-600 text-xs">
                        No closed positions
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
