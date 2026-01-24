'use client'

import Link from 'next/link'
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
    return `${value.toFixed(1)}%`
  }

  const sourceStyles: Record<string, string> = {
    goldsky: 'bg-blue-600',
    live: 'bg-green-600'
  }

  const getPnlColor = (value: number | undefined) => {
    if (value === undefined) return 'text-gray-400'
    return value >= 0 ? 'text-green-400' : 'text-red-400'
  }

  // Get metrics based on time period
  const getMetric = (wallet: Wallet, metric: string): number => {
    const suffix = timePeriod === '30d' ? '_30d' : '_7d'
    return (wallet as any)[metric + suffix] || 0
  }

  const SortHeader = ({ column, label }: { column: string; label: string }) => (
    <th
      className={`px-4 py-3 text-right cursor-pointer hover:bg-gray-600 ${
        sortBy === column ? 'text-blue-400' : ''
      }`}
      onClick={() => onSort?.(column)}
    >
      {label}
      {sortBy === column && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  )

  // Dynamic column name based on time period
  const getColumnName = (base: string) => {
    return timePeriod === '30d' ? `${base}_30d` : `${base}_7d`
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-400">Loading wallets...</p>
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <p className="text-gray-400">No wallets found matching your filters.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Address</th>
              <th className="px-4 py-3 text-center">Source</th>
              <SortHeader column="balance" label="Portfolio" />
              <SortHeader column={getColumnName('win_rate')} label={`Win Rate (${timePeriod})`} />
              <SortHeader column={getColumnName('pnl')} label={`PnL (${timePeriod})`} />
              <SortHeader column={getColumnName('roi')} label={`ROI (${timePeriod})`} />
              <SortHeader column={getColumnName('volume')} label={`Volume (${timePeriod})`} />
              <SortHeader column={getColumnName('trade_count')} label="Trades" />
            </tr>
          </thead>
          <tbody>
            {wallets.map((wallet) => {
              const pnl = getMetric(wallet, 'pnl')
              const roi = getMetric(wallet, 'roi')
              const winRate = getMetric(wallet, 'win_rate')
              const volume = getMetric(wallet, 'volume')
              const tradeCount = getMetric(wallet, 'trade_count')

              return (
                <tr
                  key={wallet.address}
                  className="border-t border-gray-700 hover:bg-gray-750 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/traders/${wallet.address}`}
                      className="text-blue-400 hover:underline font-mono"
                    >
                      {formatAddress(wallet.address)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`${sourceStyles[wallet.source] || 'bg-gray-600'} px-2 py-1 rounded text-xs font-medium`}>
                      {wallet.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatMoney(wallet.balance)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-yellow-400">
                    {formatPercent(winRate)}
                  </td>
                  <td className={`px-4 py-3 text-right ${getPnlColor(pnl)}`}>
                    {formatMoney(pnl)}
                  </td>
                  <td className={`px-4 py-3 text-right ${getPnlColor(roi)}`}>
                    {formatPercent(roi)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {formatMoney(volume)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {tradeCount}
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
