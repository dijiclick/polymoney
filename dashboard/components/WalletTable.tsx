'use client'

import { useState, useRef, useEffect } from 'react'
import { Wallet, TimePeriod } from '@/lib/supabase'
import TraderDetailModal from './TraderDetailModal'

interface ColumnFilter {
  min?: number
  max?: number
}

export type ColumnKey = 'value' | 'winRate' | 'roi' | 'pnl' | 'active' | 'total' | 'dd' | 'category' | 'joined'

export const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'value', label: 'Value' },
  { key: 'winRate', label: 'Win Rate' },
  { key: 'roi', label: 'ROI' },
  { key: 'pnl', label: 'PnL' },
  { key: 'active', label: 'Active' },
  { key: 'total', label: 'Total' },
  { key: 'dd', label: 'Drawdown' },
  { key: 'category', label: 'Category' },
  { key: 'joined', label: 'Joined' },
]

export const DEFAULT_VISIBLE: ColumnKey[] = ['value', 'winRate', 'roi', 'pnl', 'active', 'total', 'dd', 'category', 'joined']

interface Props {
  wallets: Wallet[]
  loading: boolean
  timePeriod: TimePeriod
  onSort?: (column: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  columnFilters?: Record<string, ColumnFilter>
  onColumnFilterChange?: (column: string, filter: ColumnFilter) => void
  visibleColumns?: ColumnKey[]
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
      className="absolute top-full left-0 mt-2 z-50 bg-[#12121a] border border-white/10 rounded-lg shadow-2xl p-3 min-w-[180px]"
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
  timePeriod,
  onSort,
  sortBy,
  sortDir,
  columnFilters = {},
  onColumnFilterChange,
  visibleColumns = DEFAULT_VISIBLE,
}: Props) {
  const show = (key: ColumnKey) => visibleColumns.includes(key)
  const [openFilter, setOpenFilter] = useState<string | null>(null)
  const [selectedTrader, setSelectedTrader] = useState<{ address: string; username?: string } | null>(null)

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  // Check if username looks like an address (starts with 0x and is long)
  const isAddressLikeUsername = (username: string | undefined | null) => {
    if (!username) return false
    return username.startsWith('0x') && username.length > 20
  }

  // Get display name - use formatted address if username looks like an address
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

  // Get metrics based on time period
  const getMetric = (wallet: Wallet, metric: string): number => {
    const suffix = timePeriod === 'all' ? '_all' : timePeriod === '30d' ? '_30d' : '_7d'
    return (wallet as any)[metric + suffix] || 0
  }

  // Dynamic column name based on time period
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

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-3 py-2.5 text-left text-gray-500 font-medium text-[11px] uppercase tracking-wider">Trader</th>
              {show('value') && <SortHeader column="balance" label="Value" filterType="money" />}
              {show('winRate') && <SortHeader column={getColumnName('win_rate')} label="Win Rate" filterType="percent" />}
              {show('roi') && <SortHeader column={getColumnName('roi')} label="ROI" filterType="percent" />}
              {show('pnl') && <SortHeader column={getColumnName('pnl')} label="PnL" filterType="money" />}
              {show('active') && <SortHeader column="active_positions" label="Active" align="center" filterType="number" />}
              {show('total') && <SortHeader column={getColumnName('trade_count')} label="Total" align="center" filterType="number" />}
              {show('dd') && <SortHeader column={getColumnName('drawdown')} label="DD" filterType="percent" />}
              {show('category') && <th className="px-3 py-2.5 text-left text-gray-500 font-medium text-[11px] uppercase tracking-wider">Category</th>}
              {show('joined') && <SortHeader column="account_created_at" label="Joined" filterType="number" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.02]">
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
                  className="group hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedTrader({ address: wallet.address, username: wallet.username })}
                        className="w-6 h-6 rounded-md bg-white/[0.03] hover:bg-white/[0.08] flex items-center justify-center text-[10px] font-medium text-gray-500 hover:text-white transition-all cursor-pointer"
                        title="View details"
                      >
                        {index + 1}
                      </button>
                      <a
                        href={`https://polymarket.com/profile/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-300 hover:text-white transition-colors flex items-center gap-1"
                      >
                        {getDisplayName(wallet)}
                        <svg className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  {show('value') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-400 text-xs">{formatMoney(wallet.balance)}</span>
                    </td>
                  )}
                  {show('winRate') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs ${getWinRateColor(winRate)}`}>
                        {formatPercentPlain(winRate)}
                      </span>
                    </td>
                  )}
                  {show('roi') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs font-medium ${getPnlColor(roi)}`}>
                        {formatPercent(roi)}
                      </span>
                    </td>
                  )}
                  {show('pnl') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs ${getPnlColor(pnl)}`}>
                        {formatMoney(pnl)}
                      </span>
                    </td>
                  )}
                  {show('active') && (
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-xs text-gray-400">
                        {wallet.active_positions || 0}
                      </span>
                    </td>
                  )}
                  {show('total') && (
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-gray-500 text-xs">
                        {getMetric(wallet, 'trade_count') || 0}
                      </span>
                    </td>
                  )}
                  {show('dd') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs ${getDrawdownColor(drawdown)}`}>
                        {drawdown > 0 ? `${formatPercentPlain(drawdown)}` : '-'}
                      </span>
                    </td>
                  )}
                  {show('category') && (
                    <td className="px-3 py-2.5 text-left">
                      <span className="text-gray-500 text-xs whitespace-nowrap">
                        {(wallet as any).top_category || '-'}
                      </span>
                    </td>
                  )}
                  {show('joined') && (
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-gray-600 text-xs">
                        {formatCreatedDate(wallet.account_created_at)}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Trader Detail Modal */}
      <TraderDetailModal
        address={selectedTrader?.address || ''}
        username={selectedTrader?.username}
        isOpen={!!selectedTrader}
        onClose={() => setSelectedTrader(null)}
      />
    </div>
  )
}
