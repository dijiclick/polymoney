'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, WalletFilter, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletTable, { ColumnKey, COLUMNS, DEFAULT_VISIBLE } from '@/components/WalletTable'
import TraderDetailModal from '@/components/TraderDetailModal'

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
  const [analyzeAddress, setAnalyzeAddress] = useState('')
  const [showAnalyzeInput, setShowAnalyzeInput] = useState(false)
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE)
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const columnSettingsRef = useRef<HTMLDivElement>(null)
  const analyzeInputRef = useRef<HTMLInputElement>(null)

  // Load column preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('polymarket-visible-columns')
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnKey[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setVisibleColumns(parsed)
        }
      }
    } catch {}
  }, [])

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      if (next.length === 0) return prev // keep at least one
      localStorage.setItem('polymarket-visible-columns', JSON.stringify(next))
      return next
    })
  }

  // Close column settings on outside click
  useEffect(() => {
    if (!showColumnSettings) return
    const handleClick = (e: MouseEvent) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target as Node)) {
        setShowColumnSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColumnSettings])

  const resolveAndAnalyze = async (rawInput: string) => {
    let input = rawInput.trim()
    if (!input) return

    // Extract address from Polymarket URL: polymarket.com/profile/0x...
    const profileMatch = input.match(/polymarket\.com\/profile\/(0x[a-fA-F0-9]{40})/i)
    if (profileMatch) {
      input = profileMatch[1]
    }

    // Handle polymarket.com/@username or bare @username format
    const usernameMatch = input.match(/polymarket\.com\/@([^/?#]+)/i) || input.match(/^@([^/?#\s]+)$/i)
    if (usernameMatch) {
      const username = usernameMatch[1]
      setResolving(true)
      try {
        const res = await fetch(`/api/resolve-username?username=${encodeURIComponent(username)}`)
        const data = await res.json()
        if (data.address) {
          input = data.address
        } else {
          alert(`Could not find wallet for username: @${username}`)
          setResolving(false)
          return
        }
      } catch {
        alert('Failed to resolve username')
        setResolving(false)
        return
      }
      setResolving(false)
    }

    // Clean up: ensure it's a valid 0x address
    const addr = input.toLowerCase()
    const finalAddr = addr.startsWith('0x') ? addr : `0x${addr}`
    setAnalyzeAddress(finalAddr)
    setShowAnalyzeModal(true)
    setShowAnalyzeInput(false)
  }

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
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
        ...(Object.keys(columnFilters).length > 0 && { columnFilters: JSON.stringify(columnFilters) })
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
  }, [timePeriod, page, sortBy, sortDir, debouncedSearch, columnFilters])

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
    setPage(1)
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

          {/* Analyze Wallet */}
          {showAnalyzeInput ? (
            <div className="relative">
              <input
                ref={analyzeInputRef}
                type="text"
                value={analyzeAddress}
                onChange={(e) => setAnalyzeAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && analyzeAddress.trim() && !resolving) {
                    resolveAndAnalyze(analyzeAddress)
                  }
                  if (e.key === 'Escape') {
                    setShowAnalyzeInput(false)
                    setAnalyzeAddress('')
                  }
                }}
                placeholder="0x address, @username, or profile URL..."
                className="w-80 pl-3 pr-8 py-1.5 bg-white/[0.02] border border-blue-500/30 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
                autoFocus
                disabled={resolving}
              />
              <button
                onClick={() => { setShowAnalyzeInput(false); setAnalyzeAddress('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-600 hover:text-gray-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowAnalyzeInput(true); setTimeout(() => analyzeInputRef.current?.focus(), 50) }}
              className="px-2.5 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-gray-500 hover:text-blue-400 hover:border-blue-500/20 hover:bg-blue-500/5 transition-all flex items-center gap-1.5"
              title="Analyze a specific wallet address"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              Analyze
            </button>
          )}

          {/* Column Settings */}
          <div className="relative" ref={columnSettingsRef}>
            <button
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              className={`px-2 py-1.5 bg-white/[0.02] border rounded-lg text-[10px] transition-all flex items-center gap-1.5 ${
                showColumnSettings
                  ? 'border-white/20 text-white'
                  : visibleColumns.length < DEFAULT_VISIBLE.length
                    ? 'border-blue-500/20 text-blue-400 hover:border-blue-500/30'
                    : 'border-white/5 text-gray-500 hover:text-gray-400 hover:border-white/10'
              }`}
              title="Toggle columns"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 4h6M9 8h6M9 12h6M9 16h6M9 20h6" />
              </svg>
            </button>
            {showColumnSettings && (
              <div className="absolute top-full left-0 mt-2 z-50 bg-[#12121a] border border-white/10 rounded-lg shadow-2xl p-2 min-w-[160px]">
                <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider px-2 py-1.5">Columns</div>
                {COLUMNS.map(col => (
                  <button
                    key={col.key}
                    onClick={() => toggleColumn(col.key)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-white/5 transition-colors"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                      visibleColumns.includes(col.key)
                        ? 'bg-blue-500/20 border-blue-500/50'
                        : 'border-white/10'
                    }`}>
                      {visibleColumns.includes(col.key) && (
                        <svg className="w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className={visibleColumns.includes(col.key) ? 'text-gray-300' : 'text-gray-600'}>{col.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">
            <span className="text-gray-400">{totalWallets.toLocaleString()}</span>
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
        wallets={wallets}
        loading={loading}
        timePeriod={timePeriod}
        onSort={handleSort}
        sortBy={sortBy}
        sortDir={sortDir}
        columnFilters={columnFilters}
        onColumnFilterChange={handleColumnFilterChange}
        visibleColumns={visibleColumns}
      />

      {/* Analyze Wallet Modal */}
      <TraderDetailModal
        address={analyzeAddress}
        isOpen={showAnalyzeModal}
        onClose={() => { setShowAnalyzeModal(false); setAnalyzeAddress('') }}
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
