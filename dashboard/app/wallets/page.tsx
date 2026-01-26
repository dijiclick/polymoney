'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Wallet, WalletFilter, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletTable from '@/components/WalletTable'

interface WalletStats {
  total: number
  analyzed: number
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

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

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  const handleTimePeriodChange = (period: TimePeriod) => {
    setTimePeriod(period)
    setPage(1)
    const getSuffix = (p: TimePeriod) => p === 'all' ? '_all' : p === '30d' ? '_30d' : '_7d'
    const newSuffix = getSuffix(period)
    const oldSuffix = getSuffix(timePeriod)
    if (sortBy.endsWith(oldSuffix)) {
      setSortBy(sortBy.replace(oldSuffix, newSuffix))
    }
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

  const filteredWallets = useMemo(() => {
    let result = wallets

    if (Object.keys(columnFilters).length > 0) {
      result = result.filter(wallet => {
        for (const [column, filter] of Object.entries(columnFilters)) {
          let value: number | undefined

          if (column === 'balance') {
            value = wallet.balance
          } else if (column === 'active_positions') {
            value = wallet.active_positions
          } else if (column === 'total_positions') {
            value = wallet.total_positions
          } else {
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

  const activeFilterCount = Object.keys(columnFilters).length

  const formatMoney = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  return (
    <div className="min-h-screen">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Discovered</p>
                <p className="text-lg font-semibold text-white">{stats.total.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Analyzed</p>
                <p className="text-lg font-semibold text-white">
                  {stats.analyzed.toLocaleString()}
                  <span className="text-xs font-normal text-gray-600 ml-1">
                    ({stats.total > 0 ? Math.round(stats.analyzed / stats.total * 100) : 0}%)
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Total Value</p>
                <p className="text-lg font-semibold text-white">{formatMoney(stats.totalBalance)}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Avg Portfolio</p>
                <p className="text-lg font-semibold text-white">{formatMoney(stats.avgBalance)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <TimePeriodSelector
            value={timePeriod}
            onChange={handleTimePeriodChange}
          />

          {/* Search Input */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-48 pl-8 pr-7 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="text-xs text-gray-600">
            <span className="text-gray-400">{filteredWallets.length.toLocaleString()}</span>
            {(activeFilterCount > 0 || searchQuery) && <span className="text-gray-600"> / {totalWallets.toLocaleString()}</span>}
            {' '}traders
          </div>
        </div>

        {(activeFilterCount > 0 || searchQuery) && (
          <button
            onClick={() => {
              setColumnFilters({})
              setSearchQuery('')
            }}
            className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear
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
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-[10px] text-gray-600">
            Page <span className="text-gray-400">{page}</span> of <span className="text-gray-400">{totalPages}</span>
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-gray-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Prev
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-gray-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1"
            >
              Next
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
