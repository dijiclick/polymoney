'use client'

import { useState, useEffect, useCallback } from 'react'
import { Wallet, WalletFilter, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletFilters from '@/components/WalletFilters'
import WalletTable from '@/components/WalletTable'

interface WalletStats {
  total: number
  goldsky: number
  live: number
  qualified200: number
  totalBalance: number
  avgBalance: number
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<WalletFilter>({
    timePeriod: '30d',
    minBalance: 0,
    minWinRate: 0
  })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalWallets, setTotalWallets] = useState(0)
  const [sortBy, setSortBy] = useState('pnl_30d')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Fetch wallet stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats' })
      })
      const data = await res.json()
      if (data.stats) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }, [])

  // Fetch wallets - now includes metrics from DB
  const fetchWallets = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        source: 'all',
        minBalance: String(filter.minBalance || 0),
        minWinRate: String(filter.minWinRate || 0),
        period: filter.timePeriod,
        page: String(page),
        limit: '50',
        sortBy,
        sortDir
      })

      const res = await fetch(`/api/wallets?${params}`)
      const data = await res.json()

      if (data.wallets) {
        setWallets(data.wallets)
        setTotalPages(data.totalPages || 1)
        setTotalWallets(data.total || 0)
      }
    } catch (error) {
      console.error('Error fetching wallets:', error)
    } finally {
      setLoading(false)
    }
  }, [filter.minBalance, filter.minWinRate, filter.timePeriod, page, sortBy, sortDir])

  // Initial load
  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Fetch wallets when filter changes
  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  // Handle sort - update sort column based on time period
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  // Handle filter change - reset to page 1
  const handleFilterChange = (newFilter: WalletFilter) => {
    setFilter(newFilter)
    setPage(1)
    // Update sort column if time period changes
    if (newFilter.timePeriod !== filter.timePeriod) {
      const newSuffix = newFilter.timePeriod === '30d' ? '_30d' : '_7d'
      const oldSuffix = filter.timePeriod === '30d' ? '_30d' : '_7d'
      if (sortBy.endsWith(oldSuffix)) {
        setSortBy(sortBy.replace(oldSuffix, newSuffix))
      }
    }
  }

  const formatMoney = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden mb-8">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 via-purple-600/5 to-transparent"></div>
        <div className="relative py-8">
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Trader Leaderboard
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Discover top-performing Polymarket traders. Analyze performance metrics and find profitable strategies.
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Total Traders</p>
                <p className="text-2xl font-bold text-white">{stats.total.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Qualified ($200+)</p>
                <p className="text-2xl font-bold text-white">{stats.qualified200.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Total Value</p>
                <p className="text-2xl font-bold text-white">{formatMoney(stats.totalBalance)}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Avg Portfolio</p>
                <p className="text-2xl font-bold text-white">{formatMoney(stats.avgBalance)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="bg-gray-900/30 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Left: Time Period */}
          <div className="flex items-center gap-4">
            <TimePeriodSelector
              value={filter.timePeriod}
              onChange={(period) => handleFilterChange({ ...filter, timePeriod: period })}
            />
            <div className="text-sm text-gray-500">
              <span className="text-gray-400 font-medium">{totalWallets.toLocaleString()}</span> traders
            </div>
          </div>

          {/* Right: Filters */}
          <WalletFilters filter={filter} onChange={handleFilterChange} />
        </div>
      </div>

      {/* Wallet Table */}
      <WalletTable
        wallets={wallets}
        loading={loading}
        timePeriod={filter.timePeriod}
        onSort={handleSort}
        sortBy={sortBy}
        sortDir={sortDir}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 px-2">
          <p className="text-sm text-gray-500">
            Page <span className="text-gray-300 font-medium">{page}</span> of <span className="text-gray-300 font-medium">{totalPages}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm font-medium text-gray-300 hover:bg-gray-700/50 hover:border-gray-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </span>
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-4 py-2.5 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm font-medium text-gray-300 hover:bg-gray-700/50 hover:border-gray-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <span className="flex items-center gap-1.5">
                Next
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
