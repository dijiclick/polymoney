'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Wallet, TimePeriod } from '@/lib/supabase'
import TraderDetailModal from './TraderDetailModal'

interface ColumnFilter {
  min?: number
  max?: number
}

export type ColumnKey = 'score' | 'chart' | 'value' | 'winRate' | 'roi' | 'pnl' | 'active' | 'total' | 'dd' | 'medianProfit' | 'avgTrades' | 'bot' | 'category' | 'joined'

export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'chart', label: 'Chart' },
  { key: 'roi', label: 'ROI' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'pnl', label: 'PnL' },
  { key: 'dd', label: 'Drawdown' },
  { key: 'medianProfit', label: 'Med %/Trade' },
  { key: 'active', label: 'Active' },
  { key: 'total', label: 'Total' },
  { key: 'value', label: 'Value' },
  { key: 'avgTrades', label: 'Trades/d' },
  { key: 'bot', label: 'Bot' },
  { key: 'category', label: 'Category' },
  { key: 'joined', label: 'Joined' },
]

export const DEFAULT_VISIBLE: ColumnKey[] = ['score', 'chart', 'roi', 'winRate', 'pnl', 'dd', 'medianProfit', 'active', 'total', 'value', 'avgTrades', 'bot', 'category', 'joined']

// Module-level cache for raw positions data (not filtered by timeframe)
const positionsCache = new Map<string, { resolvedAt?: string; realizedPnl: number }[] | null>()

interface DayData {
  date: Date
  dailyPnl: number
  cumPnl: number
}

function buildDayData(
  closedPositions: { resolvedAt?: string; realizedPnl: number }[],
  timePeriod: TimePeriod
): { values: number[]; isPositive: boolean } | null {
  const withDates = closedPositions
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (withDates.length === 0) return null

  // Calculate cutoff based on timeframe
  const now = Date.now()
  let cutoff = 0
  if (timePeriod === '7d') {
    cutoff = now - 7 * 24 * 60 * 60 * 1000
  } else if (timePeriod === '30d') {
    cutoff = now - 30 * 24 * 60 * 60 * 1000
  }
  // 'all' = no cutoff

  const dayMap = new Map<string, { date: Date; dailyPnl: number }>()

  for (const p of withDates) {
    const d = new Date(p.resolvedAt!)
    const ts = d.getTime()

    if (cutoff > 0 && ts < cutoff) {
      // Skip positions before the selected period
    } else {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const existing = dayMap.get(key)
      if (existing) {
        existing.dailyPnl += p.realizedPnl
      } else {
        dayMap.set(key, { date: d, dailyPnl: p.realizedPnl })
      }
    }
  }

  const allDays = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime())

  if (allDays.length < 2) return null

  let cum = 0
  const values = allDays.map(day => {
    cum += day.dailyPnl
    return Math.round(cum * 100) / 100
  })

  const isPositive = values[values.length - 1] >= 0
  return { values, isPositive }
}

