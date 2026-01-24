'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

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

interface ClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  size: number
  avgPrice: number
  finalPrice: number
  realizedPnl: number
  resolvedAt?: string
  isWin: boolean
}

interface TraderData {
  address: string
  username?: string
  positions: Position[]
  closedPositions?: ClosedPosition[]
  closedPositionsCount: number
}

interface Props {
  address: string
  username?: string
  isOpen: boolean
  onClose: () => void
}

export default function TraderDetailModal({ address, username, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TraderData | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open')
  const [mounted, setMounted] = useState(false)

  // Handle client-side mounting for portal
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (isOpen && address) {
      fetchTraderData()
    }
  }, [isOpen, address])

  // Handle escape key and body scroll lock
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
    if (value === 0) return 'text-gray-400'
    return value > 0 ? 'text-emerald-400' : 'text-red-400'
  }

  const displayName = username && !username.startsWith('0x')
    ? username
    : `${address.slice(0, 6)}...${address.slice(-4)}`

  // Don't render on server or if not mounted
  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">{displayName}</h2>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                View on Polymarket
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-2 border-blue-500/20"></div>
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin"></div>
              </div>
              <p className="text-gray-500 mt-4">Loading positions...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-red-400">{error}</p>
              <button
                onClick={fetchTraderData}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white transition-colors"
              >
                Retry
              </button>
            </div>
          ) : data ? (
            <>
              {/* Tabs */}
              <div className="flex gap-1 px-6 pt-4 border-b border-gray-800 pb-4">
                <button
                  onClick={() => setActiveTab('open')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'open'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  Open ({data.positions?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('closed')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'closed'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  Closed ({data.closedPositions?.length || data.closedPositionsCount || 0})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {activeTab === 'open' && (
                  <div className="space-y-3">
                    {data.positions && data.positions.length > 0 ? (
                      data.positions.map((position, index) => (
                        <div
                          key={position.conditionId || index}
                          className="bg-gray-800/50 rounded-xl p-4 hover:bg-gray-800/70 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-white truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  position.outcome === 'Yes'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {position.outcome}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {position.size?.toFixed(2)} shares @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-white">
                                {formatMoney(position.currentValue || 0)}
                              </p>
                              <p className={`text-xs ${getPnlColor(position.cashPnl || 0)}`}>
                                {formatMoney(position.cashPnl || 0)} ({formatPercent(position.percentPnl || 0)})
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        No open positions
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'closed' && (
                  <div className="space-y-3">
                    {data.closedPositions && data.closedPositions.length > 0 ? (
                      data.closedPositions.map((position, index) => (
                        <div
                          key={position.conditionId || index}
                          className="bg-gray-800/50 rounded-xl p-4"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-white truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  position.isWin
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {position.isWin ? 'WIN' : 'LOSS'}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {position.outcome} @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                                {position.resolvedAt && (
                                  <span className="text-xs text-gray-600">
                                    {new Date(position.resolvedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-medium ${getPnlColor(position.realizedPnl || 0)}`}>
                                {formatMoney(position.realizedPnl || 0)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {position.size?.toFixed(2)} shares
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-500">
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

  // Use portal to render modal at document body level
  return createPortal(modalContent, document.body)
}
