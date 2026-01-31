'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TimePeriod } from '@/lib/supabase'
import NewTraderModal from './NewTraderModal'

interface ColumnFilter {
  min?: number
  max?: number
}

export type ColumnKey = 'chart' | 'roi' | 'winRate' | 'pnl' | 'dd' | 'profitFactor' | 'open' | 'closed' | 'volume' | 'avgHold' | 'synced'

export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'chart', label: 'Chart' },
  { key: 'roi', label: 'ROI' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'pnl', label: 'PnL' },
  { key: 'dd', label: 'DD' },
  { key: 'profitFactor', label: 'PF' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'volume', label: 'Volume' },
  { key: 'avgHold', label: 'Avg Hold' },
  { key: 'synced', label: 'Synced' },
]

export const DEFAULT_VISIBLE: ColumnKey[] = ['chart', 'roi', 'winRate', 'pnl', 'dd', 'profitFactor', 'open', 'closed', 'volume', 'avgHold', 'synced']

// Mini sparkline chart built from trade PnL data
function InlineMiniChart({ address, timePeriod }: { address: string; timePeriod: TimePeriod }) {
  const [chartData, setChartData] = useState<{ values: number[]; isPositive: boolean } | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasFetched = useRef(false)

  useEffect(() => {
    if (hasFetched.current || chartData !== undefined) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasFetched.current) {
          hasFetched.current = true
          observer.disconnect()

          setLoading(true)
          fetch(`/api/new/wallets/${address}`)
            .then(res => res.ok ? res.json() : null)
            .then(result => {
              if (result?.trades) {
                const data = buildChartFromTrades(result.trades, timePeriod)
                setChartData(data)
              } else {
                setChartData(null)
              }
            })
            .catch(() => setChartData(null))
            .finally(() => setLoading(false))
        }
      },
      { threshold: 0.1 }
    )

    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [address, chartData, timePeriod])

  const W = 80, H = 24

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
        <polyline points={points} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function buildChartFromTrades(trades: { closed: boolean; pnl: number; close_timestamp: string | null }[], timePeriod: TimePeriod) {
  const closedTrades = trades
    .filter((t: { closed: boolean; close_timestamp: string | null }) => t.closed && t.close_timestamp)
    .sort((a: { close_timestamp: string | null }, b: { close_timestamp: string | null }) => new Date(a.close_timestamp!).getTime() - new Date(b.close_timestamp!).getTime())

  if (closedTrades.length === 0) return null

  const now = Date.now()
  let cutoff = 0
  if (timePeriod === '7d') cutoff = now - 7 * 24 * 60 * 60 * 1000
  else if (timePeriod === '30d') cutoff = now - 30 * 24 * 60 * 60 * 1000

  const dayMap = new Map<string, number>()
  for (const t of closedTrades) {
    const d = new Date(t.close_timestamp!)
    if (cutoff > 0 && d.getTime() < cutoff) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dayMap.set(key, (dayMap.get(key) || 0) + Number(t.pnl))
  }

  const days = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  if (days.length < 2) return null

  let cum = 0
  const values = days.map(([, dailyPnl]) => {
    cum += dailyPnl
    return Math.round(cum * 100) / 100
  })

  return { values, isPositive: values[values.length - 1] >= 0 }
}

export interface WalletRow {
  address: string
  username: string | null
  total_pnl: number
  total_roi: number
  win_rate: number
  open_trade_count: number
  closed_trade_count: number
  total_volume_bought: number
  total_volume_sold: number
  avg_hold_duration_hours: number | null
  profit_factor: number
  drawdown_all: number
  pnl_7d: number; roi_7d: number; win_rate_7d: number; volume_7d: number; trade_count_7d: number; drawdown_7d: number
  pnl_30d: number; roi_30d: number; win_rate_30d: number; volume_30d: number; trade_count_30d: number; drawdown_30d: number
  last_synced_at: string | null
}

interface Props {
  wallets: WalletRow[]
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
  syncingAddress?: string | null
  onSync?: (address: string) => void
}

