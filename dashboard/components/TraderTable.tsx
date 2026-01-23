'use client'

import Link from 'next/link'
import { Trader } from '@/lib/supabase'

interface TraderTableProps {
  traders: Trader[]
  showScores?: boolean
}

export default function TraderTable({ traders, showScores = true }: TraderTableProps) {
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatMoney = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const ScoreBadge = ({ score }: { score: number }) => {
    const color = score >= 70 ? 'bg-green-600' : score >= 50 ? 'bg-yellow-600' : 'bg-gray-600'
    return (
      <span className={`${color} px-2 py-1 rounded text-xs font-medium`}>
        {score}
      </span>
    )
  }

  const TypeBadge = ({ type }: { type: string | null }) => {
    const styles: Record<string, string> = {
      copytrade: 'bg-blue-600',
      bot: 'bg-purple-600',
      none: 'bg-gray-600',
    }
    const labels: Record<string, string> = {
      copytrade: 'Copy',
      bot: 'Bot',
      none: '-',
    }
    const actualType = type || 'none'

    return (
      <span className={`${styles[actualType]} px-2 py-1 rounded text-xs font-medium`}>
        {labels[actualType]}
      </span>
    )
  }

  if (traders.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
        No traders found matching the current filters.
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-700">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Address</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Portfolio</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Win Rate</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">ROI</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">PnL</th>
            {showScores && (
              <>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Copy</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Bot</th>
              </>
            )}
            <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Type</th>
          </tr>
        </thead>
        <tbody>
          {traders.map((trader) => (
            <tr key={trader.address} className="border-t border-gray-700 hover:bg-gray-750">
              <td className="px-4 py-3">
                <Link
                  href={`/traders/${trader.address}`}
                  className="text-blue-400 hover:underline"
                >
                  {trader.username || formatAddress(trader.address)}
                </Link>
              </td>
              <td className="px-4 py-3 text-right">
                {formatMoney(trader.portfolio_value)}
              </td>
              <td className="px-4 py-3 text-right">
                {trader.win_rate_30d.toFixed(1)}%
              </td>
              <td className={`px-4 py-3 text-right ${trader.roi_percent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {trader.roi_percent >= 0 ? '+' : ''}{trader.roi_percent.toFixed(1)}%
              </td>
              <td className={`px-4 py-3 text-right ${trader.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatMoney(trader.total_pnl)}
              </td>
              {showScores && (
                <>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge score={trader.copytrade_score} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge score={trader.bot_score} />
                  </td>
                </>
              )}
              <td className="px-4 py-3 text-center">
                <TypeBadge type={trader.primary_classification} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
