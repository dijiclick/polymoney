'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Wallet, WalletFilter, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletTable from '@/components/WalletTable'

interface WalletStats {
  total: number
  goldsky: number
  live: number
  qualified200: number
  totalBalance: number
  avgBalance: number
}

interface ColumnFilter {
  min?: number
  max?: number
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('30d')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalWallets, setTotalWallets] = useState(0)
  const [sortBy, setSortBy] = useState('pnl_30d')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search query to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setPage(1) // Reset to first page when search changes
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

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
        source: 'all',
        minBalance: '0',
        minWinRate: '0',
        period: timePeriod,
        page: String(page),
        limit: '50',
        sortBy,
        sortDir,
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() })
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
  }, [timePeriod, page, sortBy, sortDir, debouncedSearch])

  // Initial load
  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Fetch wallets when params change
  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  // Handle sort
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  // Handle time period change
  const handleTimePeriodChange = (period: TimePeriod) => {
    setTimePeriod(period)
    setPage(1)
    // Update sort column if time period changes
    const newSuffix = period === '30d' ? '_30d' : '_7d'
    const oldSuffix = timePeriod === '30d' ? '_30d' : '_7d'
    if (sortBy.endsWith(oldSuffix)) {
      setSortBy(sortBy.replace(oldSuffix, newSuffix))
    }
    // Update column filters to use new time period suffix
    const newFilters: Record<string, ColumnFilter> = {}
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (key.endsWith(oldSuffix)) {
        newFilters[key.replace(oldSuffix, newSuffix)] = value
      } else {
        newFilters[key] = value
      }
    })
    setColumnFilters(newFilters)
  }

  // Handle column filter change
  const handleColumnFilterChange = (column: string, filter: ColumnFilter) => {
    setColumnFilters(prev => {
      if (!filter.min && !filter.max) {
        const { [column]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [column]: filter }
    })
    setPage(1)
  }

  // Apply client-side column filters (search is now server-side)
  const filteredWallets = useMemo(() => {
    let result = wallets

    // Apply column filters (client-side for numeric filtering)
    if (Object.keys(columnFilters).length > 0) {
      result = result.filter(wallet => {
        for (const [column, filter] of Object.entries(columnFilters)) {
          let value: number | undefined

          // Get the value based on column name
          if (column === 'balance') {
            value = wallet.balance
          } else if (column === 'active_positions') {
            value = wallet.active_positions
          } else if (column === 'total_positions') {
            value = wallet.total_positions
          } else {
            // Period-based metrics
            value = (wallet as any)[column] || 0
          }

          if (value === undefined) continue

          if (filter.min !== undefined && value < filter.min) return false
          if (filter.max !== undefined && value > filter.max) return false
        }
        return true
      })
    }

    return result
  }, [wallets, columnFilters])

  // Count active filters
  const activeFilterCount = Object.keys(columnFilters).length

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
            Discover top-performing Polymarket traders. Click the filter icon on any column to set min/max values.
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-5">
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-3">
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <TimePeriodSelector
            value={timePeriod}
            onChange={handleTimePeriodChange}
          />

          {/* Search Input */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name or address..."
              className="w-64 pl-9 pr-8 py-2 bg-gray-800/50 border border-gray-700/50 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="text-sm text-gray-500">
            <span className="text-gray-400 font-medium">{filteredWallets.length.toLocaleString()}</span>
            {(activeFilterCount > 0 || searchQuery) && <span className="text-gray-600"> of {totalWallets.toLocaleString()}</span>}
            {' '}traders
          </div>
        </div>

        {(activeFilterCount > 0 || searchQuery) && (
          <button
            onClick={() => {
              setColumnFilters({})
              setSearchQuery('')
            }}
            className="text-sm text-gray-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear filters
          </button>
        )}
      </div>

      {/* Wallet Table */}
      <WalletTable
        wallets={filteredWallets}
        loading={loading}
        timePeriod={timePeriod}
        onSort={handleSort}
        sortBy={sortBy}
        sortDir={sortDir}
        columnFilters={columnFilters}
        onColumnFilterChange={handleColumnFilterChange}
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
