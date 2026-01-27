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
}

interface Props {
  address: string
  username?: string
  isOpen: boolean
  onClose: () => void
}

// ── Main Modal ───────────────────────────────────────────────────────

export default function TraderDetailModal({ address, username, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TraderData | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (isOpen && address) {
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
      const res = await fetch(`/api/traders/${address}?refresh=true`)
      if (!res.ok) throw new Error('Failed to fetch trader data')
      const result = await res.json()
      setData(result)
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal — nearly full size */}
      <div className="relative bg-[#0d0d12] border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/5">
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
        <div className="overflow-y-auto max-h-[calc(95vh-56px)]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border border-white/10"></div>
                <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
              </div>
              <p className="text-gray-600 mt-3 text-xs">Loading...</p>
            </div>
          ) : error ? (
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
          ) : data ? (
            <>
              {/* PnL Chart */}
              <PnlChart closedPositions={data.closedPositions || []} />

              {/* Divider */}
              <div className="border-t border-white/5" />

              {/* Tabs */}
              <div className="flex gap-1 px-6 pt-3 pb-3 border-b border-white/5">
                <button
                  onClick={() => setActiveTab('open')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'open'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Open ({data.positions?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('closed')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'closed'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Closed ({data.closedPositions?.length || data.closedPositionsCount || 0})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-5">
                {activeTab === 'open' && (
                  <div className="space-y-2">
                    {data.positions && data.positions.length > 0 ? (
                      data.positions.map((position, index) => (
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
                    {data.closedPositions && data.closedPositions.length > 0 ? (
                      data.closedPositions.map((position, index) => (
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
                            <div className="text-right">
                              <p className={`text-xs ${getPnlColor(position.realizedPnl || 0)}`}>
                                {formatMoney(position.realizedPnl || 0)}
                              </p>
                              {position.resolvedAt && (
                                <p className="text-[10px] text-gray-400 mt-0.5">
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
