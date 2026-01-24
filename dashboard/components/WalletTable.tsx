'use client'

import { Wallet, TimePeriod } from '@/lib/supabase'

interface Props {
  wallets: Wallet[]
  loading: boolean
  timePeriod: TimePeriod
  onSort?: (column: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export default function WalletTable({
  wallets,
  loading,
  timePeriod,
  onSort,
  sortBy,
  sortDir
}: Props) {
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

  const SortHeader = ({ column, label, align = 'right' }: { column: string; label: string; align?: 'left' | 'right' | 'center' }) => {
    const isActive = sortBy === column
    return (
      <th
        className={`px-4 py-4 font-medium cursor-pointer select-none group transition-colors
          ${align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'}
          ${isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
        onClick={() => onSort?.(column)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
            {sortDir === 'asc' ? '↑' : '↓'}
          </span>
        </span>
      </th>
    )
  }

  // Dynamic column name based on time period
  const getColumnName = (base: string) => {
    return timePeriod === '30d' ? `${base}_30d` : `${base}_7d`
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
            <tr className="border-b border-gray-800/50">
              <th className="px-4 py-4 text-left text-gray-500 font-medium">Trader</th>
              <SortHeader column={getColumnName('trade_count')} label="Trades" />
              <SortHeader column={getColumnName('win_rate')} label="Win Rate" />
              <SortHeader column="balance" label="Portfolio" />
              <SortHeader column={getColumnName('roi')} label="ROI" />
              <SortHeader column={getColumnName('pnl')} label="PnL" />
              <SortHeader column="active_positions" label="Active" align="center" />
              <SortHeader column="total_positions" label="Total Pos" align="center" />
              <SortHeader column={getColumnName('drawdown')} label="Drawdown" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {wallets.map((wallet, index) => {
              const pnl = getMetric(wallet, 'pnl')
              const roi = getMetric(wallet, 'roi')
              const tradeCount = getMetric(wallet, 'trade_count')
              const drawdown = getMetric(wallet, 'drawdown')
              const winRate = getMetric(wallet, 'win_rate')

              return (
                <tr
                  key={wallet.address}
                  className="group hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-xs font-medium text-gray-400">
                        {index + 1}
                      </div>
                      <a
                        href={`https://polymarket.com/profile/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1.5"
                      >
                        {formatAddress(wallet.address)}
                        <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-gray-300 font-medium">{tradeCount.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`font-medium ${getWinRateColor(winRate)}`}>
                      {formatPercentPlain(winRate)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-gray-300 font-medium">{formatMoney(wallet.balance)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`font-semibold ${getPnlColor(roi)}`}>
                      {formatPercent(roi)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`font-medium ${getPnlColor(pnl)}`}>
                      {formatMoney(pnl)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400">
                      {wallet.active_positions || 0}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-gray-400 text-sm">
                      {wallet.total_positions || 0}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`font-medium ${getDrawdownColor(drawdown)}`}>
                      {drawdown > 0 ? `-${formatPercentPlain(drawdown)}` : '0%'}
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
