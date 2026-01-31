'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import NewWalletTable, { ColumnKey, COLUMNS, DEFAULT_VISIBLE, WalletRow } from '@/components/new/NewWalletTable'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

interface Stats {
  tracked: number
  synced: number
  totalPnl: number
  avgWinRate: number
}

interface ColumnFilter {
  min?: number
  max?: number
}

interface Cursor {
  sortValue: string
  address: string
}

interface SyncProgress {
  total: number
  current: number
  success: number
  failed: number
  address?: string
}

export default function NewPage() {
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [totalEstimate, setTotalEstimate] = useState(0)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('30d')
  const [sortBy, setSortBy] = useState('total_pnl')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE)
  const [showColumnSettings, setShowColumnSettings] = useState(false)

  // Analyze wallet
  const [analyzeAddress, setAnalyzeAddress] = useState('')
  const [showAnalyzeInput, setShowAnalyzeInput] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const analyzeInputRef = useRef<HTMLInputElement>(null)

  // Sync
  const [syncingAddress, setSyncingAddress] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [syncDone, setSyncDone] = useState(false)
  const syncAbortRef = useRef(false)

  // Import
  const [importing, setImporting] = useState(false)

  // Real-time debounce
  const realtimeDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const columnSettingsRef = useRef<HTMLDivElement>(null)

  const formatMoney = (value: number) => {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Load column preferences from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('polymarket-new-visible-columns')
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
      if (next.length === 0) return prev
      localStorage.setItem('polymarket-new-visible-columns', JSON.stringify(next))
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

  const fetchWallets = useCallback(async (cursor?: Cursor | null) => {
    const isInitialLoad = !cursor
    if (isInitialLoad) {
      setLoading(true)
    } else {
      setIsFetchingMore(true)
    }

    try {
      const params = new URLSearchParams({
        sortBy,
        sortDir,
        limit: '50',
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
        ...(Object.keys(columnFilters).length > 0 && { columnFilters: JSON.stringify(columnFilters) }),
        ...(cursor && {
          cursorSortValue: cursor.sortValue,
          cursorAddress: cursor.address,
        }),
        ...(!cursor && { includeStats: 'true' }),
      })

      const res = await fetch(`/api/new/wallets?${params}`)
      if (!res.ok) throw new Error('Failed to fetch wallets')
      const data = await res.json()

      if (data.wallets) {
        if (isInitialLoad) {
          setWallets(data.wallets)
          if (data.stats) setStats(data.stats)
        } else {
          setWallets(prev => [...prev, ...data.wallets])
        }
        setNextCursor(data.nextCursor)
        setHasMore(data.hasMore)
        setTotalEstimate(data.totalEstimate || 0)
      }
    } catch (err) {
      console.error('Failed to fetch wallets:', err)
    } finally {
      setLoading(false)
      setIsFetchingMore(false)
    }
  }, [sortBy, sortDir, debouncedSearch, columnFilters])

  // Reset and fetch from beginning when filters/sort/search change
  useEffect(() => {
    setWallets([])
    setNextCursor(null)
    setHasMore(true)
    const container = document.querySelector('[data-scroll-container]')
    if (container) container.scrollTop = 0
    fetchWallets(null)
  }, [fetchWallets])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/new/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats' }),
      })
      const data = await res.json()
      if (data.stats) setStats(data.stats)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  // Real-time subscription for wallets_new changes
  useEffect(() => {
    const channel = supabase
      .channel('wallets_new_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets_new' },
        () => {
          if (realtimeDebounceRef.current) {
            clearTimeout(realtimeDebounceRef.current)
          }
          realtimeDebounceRef.current = setTimeout(() => {
            if (syncProgress || analyzing || importing) return
            fetchWallets(null)
          }, 2000)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current)
      }
    }
  }, [fetchWallets, syncProgress, analyzing, importing])

  // Also watch the main wallets table for new live-discovered wallets
  useEffect(() => {
    const channel = supabase
      .channel('wallets_live_discovery')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wallets' },
        (payload) => {
          const addr = (payload.new as Record<string, unknown>)?.address as string
          const uname = (payload.new as Record<string, unknown>)?.username as string | null
          if (!addr) return

          fetch('/api/new/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr, username: uname }),
          }).then(() => {
            fetchWallets(null)
          }).catch(() => {})
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchWallets])

  const loadMore = useCallback(() => {
    if (!isFetchingMore && hasMore && nextCursor) {
      fetchWallets(nextCursor)
    }
  }, [isFetchingMore, hasMore, nextCursor, fetchWallets])

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  const handleTimePeriodChange = (period: TimePeriod) => {
    setTimePeriod(period)
    const getSuffix = (p: TimePeriod) => p === 'all' ? '_all' : p === '30d' ? '_30d' : '_7d'
    const newSuffix = getSuffix(period)
    const oldSuffix = getSuffix(timePeriod)

    // Map between all-time and period column names
    const allTimeMap: Record<string, string> = {
      total_pnl: 'pnl', total_roi: 'roi', win_rate: 'win_rate',
      total_volume_bought: 'volume', closed_trade_count: 'trade_count', drawdown_all: 'drawdown',
    }
    const reverseAllTimeMap: Record<string, string> = {
      pnl: 'total_pnl', roi: 'total_roi', win_rate: 'win_rate',
      volume: 'total_volume_bought', trade_count: 'closed_trade_count', drawdown: 'drawdown_all',
    }

    // Adjust sort column
    if (timePeriod === 'all' && period !== 'all') {
      // Switching from all to period
      const base = allTimeMap[sortBy]
      if (base) setSortBy(`${base}${newSuffix}`)
    } else if (timePeriod !== 'all' && period === 'all') {
      // Switching from period to all
      const base = sortBy.replace(oldSuffix, '')
      if (reverseAllTimeMap[base]) setSortBy(reverseAllTimeMap[base])
    } else if (timePeriod !== 'all' && period !== 'all') {
      // Switching between 7d and 30d
      if (sortBy.endsWith(oldSuffix)) {
        setSortBy(sortBy.replace(oldSuffix, newSuffix))
      }
    }

    // Adjust column filters
    const newFilters: Record<string, ColumnFilter> = {}
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (timePeriod === 'all' && period !== 'all') {
        const base = allTimeMap[key]
        if (base) {
          newFilters[`${base}${newSuffix}`] = value
        } else {
          newFilters[key] = value
        }
      } else if (timePeriod !== 'all' && period === 'all') {
        const base = key.replace(oldSuffix, '')
        if (reverseAllTimeMap[base]) {
          newFilters[reverseAllTimeMap[base]] = value
        } else {
          newFilters[key] = value
        }
      } else if (key.endsWith(oldSuffix)) {
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
  }

  const activeFilterCount = Object.keys(columnFilters).length

  const handleAnalyze = async (rawInput: string) => {
    let input = rawInput.trim()
    if (!input) return

    const profileMatch = input.match(/polymarket\.com\/profile\/(0x[a-fA-F0-9]{40})/i)
    if (profileMatch) {
      input = profileMatch[1]
    }

    const usernameMatch = input.match(/polymarket\.com\/@([^/?#]+)/i) || input.match(/^@([^/?#\s]+)$/i)
    const isHexAddress = /^(0x)?[a-fA-F0-9]{40}$/.test(input)
    const isPlainUsername = !isHexAddress && !usernameMatch && !input.includes('polymarket.com') && !/^0x/i.test(input)
    const usernameToResolve = usernameMatch ? usernameMatch[1] : isPlainUsername ? input : null

    if (usernameToResolve) {
      try {
        const res = await fetch(`/api/resolve-username?username=${encodeURIComponent(usernameToResolve)}`)
        const data = await res.json()
        if (data.address) {
          input = data.address
        } else {
          alert(`Could not find wallet for username: ${usernameToResolve}`)
          return
        }
      } catch {
        alert('Failed to resolve username')
        return
      }
    }

    const addr = input.toLowerCase()
    const finalAddr = addr.startsWith('0x') ? addr : `0x${addr}`
    setShowAnalyzeInput(false)
    setAnalyzeAddress('')
    setAnalyzing(true)

    try {
      const res = await fetch('/api/new/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: finalAddr }),
      })
      if (!res.ok) throw new Error('Failed to sync wallet')
      await fetchWallets(null)
    } catch (error) {
      console.error('Error analyzing wallet:', error)
      alert('Failed to analyze wallet')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSyncWallet = async (address: string) => {
    setSyncingAddress(address)
    try {
      const res = await fetch('/api/new/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      if (res.ok) {
        await fetchWallets(null)
      }
    } catch (err) {
      console.error('Failed to sync wallet:', err)
    } finally {
      setSyncingAddress(null)
    }
  }

  const handleSyncAll = async () => {
    syncAbortRef.current = false
    setSyncDone(false)
    setSyncProgress({ total: wallets.length, current: 0, success: 0, failed: 0 })

    let success = 0
    let failed = 0

    for (let i = 0; i < wallets.length; i++) {
      if (syncAbortRef.current) break

      const wallet = wallets[i]
      setSyncProgress({
        total: wallets.length,
        current: i,
        success,
        failed,
        address: wallet.address,
      })

      try {
        const res = await fetch('/api/new/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: wallet.address }),
        })
        if (res.ok) success++
        else failed++
      } catch {
        failed++
      }
    }

    setSyncProgress({ total: wallets.length, current: wallets.length, success, failed })
    setSyncDone(true)
    await fetchWallets(null)
  }

  const handleImportLive = async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/new/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import-live' }),
      })
      const data = await res.json()
      if (data.imported > 0) {
        await fetchWallets(null)
      }
    } catch (err) {
      console.error('Failed to import:', err)
    } finally {
      setImporting(false)
    }
  }

  // Reload data when sync completes
  useEffect(() => {
    if (syncDone) {
      fetchWallets(null)
      fetchStats()
    }
  }, [syncDone]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mb-4 md:mb-6">
          <div className="glass rounded-xl p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Tracked</p>
                <p className="text-lg font-semibold text-white">{stats.tracked.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Synced</p>
                <p className="text-lg font-semibold text-white">
                  {stats.synced.toLocaleString()}
                  <span className="text-xs font-normal text-gray-600 ml-1">
                    ({stats.tracked > 0 ? Math.round(stats.synced / stats.tracked * 100) : 0}%)
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Total PnL</p>
                <p className={`text-lg font-semibold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatMoney(stats.totalPnl)}
                </p>
              </div>
            </div>
          </div>

          <div className="glass rounded-xl p-3 md:p-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <p className="text-[10px] text-gray-600 uppercase tracking-wider">Avg Win Rate</p>
                <p className={`text-lg font-semibold ${stats.avgWinRate >= 60 ? 'text-emerald-400' : stats.avgWinRate >= 50 ? 'text-amber-400' : 'text-white'}`}>
                  {stats.avgWinRate.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync All Progress */}
      {syncProgress && (
        <div className="glass rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {!syncDone ? (
                <div className="w-4 h-4 rounded-full border-2 border-transparent border-t-blue-400 animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              <span className="text-sm font-medium text-white">
                {syncDone ? 'Sync Complete' : 'Syncing All Wallets'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-emerald-400">{syncProgress.success} ok</span>
                {syncProgress.failed > 0 && (
                  <span className="text-red-400">{syncProgress.failed} failed</span>
                )}
                <span className="text-gray-500">
                  {syncProgress.current} / {syncProgress.total}
                </span>
              </div>
              {!syncDone ? (
                <button
                  onClick={() => { syncAbortRef.current = true }}
                  className="px-2 py-1 text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-md transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => { setSyncProgress(null); setSyncDone(false) }}
                  className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 border border-white/10 rounded-md transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${syncDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
            />
          </div>
          {!syncDone && syncProgress.address && (
            <p className="text-[10px] text-gray-600 mt-1.5 font-mono truncate">
              {syncProgress.address}
            </p>
          )}
        </div>
      )}

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
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
              className="w-32 sm:w-48 pl-8 pr-7 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-white/20 transition-all"
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
          {analyzing ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-500/5 border border-blue-500/20 rounded-lg">
              <div className="w-3.5 h-3.5 rounded-full border border-transparent border-t-blue-400 animate-spin" />
              <span className="text-[10px] text-blue-400">Analyzing...</span>
            </div>
          ) : showAnalyzeInput ? (
            <div className="relative">
              <input
                ref={analyzeInputRef}
                type="text"
                value={analyzeAddress}
                onChange={(e) => setAnalyzeAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && analyzeAddress.trim()) {
                    handleAnalyze(analyzeAddress)
                  }
                  if (e.key === 'Escape') {
                    setShowAnalyzeInput(false)
                    setAnalyzeAddress('')
                  }
                }}
                placeholder="0x address, @user, or URL..."
                className="w-full sm:w-80 pl-3 pr-8 py-1.5 bg-white/[0.02] border border-blue-500/30 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
                autoFocus
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

          {/* Import from Live Discovery */}
          <button
            onClick={handleImportLive}
            disabled={importing}
            className={`px-2.5 py-1.5 bg-white/[0.02] border rounded-lg text-[10px] transition-all flex items-center gap-1.5 ${
              importing
                ? 'border-blue-500/20 text-blue-400 opacity-50 cursor-not-allowed'
                : 'border-white/5 text-gray-500 hover:text-emerald-400 hover:border-emerald-500/20 hover:bg-emerald-500/5'
            }`}
            title="Import wallets from live discovery"
          >
            <svg className={`w-3.5 h-3.5 ${importing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Import
          </button>

          {/* Sync All */}
          <button
            onClick={handleSyncAll}
            disabled={!!syncProgress && !syncDone}
            className={`px-2.5 py-1.5 bg-white/[0.02] border rounded-lg text-[10px] transition-all flex items-center gap-1.5 ${
              syncProgress && !syncDone
                ? 'border-blue-500/20 text-blue-400 opacity-50 cursor-not-allowed'
                : 'border-white/5 text-gray-500 hover:text-blue-400 hover:border-blue-500/20 hover:bg-blue-500/5'
            }`}
            title="Sync all tracked wallets"
          >
            <svg className={`w-3.5 h-3.5 ${syncProgress && !syncDone ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync All
          </button>

          <div className="text-xs text-gray-600">
            <span className="text-gray-400">{wallets.length.toLocaleString()}</span>
            {totalEstimate > wallets.length && (
              <span> of ~{totalEstimate.toLocaleString()}</span>
            )}
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
      <NewWalletTable
        wallets={wallets}
        loading={loading}
        isFetchingMore={isFetchingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        timePeriod={timePeriod}
        onSort={handleSort}
        sortBy={sortBy}
        sortDir={sortDir}
        columnFilters={columnFilters}
        onColumnFilterChange={handleColumnFilterChange}
        visibleColumns={visibleColumns}
        syncingAddress={syncingAddress}
        onSync={handleSyncWallet}
      />

      {/* Scroll status */}
      {wallets.length > 0 && (
        <div className="flex items-center justify-between mt-2 px-1">
          <p className="text-[10px] text-gray-600">
            Showing <span className="text-gray-400">{wallets.length.toLocaleString()}</span>
            {totalEstimate > wallets.length && (
              <> of ~<span className="text-gray-400">{totalEstimate.toLocaleString()}</span></>
            )}
            {' '}traders
          </p>
          {isFetchingMore && (
            <p className="text-[10px] text-gray-500">Loading more...</p>
          )}
        </div>
      )}
    </div>
  )
}
