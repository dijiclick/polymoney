'use client'

import Link from 'next/link'
import { Wallet, WalletMetrics, TimePeriod } from '@/lib/supabase'

interface Props {
  wallets: Wallet[]
  metrics: Map<string, WalletMetrics>
  loading: boolean
  timePeriod: TimePeriod
  onSort?: (column: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export default function WalletTable({
  wallets,
  metrics,
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
    leaderboard: 'bg-green-600',
    both: 'bg-purple-600'
  }

  const getPnlColor = (value: number | undefined) => {
    if (value === undefined) return 'text-gray-400'
    return value >= 0 ? 'text-green-400' : 'text-red-400'
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
              <th className="px-4 py-3 text-right">PnL ({timePeriod})</th>
              <th className="px-4 py-3 text-right">ROI ({timePeriod})</th>
              <th className="px-4 py-3 text-right">Volume ({timePeriod})</th>
              <th className="px-4 py-3 text-right">Trades</th>
              <th className="px-4 py-3 text-right">Win Rate</th>
              <th className="px-4 py-3 text-right">Drawdown</th>
              <th className="px-4 py-3 text-left">Category</th>
            </tr>
          </thead>
          <tbody>
            {wallets.map((wallet) => {
              const m = metrics.get(wallet.address)
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
                    <span className={`${sourceStyles[wallet.source]} px-2 py-1 rounded text-xs font-medium`}>
                      {wallet.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatMoney(wallet.balance)}
                  </td>
                  <td className={`px-4 py-3 text-right ${getPnlColor(m?.pnl)}`}>
                    {m ? formatMoney(m.pnl) : '-'}
                  </td>
                  <td className={`px-4 py-3 text-right ${getPnlColor(m?.roi)}`}>
                    {m ? formatPercent(m.roi) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {m ? formatMoney(m.volume) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {m?.tradeCount ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {m ? formatPercent(m.winRate) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-orange-400">
                    {m && m.maxDrawdown > 0 ? formatPercent(m.maxDrawdown) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {wallet.categories && wallet.categories.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {wallet.categories.slice(0, 2).map((cat) => (
                          <span
                            key={cat}
                            className="bg-gray-700 px-2 py-0.5 rounded text-xs text-gray-300"
                          >
                            {cat}
                          </span>
                        ))}
                        {wallet.categories.length > 2 && (
                          <span className="text-gray-500 text-xs">
                            +{wallet.categories.length - 2}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
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
