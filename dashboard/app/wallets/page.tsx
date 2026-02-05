'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Wallet, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletTable, { ColumnKey, COLUMNS, DEFAULT_VISIBLE } from '@/components/WalletTable'

interface WalletStats {
  total: number
  analyzed: number
  live: number
  qualified200: number
  totalBalance: number
  avgBalance: number
  avgAnalyzeSpeed: number
  analyzedPerHour: number
}

interface ColumnFilter {
  min?: number
  max?: number
}

interface Cursor {
  sortValue: string
  address: string
}

interface RefreshProgress {
  total: number
  current: number
  success: number
  failed: number
  address?: string
  username?: string
}

// Helper to get default filters based on time period
const getDefaultFilters = (period: TimePeriod): Record<string, ColumnFilter> => ({
  [`pnl_${period}`]: { min: 700 }
})

// Parse filters from URL search params
const parseFiltersFromURL = (searchParams: URLSearchParams): Record<string, ColumnFilter> => {
  const filters: Record<string, ColumnFilter> = {}
  for (const [key, value] of searchParams.entries()) {
    // Pattern: min_pnl_30d=700, max_win_rate_7d=90
    const match = key.match(/^(min|max)_(.+)$/)
    if (match) {
      const [, type, column] = match
      const numValue = parseFloat(value)
      if (!isNaN(numValue)) {
        filters[column] = filters[column] || {}
        filters[column][type as 'min' | 'max'] = numValue
      }
    }
  }
  return filters
}

// Wrapper component with Suspense for useSearchParams
export default function WalletsPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 rounded-full border border-white/10"></div>
          <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
        </div>
      </div>
    }>
      <WalletsPage />
    </Suspense>
  )
}

function WalletsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Initialize state from URL params or defaults
  const initialPeriod = (searchParams.get('period') as TimePeriod) || '30d'
  const initialSort = searchParams.get('sort') || 'copy_score'
  const initialDir = (searchParams.get('dir') as 'asc' | 'desc') || 'desc'
  const urlFilters = parseFiltersFromURL(searchParams)
  const initialFilters = Object.keys(urlFilters).length > 0 ? urlFilters : getDefaultFilters(initialPeriod)

  const [wallets, setWallets] = useState<Wallet[]>([])
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [isFetchingMore, setIsFetchingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [totalEstimate, setTotalEstimate] = useState(0)
  const [isExactCount, setIsExactCount] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(initialPeriod)
  const [sortBy, setSortBy] = useState(initialSort)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialDir)
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilter>>(initialFilters)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [analyzeAddress, setAnalyzeAddress] = useState('')
  const [showAnalyzeInput, setShowAnalyzeInput] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE)
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [trackedAddresses, setTrackedAddresses] = useState<Set<string>>(new Set())
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null)
  const [refreshDone, setRefreshDone] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set())
  const [reanalyzeProgress, setReanalyzeProgress] = useState<RefreshProgress | null>(null)
  const [reanalyzeDone, setReanalyzeDone] = useState(false)
  const reanalyzeAbortRef = useRef(false)
  const columnSettingsRef = useRef<HTMLDivElement>(null)
  const analyzeInputRef = useRef<HTMLInputElement>(null)


  const startRefreshAll = useCallback(() => {
    if (eventSourceRef.current) return // already running
    setRefreshProgress(null)
    setRefreshDone(false)

    const es = new EventSource('/api/admin/refresh-stream')
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'start') {
          setRefreshProgress({ total: data.total, current: 0, success: 0, failed: 0 })
        } else if (data.type === 'progress') {
          setRefreshProgress({
            total: data.total,
            current: data.current,
            success: data.success,
            failed: data.failed,
            address: data.address,
            username: data.username,
          })
        } else if (data.type === 'done' || data.type === 'error' || data.type === 'aborted') {
          setRefreshDone(true)
          es.close()
          eventSourceRef.current = null
        }
      } catch {}
    }

    es.onerror = () => {
      setRefreshDone(true)
      es.close()
      eventSourceRef.current = null
    }
  }, [])

  const stopRefreshAll = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setRefreshDone(true)
    }
  }, [])

  // When the modal fetches fresh data, update the corresponding wallet row in the table
  const handleWalletUpdate = useCallback((address: string, data: any) => {
    if (!data?.metrics) return
    const m = data.metrics
    const m7d = m.metrics7d || {}
    const m30d = m.metrics30d || {}
    setWallets(prev => prev.map(w => {
      if (w.address !== address) return w
      return {
        ...w,
        balance: m.portfolioValue ?? w.balance,
        overall_pnl: m.totalPnl ?? w.overall_pnl,
        overall_roi: m.roiPercent ?? w.overall_roi,
        overall_win_rate: m.winRateAllTime ?? w.overall_win_rate,
        realized_pnl: m.realizedPnl ?? w.realized_pnl,
        unrealized_pnl: m.unrealizedPnl ?? w.unrealized_pnl,
        active_positions: m.activePositions ?? w.active_positions,
        total_positions: m.totalPositions ?? w.total_positions,
        drawdown_all: m.maxDrawdown ?? w.drawdown_all,
        // 7-day metrics
        pnl_7d: m7d.pnl ?? w.pnl_7d,
        win_rate_7d: m7d.winRate ?? w.win_rate_7d,
        trade_count_7d: m7d.tradeCount ?? w.trade_count_7d,
        drawdown_7d: m7d.drawdown ?? w.drawdown_7d,
        volume_7d: m7d.volume ?? w.volume_7d,
        // 30-day metrics
        pnl_30d: m30d.pnl ?? w.pnl_30d,
        win_rate_30d: m30d.winRate ?? w.win_rate_30d,
        trade_count_30d: m30d.tradeCount ?? w.trade_count_30d,
        drawdown_30d: m30d.drawdown ?? w.drawdown_30d,
        volume_30d: m30d.volume ?? w.volume_30d,
        // Copy metrics
        copy_score: data.copyScore ?? w.copy_score,
        profit_factor_30d: data.copyMetrics?.profitFactor30d ?? w.profit_factor_30d,
        profit_factor_all: data.copyMetrics?.profitFactorAll ?? w.profit_factor_all,
        diff_win_rate_30d: data.copyMetrics?.diffWinRate30d ?? w.diff_win_rate_30d,
        diff_win_rate_all: data.copyMetrics?.diffWinRateAll ?? w.diff_win_rate_all,
        weekly_profit_rate: data.copyMetrics?.weeklyProfitRate ?? w.weekly_profit_rate,
        avg_trades_per_day: data.copyMetrics?.avgTradesPerDay ?? w.avg_trades_per_day,
        // Username update
        ...(data.username && { username: data.username }),
      } as Wallet
    }))
  }, [])

  const handleToggleSelect = useCallback((address: string) => {
    setSelectedAddresses(prev => {
      const next = new Set(prev)
      if (next.has(address)) {
        next.delete(address)
      } else {
        next.add(address)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedAddresses(prev => {
      const allSelected = wallets.length > 0 && wallets.every(w => prev.has(w.address))
      if (allSelected) {
        return new Set()
      }
      return new Set(wallets.map(w => w.address))
    })
  }, [wallets])

  const handleReanalyzeSelected = useCallback(async () => {
    const addresses = Array.from(selectedAddresses)
    if (addresses.length === 0) return

    reanalyzeAbortRef.current = false
    setReanalyzeDone(false)
    setReanalyzeProgress({ total: addresses.length, current: 0, success: 0, failed: 0 })

    let success = 0
    let failed = 0

    for (let i = 0; i < addresses.length; i++) {
      if (reanalyzeAbortRef.current) break

      try {
        const res = await fetch(`/api/admin/refresh-metrics?address=${addresses[i]}`, { method: 'POST' })
        if (res.ok) {
          success++
        } else {
          failed++
        }
      } catch {
        failed++
      }

      setReanalyzeProgress({
        total: addresses.length,
        current: i + 1,
        success,
        failed,
        address: addresses[i],
      })
    }

    setReanalyzeDone(true)
  }, [selectedAddresses])

  const stopReanalyzeSelected = useCallback(() => {
    reanalyzeAbortRef.current = true
  }, [])

  // Load column preferences from localStorage, merging in any new default columns
  // Bump COLUMN_VERSION when adding new columns to DEFAULT_VISIBLE
  const COLUMN_VERSION = 2
  useEffect(() => {
    try {
      const saved = localStorage.getItem('polymarket-visible-columns')
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnKey[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          const savedVersion = parseInt(localStorage.getItem('polymarket-columns-version') || '1')
          if (savedVersion < COLUMN_VERSION) {
            // Merge new default columns that weren't in saved preferences
            const newCols = DEFAULT_VISIBLE.filter(k => !parsed.includes(k))
            const merged = [...parsed, ...newCols]
            localStorage.setItem('polymarket-visible-columns', JSON.stringify(merged))
            localStorage.setItem('polymarket-columns-version', String(COLUMN_VERSION))
            setVisibleColumns(merged)
          } else {
            setVisibleColumns(parsed)
          }
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

    const profileMatch = input.match(/polymarket\.com\/profile\/(0x[a-fA-F0-9]{40})/i)
    if (profileMatch) {
      input = profileMatch[1]
    }

    const usernameMatch = input.match(/polymarket\.com\/@([^/?#]+)/i) || input.match(/^@([^/?#\s]+)$/i)

    const isHexAddress = /^(0x)?[a-fA-F0-9]{40}$/.test(input)
    const isPlainUsername = !isHexAddress && !usernameMatch && !input.includes('polymarket.com') && !/^0x/i.test(input)

    const usernameToResolve = usernameMatch ? usernameMatch[1] : isPlainUsername ? input : null

    if (usernameToResolve) {
      setResolving(true)
      try {
        const res = await fetch(`/api/resolve-username?username=${encodeURIComponent(usernameToResolve)}`)
        const data = await res.json()
        if (data.address) {
          input = data.address
        } else {
          alert(`Could not find wallet for username: ${usernameToResolve}`)
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

    const addr = input.toLowerCase()
    const finalAddr = addr.startsWith('0x') ? addr : `0x${addr}`
    setShowAnalyzeInput(false)
    setAnalyzeAddress('')
    setAnalyzing(true)

    try {
      const params = new URLSearchParams({ refresh: 'true' })
      if (usernameToResolve) params.set('username', usernameToResolve)
      const res = await fetch(`/api/traders/${finalAddr}?${params}`)
      if (!res.ok) throw new Error('Failed to analyze wallet')
      const data = await res.json()
      // Skip wallets with fewer than 15 total trades
      if ((data.metrics?.tradeCountAllTime || 0) < 15) {
        alert(`Wallet skipped: only ${data.metrics?.tradeCountAllTime || 0} trades (minimum 15 required)`)
        return
      }
      // Refresh wallet list to show the new/updated entry
      await fetchWallets(null)
    } catch (error) {
      console.error('Error analyzing wallet:', error)
      alert('Failed to analyze wallet')
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
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

  const checkTrackedBatch = useCallback(async (addresses: string[]) => {
    if (addresses.length === 0) return
    try {
      const res = await fetch('/api/tracked-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_batch', addresses })
      })
      if (!res.ok) return // table may not exist yet
      const data = await res.json()
      if (data.tracked) {
        setTrackedAddresses(prev => {
          const next = new Set(prev)
          for (const addr of data.tracked) next.add(addr)
          return next
        })
      }
    } catch {
      // Silently ignore - tracked_wallets table may not exist yet
    }
  }, [])

  const handleToggleTrack = useCallback(async (address: string) => {
    const isTracked = trackedAddresses.has(address)
    // Optimistic update
    setTrackedAddresses(prev => {
      const next = new Set(prev)
      if (isTracked) {
        next.delete(address)
      } else {
        next.add(address)
      }
      return next
    })

    try {
      const res = await fetch('/api/tracked-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isTracked ? 'remove' : 'add',
          address
        })
      })
      if (!res.ok) {
        // Revert on failure
        setTrackedAddresses(prev => {
          const next = new Set(prev)
          if (isTracked) {
            next.add(address)
          } else {
            next.delete(address)
          }
          return next
        })
      }
    } catch {
      // Revert on failure
      setTrackedAddresses(prev => {
        const next = new Set(prev)
        if (isTracked) {
          next.add(address)
        } else {
          next.delete(address)
        }
        return next
      })
    }
  }, [trackedAddresses])

  const fetchWallets = useCallback(async (cursor?: Cursor | null) => {
    const isInitialLoad = !cursor
    if (isInitialLoad) {
      setLoading(true)
    } else {
      setIsFetchingMore(true)
    }

    try {
      // Convert hold duration filter: UI is in minutes, DB is in hours
      let serializedFilters: string | undefined
      if (Object.keys(columnFilters).length > 0) {
        const apiFilters = { ...columnFilters }
        if (apiFilters['avg_hold_duration_hours']) {
          const f = apiFilters['avg_hold_duration_hours']
          apiFilters['avg_hold_duration_hours'] = {
            ...(f.min !== undefined && { min: f.min / 60 }),
            ...(f.max !== undefined && { max: f.max / 60 }),
          }
        }
        serializedFilters = JSON.stringify(apiFilters)
      }

      const params = new URLSearchParams({
        source: 'all',
        minBalance: '0',
        minWinRate: '0',
        period: timePeriod,
        limit: '100',
        sortBy,
        sortDir,
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
        ...(serializedFilters && { columnFilters: serializedFilters }),
        ...(cursor && {
          cursorSortValue: cursor.sortValue,
          cursorAddress: cursor.address,
        }),
        // Piggyback stats on the initial load to avoid a separate round-trip
        ...(!cursor && { includeStats: 'true' }),
      })

      const res = await fetch(`/api/wallets?${params}`)
      const data = await res.json()

      if (data.wallets) {
        if (isInitialLoad) {
          setWallets(data.wallets)
          // Use piggybacked stats if available (avoids separate round-trip)
          if (data.stats) setStats(data.stats)
          // Check which of these wallets are tracked
          checkTrackedBatch(data.wallets.map((w: any) => w.address))
        } else {
          setWallets(prev => [...prev, ...data.wallets])
          // Check newly loaded wallets
          checkTrackedBatch(data.wallets.map((w: any) => w.address))
        }
        setNextCursor(data.nextCursor)
        setHasMore(data.hasMore)
        setTotalEstimate(data.totalEstimate || 0)
        setIsExactCount(data.isExactCount || false)
      }
    } catch (error) {
      console.error('Error fetching wallets:', error)
    } finally {
      setLoading(false)
      setIsFetchingMore(false)
    }
  }, [timePeriod, sortBy, sortDir, debouncedSearch, columnFilters])

  // Reset and fetch from beginning when filters/sort/search change
  useEffect(() => {
    setWallets([])
    setNextCursor(null)
    setHasMore(true)
    const container = document.querySelector('[data-scroll-container]')
    if (container) container.scrollTop = 0
    fetchWallets(null)
  }, [fetchWallets])

  useEffect(() => {
    // Stats are piggybacked on initial wallet fetch; only call separately as fallback
    if (!stats) fetchStats()
  }, [fetchStats]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload data when refresh-all stream completes
  useEffect(() => {
    if (refreshDone) {
      fetchWallets(null)
      fetchStats()
    }
  }, [refreshDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reload data when reanalyze-selected completes
  useEffect(() => {
    if (reanalyzeDone) {
      fetchWallets(null)
      fetchStats()
      setSelectedAddresses(new Set())
    }
  }, [reanalyzeDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time subscription DISABLED — it caused infinite reload loops:
  // When the modal's background refresh updated a wallet row, the subscription
  // triggered fetchWallets(null) which set loading=true, unmounting the modal.
  // When loading went back to false the modal remounted and refetched, creating a loop.
  // Use the Refresh All button or re-open the page to get fresh data instead.

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  const loadMore = useCallback(() => {
    if (!isFetchingMore && hasMore && nextCursor) {
      fetchWallets(nextCursor)
    }
  }, [isFetchingMore, hasMore, nextCursor, fetchWallets])

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
      // Use strict undefined check to allow min=0 as a valid filter
      if (filter.min === undefined && filter.max === undefined) {
        const { [column]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [column]: filter }
    })
  }

  // Sync state to URL so filters/sort/period are always reflected
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('period', timePeriod)
    params.set('sort', sortBy)
    params.set('dir', sortDir)

    // Add filter params
    for (const [col, filter] of Object.entries(columnFilters)) {
      if (filter.min !== undefined) params.set(`min_${col}`, String(filter.min))
      if (filter.max !== undefined) params.set(`max_${col}`, String(filter.max))
    }

    const newUrl = `/wallets?${params.toString()}`
    const currentParams = new URLSearchParams(window.location.search)
    // Only replace if URL actually changed to avoid unnecessary renders
    if (params.toString() !== currentParams.toString()) {
      router.replace(newUrl, { scroll: false })
    }
  }, [timePeriod, sortBy, sortDir, columnFilters, router])

  const activeFilterCount = Object.keys(columnFilters).length
  const isFiltered = activeFilterCount > 0 || debouncedSearch.trim().length > 0

  const formatMoney = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
    return `$${value.toFixed(0)}`
  }

  return (
    <div className="min-h-screen">
      {/* Refresh All Progress */}
      {refreshProgress && (
        <div className="glass rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {!refreshDone ? (
                <div className="w-4 h-4 rounded-full border-2 border-transparent border-t-blue-400 animate-spin" />
              ) : (
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              <span className="text-sm font-medium text-white">
                {refreshDone ? 'Refresh Complete' : 'Refreshing All Wallets'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-emerald-400">{refreshProgress.success} ok</span>
                {refreshProgress.failed > 0 && (
                  <span className="text-red-400">{refreshProgress.failed} failed</span>
                )}
                <span className="text-gray-500">
                  {refreshProgress.current} / {refreshProgress.total}
                </span>
              </div>
              {!refreshDone ? (
                <button
                  onClick={stopRefreshAll}
                  className="px-2 py-1 text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-md transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => { setRefreshProgress(null); setRefreshDone(false) }}
                  className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 border border-white/10 rounded-md transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${refreshDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${refreshProgress.total > 0 ? (refreshProgress.current / refreshProgress.total) * 100 : 0}%` }}
            />
          </div>
          {/* Current wallet */}
          {!refreshDone && refreshProgress.address && (
            <p className="text-[10px] text-gray-600 mt-1.5 font-mono truncate">
              {refreshProgress.username || refreshProgress.address}
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
                  if (e.key === 'Enter' && analyzeAddress.trim() && !resolving) {
                    resolveAndAnalyze(analyzeAddress)
                  }
                  if (e.key === 'Escape') {
                    setShowAnalyzeInput(false)
                    setAnalyzeAddress('')
                  }
                }}
                placeholder="0x address, @user, or URL..."
                className="w-full sm:w-80 pl-3 pr-8 py-1.5 bg-white/[0.02] border border-blue-500/30 rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
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
              <div
                className="absolute top-full left-0 mt-2 z-50 rounded-lg shadow-2xl p-2 min-w-[160px]"
                style={{ background: 'var(--popover-bg)', border: '1px solid var(--popover-border)' }}
              >
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

          {/* Refresh All */}
          <button
            onClick={startRefreshAll}
            disabled={!!refreshProgress && !refreshDone}
            className={`px-2.5 py-1.5 bg-white/[0.02] border rounded-lg text-[10px] transition-all flex items-center gap-1.5 ${
              refreshProgress && !refreshDone
                ? 'border-blue-500/20 text-blue-400 opacity-50 cursor-not-allowed'
                : 'border-white/5 text-gray-500 hover:text-blue-400 hover:border-blue-500/20 hover:bg-blue-500/5'
            }`}
            title="Re-analyze all wallets"
          >
            <svg className={`w-3.5 h-3.5 ${refreshProgress && !refreshDone ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh All
          </button>

          <div className="text-xs text-gray-600">
            <span className="text-gray-400">{wallets.length.toLocaleString()}</span>
            {totalEstimate > wallets.length && (
              <span> of {isExactCount ? '' : '~'}{totalEstimate.toLocaleString()}</span>
            )}
            {' '}traders
            {isExactCount && totalEstimate > 0 && (
              <span className="text-gray-500 ml-1">(filtered)</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
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
              Clear All
            </button>
          )}
          <button
            onClick={() => {
              setColumnFilters(getDefaultFilters(timePeriod))
              setSearchQuery('')
            }}
            className="text-[10px] text-gray-500 hover:text-blue-400 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
            title="Reset to default filters (min PnL $700)"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Defaults
          </button>
        </div>
      </div>

      {/* Selection Action Bar */}
      {selectedAddresses.size > 0 && (
        <div className="glass rounded-xl p-3 mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">
              {selectedAddresses.size} wallet{selectedAddresses.size !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setSelectedAddresses(new Set())}
              className="text-[10px] text-gray-500 hover:text-white px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            {reanalyzeProgress && !reanalyzeDone ? (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-3.5 h-3.5 rounded-full border border-transparent border-t-blue-400 animate-spin" />
                  <span className="text-gray-400">
                    {reanalyzeProgress.current}/{reanalyzeProgress.total}
                  </span>
                  <span className="text-emerald-400">{reanalyzeProgress.success} ok</span>
                  {reanalyzeProgress.failed > 0 && (
                    <span className="text-red-400">{reanalyzeProgress.failed} fail</span>
                  )}
                </div>
                <button
                  onClick={stopReanalyzeSelected}
                  className="px-2.5 py-1.5 text-[10px] text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-md transition-colors"
                >
                  Stop
                </button>
              </>
            ) : reanalyzeProgress && reanalyzeDone ? (
              <div className="flex items-center gap-2 text-xs">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-400">{reanalyzeProgress.success} refreshed</span>
                {reanalyzeProgress.failed > 0 && (
                  <span className="text-red-400">{reanalyzeProgress.failed} failed</span>
                )}
                <button
                  onClick={() => { setReanalyzeProgress(null); setReanalyzeDone(false) }}
                  className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-300 border border-white/10 rounded-md transition-colors ml-1"
                >
                  Done
                </button>
              </div>
            ) : (
              <button
                onClick={handleReanalyzeSelected}
                className="px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/15 hover:border-blue-500/30 transition-all flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reanalyze Selected
              </button>
            )}
          </div>
        </div>
      )}

      {/* Wallet Table */}
      <WalletTable
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
        trackedAddresses={trackedAddresses}
        onToggleTrack={handleToggleTrack}
        selectedAddresses={selectedAddresses}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
        allSelected={wallets.length > 0 && wallets.every(w => selectedAddresses.has(w.address))}
        onWalletUpdate={handleWalletUpdate}
      />

      {/* Scroll status */}
      {wallets.length > 0 && (
        <div className="flex items-center justify-between mt-2 px-1">
          <p className="text-[10px] text-gray-600">
            Showing <span className="text-gray-400">{wallets.length.toLocaleString()}</span>
            {totalEstimate > wallets.length && (
              <> of <span className="text-gray-400">{totalEstimate.toLocaleString()}</span></>
            )}
            {' '}traders
            {isFiltered && totalEstimate > 0 && (
              <span className="text-gray-500 ml-1">(filtered)</span>
            )}
          </p>
          {isFetchingMore && (
            <p className="text-[10px] text-gray-500">Loading more...</p>
          )}
        </div>
      )}

    </div>
  )
}