function FilterPopover({
  column, label, filter, onChange, onClose, type = 'number'
}: {
  column: string; label: string; filter?: ColumnFilter
  onChange: (filter: ColumnFilter) => void; onClose: () => void
  type?: 'number' | 'percent' | 'money'
}) {
  const [min, setMin] = useState(filter?.min?.toString() || '')
  const [max, setMax] = useState(filter?.max?.toString() || '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleApply = () => {
    onChange({ min: min ? parseFloat(min) : undefined, max: max ? parseFloat(max) : undefined })
    onClose()
  }

  const handleClear = () => { setMin(''); setMax(''); onChange({}); onClose() }

  const prefix = type === 'money' ? '$' : ''
  const suffix = type === 'percent' ? '%' : ''

  return (
    <div ref={ref} className="absolute top-full left-0 mt-2 z-50 bg-[#12121a] border border-white/10 rounded-lg shadow-2xl p-3 min-w-[180px] max-w-[calc(100vw-2rem)]" onClick={(e) => e.stopPropagation()}>
      <div className="text-[10px] font-medium text-gray-500 mb-2.5 uppercase tracking-wider">{label}</div>
      <div className="space-y-2.5">
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block">Min</label>
          <div className="relative">
            {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{prefix}</span>}
            <input type="number" value={min} onChange={(e) => setMin(e.target.value)} placeholder="No min"
              className={`w-full bg-white/[0.03] border border-white/5 rounded-md py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors ${prefix ? 'pl-5' : 'pl-2.5'} ${suffix ? 'pr-5' : 'pr-2.5'}`} />
            {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{suffix}</span>}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block">Max</label>
          <div className="relative">
            {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{prefix}</span>}
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="No max"
              className={`w-full bg-white/[0.03] border border-white/5 rounded-md py-1.5 text-xs text-white focus:border-white/20 focus:outline-none transition-colors ${prefix ? 'pl-5' : 'pl-2.5'} ${suffix ? 'pr-5' : 'pr-2.5'}`} />
            {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">{suffix}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 pt-1">
          <button onClick={handleClear} className="flex-1 px-2 py-1 text-[10px] text-gray-500 hover:text-white rounded-md hover:bg-white/5 transition-colors">Clear</button>
          <button onClick={handleApply} className="flex-1 px-2 py-1 text-[10px] text-white bg-white/10 rounded-md hover:bg-white/15 transition-colors">Apply</button>
        </div>
      </div>
    </div>
  )
}

export default function NewWalletTable({
  wallets, loading, isFetchingMore = false, hasMore = false, onLoadMore,
  timePeriod, onSort, sortBy, sortDir, columnFilters = {}, onColumnFilterChange,
  visibleColumns = DEFAULT_VISIBLE, syncingAddress, onSync,
}: Props) {
  const show = (key: ColumnKey) => visibleColumns.includes(key)
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: wallets.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 48,
    overscan: 15,
  })

  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  const measureRef = useCallback((node: HTMLElement | null) => {
    if (!node) return
    requestAnimationFrame(() => { virtualizerRef.current.measureElement(node) })
  }, [])

  // Infinite scroll
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !onLoadMore || !hasMore || isFetchingMore) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 500) onLoadMore()
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [onLoadMore, hasMore, isFetchingMore])

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`
  const isAddressLikeUsername = (username: string | null | undefined) => username ? username.startsWith('0x') && username.length > 20 : false
  const getDisplayName = (wallet: WalletRow) => !wallet.username || isAddressLikeUsername(wallet.username) ? formatAddress(wallet.address) : wallet.username

  const formatMoney = (value: number | null | undefined) => {
    if (value === undefined || value === null) return '-'
    const abs = Math.abs(value)
    if (abs >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (abs >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatPercent = (value: number | null | undefined) => {
    if (value === undefined || value === null) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
  }

  const formatPercentPlain = (value: number | null | undefined) => {
    if (value === undefined || value === null) return '-'
    return `${value.toFixed(1)}%`
  }

  const formatDuration = (hours: number | null | undefined) => {
    if (hours === null || hours === undefined) return '-'
    if (hours < 1) return `${Math.round(hours * 60)}m`
    if (hours < 24) return `${hours.toFixed(1)}h`
    const days = hours / 24
    if (days < 30) return `${days.toFixed(1)}d`
    return `${(days / 30).toFixed(1)}mo`
  }

  const formatRelative = (isoString: string | null) => {
    if (!isoString) return 'never'
    const diff = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  const getPnlColor = (value: number | undefined) => {
    if (value === undefined || value === 0) return 'text-gray-400'
    return value > 0 ? 'text-emerald-400' : 'text-red-400'
  }

  const getWinRateColor = (value: number | undefined) => {
    if (value === undefined || value === null) return 'text-gray-400'
    if (value >= 60) return 'text-emerald-400'
    if (value >= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  const getDrawdownColor = (value: number | undefined) => {
    if (value === undefined || value === null || value === 0) return 'text-gray-500'
    if (value <= 10) return 'text-emerald-400'
    if (value <= 25) return 'text-amber-400'
    return 'text-red-400'
  }

  const getMetric = (wallet: WalletRow, metric: string): number => {
    if (timePeriod === 'all') {
      const allMap: Record<string, string> = {
        pnl: 'total_pnl', roi: 'total_roi', win_rate: 'win_rate',
        volume: 'total_volume_bought', trade_count: 'closed_trade_count', drawdown: 'drawdown_all',
      }
      return (wallet as unknown as Record<string, unknown>)[allMap[metric] || metric] as number || 0
    }
    const suffix = timePeriod === '30d' ? '_30d' : '_7d'
    return (wallet as unknown as Record<string, unknown>)[metric + suffix] as number || 0
  }

  const getColumnName = (base: string) => {
    if (timePeriod === 'all') {
      const allMap: Record<string, string> = {
        pnl: 'total_pnl', roi: 'total_roi', win_rate: 'win_rate',
        volume: 'total_volume_bought', trade_count: 'closed_trade_count', drawdown: 'drawdown_all',
      }
      return allMap[base] || base
    }
    return timePeriod === '30d' ? `${base}_30d` : `${base}_7d`
  }

  const hasFilter = (column: string) => {
    const f = columnFilters[column]
    return f && (f.min !== undefined || f.max !== undefined)
  }

  const SortHeader = ({ column, label, filterType = 'number' }: {
    column: string; label: string; filterType?: 'number' | 'percent' | 'money'
  }) => {
    const isActive = sortBy === column
    const isFilterOpen = openFilter === column
    const hasActiveFilter = hasFilter(column)

    return (
      <th className={`px-3 py-2.5 font-medium relative text-right text-[11px] uppercase tracking-wider ${isActive ? 'text-white' : 'text-gray-500'}`}>
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => setOpenFilter(isFilterOpen ? null : column)}
            className={`p-0.5 rounded hover:bg-white/5 transition-colors ${hasActiveFilter ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
            title="Filter">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          <button onClick={() => onSort?.(column)} className="cursor-pointer select-none hover:text-white transition-colors flex items-center gap-0.5">
            {label}
            <span className={`transition-opacity text-[10px] ${isActive ? 'opacity-100' : 'opacity-0'}`}>
              {sortDir === 'asc' ? '\u2191' : '\u2193'}
            </span>
          </button>
        </div>
        {isFilterOpen && onColumnFilterChange && (
          <FilterPopover column={column} label={label} filter={columnFilters[column]}
            onChange={(f) => onColumnFilterChange(column, f)} onClose={() => setOpenFilter(null)} type={filterType} />
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
        <p className="text-gray-600 text-xs mt-1">Import wallets from live discovery or add one manually</p>
      </div>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div ref={scrollContainerRef} className="overflow-auto" data-scroll-container style={{ maxHeight: 'calc(100vh - 240px)' }}>
        <table className="w-full min-w-[800px]">
          <thead className="sticky top-0 z-20" style={{ background: 'var(--background)' }}>
            <tr className="border-b border-white/5">
              <th className="px-2 py-2.5 text-left text-gray-500 font-medium text-[11px] uppercase tracking-wider">Trader</th>
              {show('chart') && <th className="px-1 py-2.5 text-center text-gray-500 font-medium text-[11px] uppercase tracking-wider w-20">Chart</th>}
              {show('roi') && <SortHeader column={getColumnName('roi')} label="ROI" filterType="percent" />}
              {show('winRate') && <SortHeader column={getColumnName('win_rate')} label="Win Rate" filterType="percent" />}
              {show('pnl') && <SortHeader column={getColumnName('pnl')} label="PnL" filterType="money" />}
              {show('dd') && <SortHeader column={getColumnName('drawdown')} label="DD" filterType="percent" />}
              {show('profitFactor') && <SortHeader column="profit_factor" label="PF" filterType="number" />}
              {show('open') && <SortHeader column="open_trade_count" label="Open" filterType="number" />}
              {show('closed') && <SortHeader column={getColumnName('trade_count')} label="Closed" filterType="number" />}
              {show('volume') && <SortHeader column={getColumnName('volume')} label="Volume" filterType="money" />}
              {show('avgHold') && <SortHeader column="avg_hold_duration_hours" label="Hold" filterType="number" />}
              {show('synced') && <th className="px-3 py-2.5 text-right text-gray-500 font-medium text-[11px] uppercase tracking-wider">Synced</th>}
              {onSync && <th className="px-2 py-2.5 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {virtualRows.length > 0 && virtualRows[0].start > 0 && (
              <tr><td colSpan={99} style={{ height: virtualRows[0].start, padding: 0, border: 'none' }} /></tr>
            )}
            {virtualRows.map((virtualRow) => {
              const wallet = wallets[virtualRow.index]
              const index = virtualRow.index
              const pnl = getMetric(wallet, 'pnl')
              const roi = getMetric(wallet, 'roi')
              const winRate = getMetric(wallet, 'win_rate')
              const drawdown = getMetric(wallet, 'drawdown')
              const isSyncing = syncingAddress === wallet.address

              return (
                <tr key={wallet.address} data-index={virtualRow.index} ref={measureRef}
                  className="group hover:bg-white/[0.02] transition-colors border-b border-white/[0.02]">
                  <td className="px-2 py-2.5 max-w-[160px]">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setSelectedAddress(wallet.address)}
                        className="w-5 h-5 rounded-md bg-white/[0.03] hover:bg-white/[0.08] flex-shrink-0 flex items-center justify-center text-[9px] font-medium text-gray-500 hover:text-white transition-all cursor-pointer"
                        title="View details">
                        {index + 1}
                      </button>
                      <div className="flex flex-col min-w-0">
                        <a href={`https://polymarket.com/profile/${wallet.address}`} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-gray-300 hover:text-white transition-colors flex items-center gap-1 truncate">
                          <span className="truncate">{getDisplayName(wallet)}</span>
                          <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                        {wallet.last_synced_at && (
                          <span className="text-[9px] text-gray-600 leading-tight">{formatRelative(wallet.last_synced_at)}</span>
                        )}
                      </div>
                    </div>
                  </td>
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
                        <span className={`text-xs font-medium tabular-nums inline-block px-1.5 py-0.5 rounded ${
                          drawdown <= 10 ? 'bg-emerald-500/10' : drawdown <= 25 ? 'bg-amber-500/10' : 'bg-red-500/10'
                        } ${getDrawdownColor(drawdown)}`}>
                          {formatPercentPlain(drawdown)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">-</span>
                      )}
                    </td>
                  )}
                  {show('profitFactor') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs tabular-nums ${
                        wallet.profit_factor >= 2 ? 'text-emerald-400' : wallet.profit_factor >= 1 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {wallet.profit_factor > 0 ? wallet.profit_factor.toFixed(1) : '-'}
                      </span>
                    </td>
                  )}
                  {show('open') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs tabular-nums ${wallet.open_trade_count > 0 ? 'text-blue-400' : 'text-gray-600'}`}>
                        {wallet.open_trade_count}
                      </span>
                    </td>
                  )}
                  {show('closed') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-400 text-xs tabular-nums">
                        {getMetric(wallet, 'trade_count') || 0}
                      </span>
                    </td>
                  )}
                  {show('volume') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-300 text-xs tabular-nums font-medium">
                        {formatMoney(getMetric(wallet, 'volume'))}
                      </span>
                    </td>
                  )}
                  {show('avgHold') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-400 text-xs tabular-nums">
                        {formatDuration(wallet.avg_hold_duration_hours)}
                      </span>
                    </td>
                  )}
                  {show('synced') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs tabular-nums ${wallet.last_synced_at ? 'text-gray-500' : 'text-amber-500/60'}`}>
                        {wallet.last_synced_at ? formatRelative(wallet.last_synced_at) : 'pending'}
                      </span>
                    </td>
                  )}
                  {onSync && (
                    <td className="px-2 py-2.5 text-center w-10">
                      {isSyncing ? (
                        <div className="inline-flex items-center justify-center w-5 h-5">
                          <div className="w-3.5 h-3.5 rounded-full border border-white/10 border-t-white/40 animate-spin" />
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); onSync(wallet.address) }}
                          className="p-1 text-gray-600 opacity-0 group-hover:opacity-100 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-all"
                          title="Sync wallet">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
            {virtualRows.length > 0 && (
              <tr><td colSpan={99} style={{ height: totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0), padding: 0, border: 'none' }} /></tr>
            )}
            {isFetchingMore && (
              <tr><td colSpan={99} className="py-4 text-center">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 rounded-full border border-white/10 border-t-white/40 animate-spin" />
                  <span className="text-xs text-gray-500">Loading more...</span>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedAddress && onSync && (
        <NewTraderModal
          address={selectedAddress}
          onClose={() => setSelectedAddress(null)}
          onSync={onSync}
          syncing={syncingAddress === selectedAddress}
        />
      )}
      {selectedAddress && !onSync && (
        <NewTraderModal
          address={selectedAddress}
          onClose={() => setSelectedAddress(null)}
          onSync={() => {}}
          syncing={false}
        />
      )}
    </div>
  )
}
