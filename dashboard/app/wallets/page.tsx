'use client'

import { useState, useEffect, useCallback } from 'react'
import { Wallet, WalletFilter, TimePeriod } from '@/lib/supabase'
import StatCard from '@/components/StatCard'
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
  const [sortBy, setSortBy] = useState('win_rate_30d')
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
        source: filter.source || 'all',
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
      }
    } catch (error) {
      console.error('Error fetching wallets:', error)
    } finally {
      setLoading(false)
    }
  }, [filter.source, filter.minBalance, filter.minWinRate, filter.timePeriod, page, sortBy, sortDir])

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Wallet Analytics</h1>
        <p className="text-gray-400">
          Analyze wallet performance across time periods. Sort by win rate to find the best traders.
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
            title="Live Discovery"
            value={stats.live}
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

      {/* Wallet Table - metrics are now in wallet objects */}
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