// Inline mini sparkline chart
function InlineMiniChart({ address, timePeriod }: { address: string; timePeriod: TimePeriod }) {
  const [positions, setPositions] = useState<{ resolvedAt?: string; realizedPnl: number }[] | null | undefined>(
    positionsCache.has(address) ? positionsCache.get(address) : undefined
  )
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasFetched = useRef(false)

  useEffect(() => {
    if (hasFetched.current || positions !== undefined) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasFetched.current) {
          hasFetched.current = true
          observer.disconnect()

          setLoading(true)
          fetch(`/api/traders/${address}?refresh=false`)
            .then(res => res.ok ? res.json() : null)
            .then(result => {
              if (result?.closedPositions) {
                positionsCache.set(address, result.closedPositions)
                setPositions(result.closedPositions)
              } else {
                positionsCache.set(address, null)
                setPositions(null)
              }
            })
            .catch(() => {
              positionsCache.set(address, null)
              setPositions(null)
            })
            .finally(() => setLoading(false))
        }
      },
      { threshold: 0.1 }
    )

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    return () => observer.disconnect()
  }, [address, positions])

  // Build chart data based on current timeframe
  const chartData = positions ? buildDayData(positions, timePeriod) : null

  const W = 80
  const H = 24

  if (loading) {
    return (
      <div ref={containerRef} className="w-20 h-6 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full border border-white/10 border-t-white/30 animate-spin" />
      </div>
    )
  }

  if (!chartData || chartData.values.length < 2) {
    return <div ref={containerRef} className="w-20 h-6 flex items-center justify-center text-[9px] text-gray-600">-</div>
  }

  const { values, isPositive } = chartData
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - 2 - ((v - min) / range) * (H - 4)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const strokeColor = isPositive ? '#34d399' : '#f87171'

  return (
    <div ref={containerRef} className="w-20 h-6">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

interface TrackedWalletMeta {
  last_refreshed_at: string | null
  added_at: string
}

interface Props {
  wallets: Wallet[]
  loading: boolean
  isFetchingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  timePeriod: TimePeriod
  onSort?: (column: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  columnFilters?: Record<string, ColumnFilter>
  onColumnFilterChange?: (column: string, filter: ColumnFilter) => void
  visibleColumns?: ColumnKey[]
  // Track feature props
  trackedAddresses?: Set<string>
  onToggleTrack?: (address: string) => void
  trackMode?: boolean
  trackedWalletMeta?: Map<string, TrackedWalletMeta>
  onRemoveTracked?: (address: string) => void
  refreshingAddresses?: Set<string>
  // Selection feature props
  selectedAddresses?: Set<string>
  onToggleSelect?: (address: string) => void
  onSelectAll?: () => void
  allSelected?: boolean
}

function FilterPopover({
  column,
  label,
  filter,
  onChange,
  onClose,
  type = 'number'
}: {
  column: string
  label: string
  filter?: ColumnFilter
  onChange: (filter: ColumnFilter) => void
  onClose: () => void
  type?: 'number' | 'percent' | 'money'
}) {
  const [min, setMin] = useState(filter?.min?.toString() || '')
  const [max, setMax] = useState(filter?.max?.toString() || '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleApply = () => {
    onChange({
      min: min ? parseFloat(min) : undefined,
      max: max ? parseFloat(max) : undefined
    })
    onClose()
  }

  const handleClear = () => {
    setMin('')
    setMax('')
    onChange({})
    onClose()
  }

  const prefix = type === 'money' ? '$' : ''
  const suffix = type === 'percent' ? '%' : ''

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-2 z-50 bg-[#12121a] border border-white/10 rounded-lg shadow-2xl p-3 min-w-[180px] max-w-[calc(100vw-2rem)]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[10px] font-medium text-gray-500 mb-2.5 uppercase tracking-wider">{label}</div>
      <div className="space-y-2.5">
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block">Min</label>
          <div className="relative">
            {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{prefix}</span>}
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder="No min"
              className={`w-full bg-white/[0.03] border border-white/5 rounded-md py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors ${prefix ? 'pl-5' : 'pl-2.5'} ${suffix ? 'pr-5' : 'pr-2.5'}`}
            />
            {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{suffix}</span>}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block">Max</label>
          <div className="relative">
            {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{prefix}</span>}
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder="No max"
              className={`w-full bg-white/[0.03] border border-white/5 rounded-md py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors ${prefix ? 'pl-5' : 'pl-2.5'} ${suffix ? 'pr-5' : 'pr-2.5'}`}
            />
            {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{suffix}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={handleClear}
            className="flex-1 px-2 py-1 text-[10px] text-gray-500 hover:text-white rounded-md hover:bg-white/5 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleApply}
            className="flex-1 px-2 py-1 text-[10px] text-white bg-white/10 rounded-md hover:bg-white/15 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WalletTable({
  wallets,
  loading,
  isFetchingMore = false,
  hasMore = false,
  onLoadMore,
  timePeriod,
  onSort,
  sortBy,
  sortDir,
  columnFilters = {},
  onColumnFilterChange,
  visibleColumns = DEFAULT_VISIBLE,
  trackedAddresses,
  onToggleTrack,
  trackMode = false,
  trackedWalletMeta,
  onRemoveTracked,
  refreshingAddresses,
  selectedAddresses,
  onToggleSelect,
  onSelectAll,
  allSelected = false,
}: Props) {
  const show = (key: ColumnKey) => visibleColumns.includes(key)
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [selectedTrader, setSelectedTrader] = useState<Wallet | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: wallets.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 48,
    overscan: 15,
  })

  // Keep a stable ref to virtualizer so measureRef doesn't change identity each render
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  // Defer measureElement to avoid flushSync-during-render warning
  const measureRef = useCallback((node: HTMLElement | null) => {
    if (!node) return
    requestAnimationFrame(() => {
      virtualizerRef.current.measureElement(node)
    })
  }, [])

  // Infinite scroll: trigger loadMore when near bottom
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !onLoadMore || !hasMore || isFetchingMore) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 500) {
        onLoadMore()
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [onLoadMore, hasMore, isFetchingMore])

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const isAddressLikeUsername = (username: string | undefined | null) => {
    if (!username) return false
    return username.startsWith('0x') && username.length > 20
  }

  const getDisplayName = (wallet: Wallet) => {
    if (!wallet.username || isAddressLikeUsername(wallet.username)) {
      return formatAddress(wallet.address)
    }
    return wallet.username
  }

  const formatMoney = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '-'
    const absValue = Math.abs(value)
    if (absValue >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (absValue >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatPercent = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
  }

  const formatPercentPlain = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '-'
    return `${value.toFixed(1)}%`
  }

  const getPnlColor = (value: number | undefined) => {
    if (value === undefined || value === 0) return 'text-gray-400'
    return value > 0 ? 'text-emerald-400' : 'text-red-400'
  }

  const getDrawdownColor = (value: number | undefined) => {
    if (value === undefined || value === null || value === 0) return 'text-gray-500'
    if (value <= 10) return 'text-emerald-400'
    if (value <= 25) return 'text-amber-400'
    return 'text-red-400'
  }

  const getWinRateColor = (value: number | undefined) => {
    if (value === undefined || value === null) return 'text-gray-400'
    if (value >= 60) return 'text-emerald-400'
    if (value >= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  const getCategoryStyle = (category: string) => {
    switch (category) {
      case 'Sports': return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'Crypto': return 'bg-purple-500/10 text-purple-400 border-purple-500/20'
      case 'Politics': return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'Tech': case 'AI': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
      case 'Finance': case 'Business': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      case 'Pop Culture': case 'Entertainment': return 'bg-pink-500/10 text-pink-400 border-pink-500/20'
      case 'Science': case 'Health': return 'bg-teal-500/10 text-teal-400 border-teal-500/20'
      case 'World': case 'Geopolitics': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      default: return 'bg-white/5 text-gray-400 border-white/10'
    }
  }

  const getShortCategory = (category: string) => {
    switch (category) {
      case 'Pop Culture': return 'Pop'
      case 'Entertainment': return 'Ent'
      case 'Politics': return 'Pol'
      case 'Geopolitics': return 'Geo'
      case 'Finance': return 'Fin'
      case 'Business': return 'Biz'
      case 'Science': return 'Sci'
      default: return category
    }
  }

  const formatRelativeTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'never'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const getMetric = (wallet: Wallet, metric: string): number => {
    const suffix = timePeriod === 'all' ? '_all' : timePeriod === '30d' ? '_30d' : '_7d'
    return (wallet as any)[metric + suffix] || 0
  }

  const getColumnName = (base: string) => {
    if (timePeriod === 'all') return `${base}_all`
    return timePeriod === '30d' ? `${base}_30d` : `${base}_7d`
  }

  const hasFilter = (column: string) => {
    const f = columnFilters[column]
    return f && (f.min !== undefined || f.max !== undefined)
  }

  const SortHeader = ({
    column,
    label,
    align = 'right',
    filterType = 'number'
  }: {
    column: string
    label: string
    align?: 'left' | 'right' | 'center'
    filterType?: 'number' | 'percent' | 'money'
  }) => {
    const isActive = sortBy === column
    const isFilterOpen = openFilter === column
    const hasActiveFilter = hasFilter(column)

    return (
      <th
        className={`px-3 py-2.5 font-medium relative text-[11px] uppercase tracking-wider
          ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}
          ${isActive ? 'text-white' : 'text-gray-500'}`}
      >
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => setOpenFilter(isFilterOpen ? null : column)}
            className={`p-0.5 rounded hover:bg-white/5 transition-colors ${hasActiveFilter ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
            title="Filter"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          <button
            onClick={() => onSort?.(column)}
            className="cursor-pointer select-none hover:text-white transition-colors flex items-center gap-0.5"
          >
            {label}
            <span className={`transition-opacity text-[10px] ${isActive ? 'opacity-100' : 'opacity-0'}`}>
              {sortDir === 'asc' ? '↑' : '↓'}
            </span>
          </button>
        </div>
        {isFilterOpen && onColumnFilterChange && (
          <FilterPopover
            column={column}
            label={label}
            filter={columnFilters[column]}
            onChange={(f) => onColumnFilterChange(column, f)}
            onClose={() => setOpenFilter(null)}
            type={filterType}
          />
        )}
      </th>
    )
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-10">
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full border border-white/10"></div>
            <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
          </div>
          <p className="text-gray-600 mt-3 text-xs">Loading...</p>
        </div>
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="glass rounded-xl p-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.02] mb-3">
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-gray-500 text-sm">No wallets found</p>
        <p className="text-gray-600 text-xs mt-1">Try adjusting your filters</p>
      </div>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="overflow-auto"
        data-scroll-container
        style={{ maxHeight: 'calc(100vh - 240px)' }}
      >
        <table className="w-full min-w-[800px]">
          <thead className="sticky top-0 z-20" style={{ background: 'var(--background)' }}>
            <tr className="border-b border-white/5">
              {onToggleSelect && (
                <th className="px-2 py-2.5 w-8">
                  <button
                    onClick={onSelectAll}
                    className="flex items-center justify-center"
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  >
                    <div className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors cursor-pointer ${
                      allSelected
                        ? 'border-blue-500/50 bg-blue-500/20'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}>
                      {allSelected && (
                        <svg className="w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                </th>
              )}
              <th className="px-2 py-2.5 text-left text-gray-500 font-medium text-[11px] uppercase tracking-wider">Trader</th>
              {show('score') && <SortHeader column="copy_score" label="Score" filterType="number" />}
              {show('chart') && <th className="px-1 py-2.5 text-center text-gray-500 font-medium text-[11px] uppercase tracking-wider w-20">Chart</th>}
              {show('roi') && <SortHeader column={getColumnName('roi')} label="ROI" filterType="percent" />}
              {show('winRate') && <SortHeader column={getColumnName('win_rate')} label="Win Rate" filterType="percent" />}
              {show('pnl') && <SortHeader column={getColumnName('pnl')} label="PnL" filterType="money" />}
              {show('dd') && <SortHeader column={getColumnName('drawdown')} label="DD" filterType="percent" />}
              {show('medianProfit') && <SortHeader column="median_profit_pct" label="Med %/T" filterType="percent" />}
              {show('active') && <SortHeader column="active_positions" label="Active" align="center" filterType="number" />}
              {show('total') && <SortHeader column={getColumnName('trade_count')} label="Total" align="center" filterType="number" />}
              {show('value') && <SortHeader column="balance" label="Value" filterType="money" />}
              {show('avgTrades') && <SortHeader column="avg_trades_per_day" label="Trades/d" filterType="number" />}
              {show('bot') && <th className="px-2 py-2.5 text-center text-gray-500 font-medium text-[11px] uppercase tracking-wider w-12">Bot</th>}
              {show('category') && <th className="px-2 py-2.5 text-left text-gray-500 font-medium text-[11px] uppercase tracking-wider w-16">Cat</th>}
              {show('joined') && <SortHeader column="account_created_at" label="Joined" filterType="number" />}
              {trackMode && (
                <>
                  <th className="px-3 py-2.5 text-right text-gray-500 font-medium text-[11px] uppercase tracking-wider">Updated</th>
                  <th className="px-3 py-2.5 text-center text-gray-500 font-medium text-[11px] uppercase tracking-wider w-10"></th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {/* Top spacer for virtual scroll */}
            {virtualRows.length > 0 && virtualRows[0].start > 0 && (
              <tr><td colSpan={99} style={{ height: virtualRows[0].start, padding: 0, border: 'none' }} /></tr>
            )}
            {virtualRows.map((virtualRow) => {
              const wallet = wallets[virtualRow.index]
              const index = virtualRow.index
              const pnl = getMetric(wallet, 'pnl')
              const roi = getMetric(wallet, 'roi')
              const drawdown = getMetric(wallet, 'drawdown')
              const winRate = getMetric(wallet, 'win_rate')

              const formatCreatedDate = (dateStr: string | undefined) => {
                if (!dateStr) return '-'
                const date = new Date(dateStr)
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                return `${months[date.getMonth()]} ${date.getFullYear()}`
              }

              return (
                <tr
                  key={wallet.address}
                  data-index={virtualRow.index}
                  ref={measureRef}
                  className="group hover:bg-white/[0.02] transition-colors border-b border-white/[0.02]"
                >
                  {onToggleSelect && (
                    <td className="px-2 py-2.5 w-8">
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleSelect(wallet.address) }}
                        className="flex items-center justify-center"
                      >
                        <div className={`w-4 h-4 rounded-sm border flex items-center justify-center transition-colors cursor-pointer ${
                          selectedAddresses?.has(wallet.address)
                            ? 'border-blue-500/50 bg-blue-500/20'
                            : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                        }`}>
                          {selectedAddresses?.has(wallet.address) && (
                            <svg className="w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    </td>
                  )}
                  <td className="px-2 py-2.5 max-w-[160px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setSelectedTrader(wallet)}
                        className="w-5 h-5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] flex-shrink-0 flex items-center justify-center text-[9px] font-medium text-gray-500 hover:text-white transition-all cursor-pointer"
                        title="View details"
                      >
                        {index + 1}
                      </button>
                      {onToggleTrack && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleTrack(wallet.address) }}
                          className={`flex-shrink-0 p-0.5 rounded transition-all ${
                            trackedAddresses?.has(wallet.address)
                              ? 'text-amber-400 hover:text-amber-300'
                              : 'text-gray-600 opacity-0 group-hover:opacity-100 hover:text-amber-400'
                          }`}
                          title={trackedAddresses?.has(wallet.address) ? 'Untrack wallet' : 'Track wallet'}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill={trackedAddresses?.has(wallet.address) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                          </svg>
                        </button>
                      )}
                      <div className="flex flex-col min-w-0">
                          <a
                            href={`https://polymarket.com/profile/${wallet.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-gray-300 hover:text-white transition-colors flex items-center gap-1 truncate"
                          >
                            <span className="truncate">{getDisplayName(wallet)}</span>
                            <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        {wallet.metrics_updated_at && (
                          <span className="text-[9px] text-gray-600 leading-tight">{formatRelativeTime(wallet.metrics_updated_at)}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  {show('score') && (() => {
                    const score = wallet.copy_score || 0
                    const scoreInt = Math.round(score)
                    let scoreBg: string, scoreText: string
                    if (scoreInt >= 80) {
                      scoreBg = 'bg-amber-500/20 border border-amber-500/30'
                      scoreText = 'text-amber-300'
                    } else if (scoreInt >= 60) {
                      scoreBg = 'bg-emerald-500/15 border border-emerald-500/25'
                      scoreText = 'text-emerald-400'
                    } else if (scoreInt >= 40) {
                      scoreBg = 'bg-blue-500/10 border border-blue-500/20'
                      scoreText = 'text-blue-400'
                    } else {
                      scoreBg = 'bg-white/[0.04] border border-white/[0.06]'
                      scoreText = 'text-gray-500'
                    }
                    return (
                      <td className="px-2 py-2.5 text-center">
                        <span className={`text-sm font-extrabold tabular-nums inline-flex items-center justify-center w-10 h-6 rounded-md ${scoreBg} ${scoreText}`}>
                          {scoreInt}
                        </span>
                      </td>
                    )
                  })()}
                  {show('chart') && (
                    <td className="px-1 py-2.5">
                      <InlineMiniChart address={wallet.address} timePeriod={timePeriod} />
                    </td>
                  )}
                  {show('roi') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs font-medium tabular-nums inline-block px-1.5 py-0.5 rounded ${
                        roi > 0 ? 'bg-emerald-500/10' : roi < 0 ? 'bg-red-500/10' : ''
                      } ${getPnlColor(roi)}`}>
                        {formatPercent(roi)}
                      </span>
                    </td>
                  )}
                  {show('winRate') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs font-medium tabular-nums inline-block px-1.5 py-0.5 rounded ${
                        winRate >= 60 ? 'bg-emerald-500/10' : winRate >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10'
                      } ${getWinRateColor(winRate)}`}>
                        {formatPercentPlain(winRate)}
                      </span>
                    </td>
                  )}
                  {show('pnl') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs tabular-nums inline-block px-1.5 py-0.5 rounded ${
                        pnl > 0 ? 'bg-emerald-500/10' : pnl < 0 ? 'bg-red-500/10' : ''
                      } ${getPnlColor(pnl)}`}>
                        {formatMoney(pnl)}
                      </span>
                    </td>
                  )}
                  {show('dd') && (
                    <td className="px-3 py-2.5 text-right">
                      {drawdown > 0 ? (
                        <span
                          className={`text-xs font-medium tabular-nums inline-block px-1.5 py-0.5 rounded cursor-default ${
                            drawdown <= 10 ? 'bg-emerald-500/10' : drawdown <= 25 ? 'bg-amber-500/10' : 'bg-red-500/10'
                          } ${getDrawdownColor(drawdown)}`}
                          title={`Max drawdown: ${formatMoney(wallet.drawdown_amount_all)}`}
                        >
                          {formatPercentPlain(drawdown)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">-</span>
                      )}
                    </td>
                  )}
                  {show('medianProfit') && (
                    <td className="px-3 py-2.5 text-right">
                      {wallet.median_profit_pct != null ? (
                        <span className={`text-xs font-medium tabular-nums inline-block px-1.5 py-0.5 rounded ${
                          wallet.median_profit_pct > 0 ? 'bg-emerald-500/10' : wallet.median_profit_pct < 0 ? 'bg-red-500/10' : ''
                        } ${getPnlColor(wallet.median_profit_pct)}`}>
                          {wallet.median_profit_pct > 0 ? '+' : ''}{Math.round(wallet.median_profit_pct)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">-</span>
                      )}
                    </td>
                  )}
                  {show('active') && (
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs tabular-nums ${(wallet.active_positions || 0) > 0 ? 'text-gray-300' : 'text-gray-600'}`}>
                        {wallet.active_positions || 0}
                      </span>
                    </td>
                  )}
                  {show('total') && (
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-gray-400 text-xs tabular-nums">
                        {getMetric(wallet, 'trade_count') || 0}
                      </span>
                    </td>
                  )}
                  {show('value') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-300 text-xs tabular-nums font-medium">{formatMoney(wallet.balance)}</span>
                    </td>
                  )}
                  {show('avgTrades') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-400 text-xs tabular-nums">
                        {(wallet.avg_trades_per_day || 0).toFixed(1)}/d
                      </span>
                    </td>
                  )}
                  {show('bot') && (
                    <td className="px-2 py-2.5 text-center">
                      {wallet.is_bot ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/25 text-purple-400 font-medium">BOT</span>
                      ) : (
                        <span className="text-gray-600 text-[9px]">-</span>
                      )}
                    </td>
                  )}
                  {show('category') && (
                    <td className="px-2 py-2.5 text-left w-16">
                      {(wallet as any).top_category ? (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getCategoryStyle((wallet as any).top_category)}`}>
                          {getShortCategory((wallet as any).top_category)}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-[9px]">-</span>
                      )}
                    </td>
                  )}
                  {show('joined') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-500 text-xs tabular-nums">
                        {formatCreatedDate(wallet.account_created_at)}
                      </span>
                    </td>
                  )}
                  {trackMode && trackedWalletMeta && (() => {
                    const meta = trackedWalletMeta.get(wallet.address)
                    const isRefreshing = refreshingAddresses?.has(wallet.address)
                    return (
                      <>
                        <td className="px-3 py-2.5 text-right">
                          <span className={`text-xs tabular-nums ${meta?.last_refreshed_at ? 'text-gray-400' : 'text-gray-600'}`}>
                            {formatRelativeTime(meta?.last_refreshed_at)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {isRefreshing ? (
                            <div className="inline-flex items-center justify-center w-5 h-5">
                              <div className="w-3.5 h-3.5 rounded-full border border-white/10 border-t-white/40 animate-spin" />
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRemoveTracked?.(wallet.address) }}
                              className="p-1 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                              title="Remove from tracking"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </>
                    )
                  })()}
                </tr>
              )
            })}
            {/* Bottom spacer for virtual scroll */}
            {virtualRows.length > 0 && (
              <tr>
                <td
                  colSpan={99}
                  style={{
                    height: totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0),
                    padding: 0,
                    border: 'none',
                  }}
                />
              </tr>
            )}
            {/* Loading indicator for infinite scroll */}
            {isFetchingMore && (
              <tr>
                <td colSpan={99} className="py-4 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-white/10 border-t-white/40 animate-spin" />
                    <span className="text-xs text-gray-500">Loading more...</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Trader Detail Modal */}
      <TraderDetailModal
        address={selectedTrader?.address || ''}
        username={selectedTrader?.username}
        walletData={selectedTrader || undefined}
        isOpen={!!selectedTrader}
        onClose={() => setSelectedTrader(null)}
      />
    </div>
  )
}
