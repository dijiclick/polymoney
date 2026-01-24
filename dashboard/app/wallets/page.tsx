'use client'

import { useState, useEffect, useCallback } from 'react'
import { Wallet, WalletFilter, WalletMetrics, TimePeriod } from '@/lib/supabase'
import StatCard from '@/components/StatCard'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletFilters from '@/components/WalletFilters'
import WalletTable from '@/components/WalletTable'

interface WalletStats {
  total: number
  goldsky: number
  leaderboard: number
  both: number
  qualified200: number
  totalBalance: number
  avgBalance: number
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [metrics, setMetrics] = useState<Map<string, WalletMetrics>>(new Map())
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [filter, setFilter] = useState<WalletFilter>({
    timePeriod: '7d',
    minBalance: 0
  })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [sortBy, setSortBy] = useState('balance')
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

  // Fetch wallets
  const fetchWallets = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        source: filter.source || 'all',
        minBalance: String(filter.minBalance || 0),
        page: String(page),
        limit: '50',
        sortBy,
        sortDir
      })

      if (filter.category) {
        params.set('category', filter.category)
      }

      const res = await fetch(`/api/wallets?${params}`)
      const data = await res.json()

      if (data.wallets) {
        setWallets(data.wallets)
        setTotalPages(data.totalPages || 1)
      }
    } catch (error) {
      console.error('Error fetching wallets:', error)
    } finally {
      setLoading(false)
    }
  }, [filter.source, filter.category, filter.minBalance, page, sortBy, sortDir])

  // Fetch metrics for displayed wallets
  const fetchMetrics = useCallback(async () => {
    if (wallets.length === 0) return

    setMetricsLoading(true)
    const newMetrics = new Map<string, WalletMetrics>()

    // Fetch metrics in parallel with concurrency limit
    const batchSize = 10
    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize)
      const promises = batch.map(async (wallet) => {
        try {
          const res = await fetch(
            `/api/wallets/${wallet.address}/metrics?period=${filter.timePeriod}`
          )
          const data = await res.json()
          if (data.metrics) {
            newMetrics.set(wallet.address, data.metrics)
          }
        } catch (error) {
          console.error(`Error fetching metrics for ${wallet.address}:`, error)
        }
      })
      await Promise.all(promises)
    }

    setMetrics(newMetrics)
    setMetricsLoading(false)
  }, [wallets, filter.timePeriod])

  // Initial load
  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Fetch wallets when filter changes
  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  // Fetch metrics when wallets or time period changes
  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  // Handle sort
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
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Wallet Analytics</h1>
        <p className="text-gray-400">
          Analyze wallet performance across time periods. Data from Goldsky blockchain and Polymarket leaderboard.
        </p>
      </div>

      {/* Time Period Selector */}
      <TimePeriodSelector
        value={filter.timePeriod}
        onChange={(period) => handleFilterChange({ ...filter, timePeriod: period })}
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Wallets"
            value={stats.total}
            color="gray"
          />
          <StatCard
            title="Goldsky"
            value={stats.goldsky}
            color="blue"
          />
          <StatCard
            title="Leaderboard"
            value={stats.leaderboard}
            color="green"
          />
          <StatCard
            title="Portfolio $200+"
            value={stats.qualified200}
            color="purple"
          />
        </div>
      )}

      {/* Filters */}
      <WalletFilters filter={filter} onChange={handleFilterChange} />

      {/* Loading indicator for metrics */}
      {metricsLoading && (
        <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 text-blue-300 text-sm">
          Loading metrics for {wallets.length} wallets...
        </div>
      )}

      {/* Wallet Table */}
      <WalletTable
        wallets={wallets}
        metrics={metrics}
        loading={loading}
        timePeriod={filter.timePeriod}
        onSort={handleSort}
        sortBy={sortBy}
        sortDir={sortDir}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-gray-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-gray-800 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
