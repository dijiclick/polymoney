'use client'

import { useState, useRef, useEffect } from 'react'
import { Wallet, TimePeriod } from '@/lib/supabase'

interface ColumnFilter {
  min?: number
  max?: number
}

interface Props {
  wallets: Wallet[]
  loading: boolean
  timePeriod: TimePeriod
  onSort?: (column: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  columnFilters?: Record<string, ColumnFilter>
  onColumnFilterChange?: (column: string, filter: ColumnFilter) => void
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
      className="absolute top-full left-0 mt-2 z-50 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-4 min-w-[200px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wider">{label} Filter</div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Min</label>
          <div className="relative">
            {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{prefix}</span>}
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              placeholder="No min"
              className={`w-full bg-gray-700/50 border border-gray-600 rounded-lg py-2 text-sm text-white focus:border-blue-500 focus:outline-none ${prefix ? 'pl-6' : 'pl-3'} ${suffix ? 'pr-6' : 'pr-3'}`}
            />
            {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{suffix}</span>}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Max</label>
          <div className="relative">
            {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{prefix}</span>}
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              placeholder="No max"
              className={`w-full bg-gray-700/50 border border-gray-600 rounded-lg py-2 text-sm text-white focus:border-blue-500 focus:outline-none ${prefix ? 'pl-6' : 'pl-3'} ${suffix ? 'pr-6' : 'pr-3'}`}
            />
            {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{suffix}</span>}
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleClear}
            className="flex-1 px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleApply}
            className="flex-1 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors"
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
  timePeriod,
  onSort,
  sortBy,
  sortDir,
  columnFilters = {},
  onColumnFilterChange
}: Props) {
  const [openFilter, setOpenFilter] = useState<string | null>(null)

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

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

  // Get metrics based on time period
  const getMetric = (wallet: Wallet, metric: string): number => {
    const suffix = timePeriod === '30d' ? '_30d' : '_7d'
    return (wallet as any)[metric + suffix] || 0
  }

  // Debug: Log wallet data to browser console
  useEffect(() => {
    if (wallets.length > 0) {
      const suffix = timePeriod === '30d' ? '_30d' : '_7d'

      console.log(`\n%c═══════════════════════════════════════════════════════════════`, 'color: #3b82f6')
      console.log(`%c  WALLET TABLE DEBUG - ${timePeriod.toUpperCase()} Period - ${wallets.length} wallets`, 'color: #3b82f6; font-weight: bold')
      console.log(`%c═══════════════════════════════════════════════════════════════`, 'color: #3b82f6')

      wallets.forEach((wallet, index) => {
        const pnlVal = (wallet as any)[`pnl${suffix}`]
        const roiVal = (wallet as any)[`roi${suffix}`]
        const winRateVal = (wallet as any)[`win_rate${suffix}`]
        const drawdownVal = (wallet as any)[`drawdown${suffix}`]
        const volumeVal = (wallet as any)[`volume${suffix}`]
        const tradeCountVal = (wallet as any)[`trade_count${suffix}`]

        console.log(`\n%c[${index + 1}] ${wallet.username || wallet.address.slice(0, 10)}...`, 'color: #10b981; font-weight: bold')
        console.log(`%cRaw DB values for ${timePeriod}:`, 'color: #f59e0b')
        console.table({
          address: wallet.address,
          username: wallet.username,
          balance: wallet.balance,
          [`pnl${suffix}`]: pnlVal,
          [`roi${suffix}`]: roiVal,
          [`win_rate${suffix}`]: winRateVal,
          [`drawdown${suffix}`]: drawdownVal,
          [`volume${suffix}`]: volumeVal,
          [`trade_count${suffix}`]: tradeCountVal,
          active_positions: wallet.active_positions,
          total_positions: wallet.total_positions,
          total_wins: wallet.total_wins,
          total_losses: wallet.total_losses,
          realized_pnl: wallet.realized_pnl,
          overall_pnl: wallet.overall_pnl,
          overall_roi: wallet.overall_roi,
          overall_win_rate: wallet.overall_win_rate,
        })

        // Show the displayed values
        const fmtMoney = (v: number | undefined | null) => {
          if (v === undefined || v === null) return '-'
          const abs = Math.abs(v)
          if (abs >= 1000000) return `$${(v / 1000000).toFixed(2)}M`
          if (abs >= 1000) return `$${(v / 1000).toFixed(1)}K`
          return `$${v.toFixed(0)}`
        }
        const fmtPct = (v: number | undefined | null) => {
          if (v === undefined || v === null) return '-'
          return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
        }
        const fmtPctPlain = (v: number | undefined | null) => {
          if (v === undefined || v === null) return '-'
          return `${v.toFixed(1)}%`
        }

        console.log(`%cDisplayed in table:`, 'color: #8b5cf6')
        console.table({
          'Active Positions Value': fmtMoney(wallet.balance),
          'Win Rate': fmtPctPlain(winRateVal),
          'ROI': fmtPct(roiVal),
          'PnL': fmtMoney(pnlVal),
          'Active': wallet.active_positions || 0,
          'Positions': wallet.total_positions || 0,
          'Drawdown': fmtPctPlain(drawdownVal),
        })
      })

      console.log(`\n%c═══════════════════════════════════════════════════════════════`, 'color: #3b82f6')
    }
  }, [wallets, timePeriod])

  // Dynamic column name based on time period
  const getColumnName = (base: string) => {
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
        className={`px-3 py-3 font-medium relative
          ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}
          ${isActive ? 'text-blue-400' : 'text-gray-500'}`}
      >
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => setOpenFilter(isFilterOpen ? null : column)}
            className={`p-1 rounded hover:bg-gray-700 transition-colors ${hasActiveFilter ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
            title="Filter"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          <button
            onClick={() => onSort?.(column)}
            className="cursor-pointer select-none hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            {label}
            <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}>
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
      <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-12">
        <div className="flex flex-col items-center justify-center">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/20"></div>
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin"></div>
          </div>
          <p className="text-gray-500 mt-4 text-sm">Loading wallets...</p>
        </div>
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-12 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/50 mb-4">
          <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-gray-400">No wallets found matching your filters</p>
        <p className="text-gray-600 text-sm mt-1">Try adjusting your filter criteria</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800/50 text-sm">
              <th className="px-3 py-3 text-left text-gray-500 font-medium">Trader</th>
              <SortHeader column="balance" label="Active Positions Value" filterType="money" />
              <SortHeader column={getColumnName('win_rate')} label="Win Rate" filterType="percent" />
              <SortHeader column={getColumnName('roi')} label="ROI" filterType="percent" />
              <SortHeader column={getColumnName('pnl')} label="PnL" filterType="money" />
              <SortHeader column="active_positions" label="Active" align="center" filterType="number" />
              <SortHeader column="total_positions" label="Positions" align="center" filterType="number" />
              <SortHeader column={getColumnName('drawdown')} label="Drawdown" filterType="percent" />
              <SortHeader column="account_created_at" label="Created" filterType="number" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {wallets.map((wallet, index) => {
              const pnl = getMetric(wallet, 'pnl')
              const roi = getMetric(wallet, 'roi')
              const drawdown = getMetric(wallet, 'drawdown')
              const winRate = getMetric(wallet, 'win_rate')

              // Format account created date as MM/YYYY
              const formatCreatedDate = (dateStr: string | undefined) => {
                if (!dateStr) return '-'
                const date = new Date(dateStr)
                const month = (date.getMonth() + 1).toString().padStart(2, '0')
                const year = date.getFullYear()
                return `${month}/${year}`
              }

              return (
                <tr
                  key={wallet.address}
                  className="group hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-xs font-medium text-gray-400">
                        {index + 1}
                      </div>
                      <a
                        href={`https://polymarket.com/profile/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                      >
                        {wallet.username || formatAddress(wallet.address)}
                        <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-gray-300 text-sm">{formatMoney(wallet.balance)}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-medium ${getWinRateColor(winRate)}`}>
                      {formatPercentPlain(winRate)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-semibold ${getPnlColor(roi)}`}>
                      {formatPercent(roi)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-medium ${getPnlColor(pnl)}`}>
                      {formatMoney(pnl)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400">
                      {wallet.active_positions || 0}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-gray-400 text-sm">
                      {wallet.total_positions || 0}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-medium ${getDrawdownColor(drawdown)}`}>
                      {drawdown > 0 ? `${formatPercentPlain(drawdown)}` : '0%'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-gray-400 text-sm">
                      {formatCreatedDate(wallet.account_created_at)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
