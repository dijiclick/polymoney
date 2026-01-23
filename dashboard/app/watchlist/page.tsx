'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, WatchlistEntry } from '@/lib/supabase'

export default function WatchlistPage() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetchWatchlist()
  }, [filter])

  async function fetchWatchlist() {
    setLoading(true)

    let query = supabase
      .from('watchlist')
      .select('*, traders(*)')
      .order('added_at', { ascending: false })

    if (filter !== 'all') {
      query = query.eq('list_type', filter)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching watchlist:', error)
    }

    setEntries(data || [])
    setLoading(false)
  }

  async function removeFromWatchlist(id: number) {
    const { error } = await supabase
      .from('watchlist')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error removing from watchlist:', error)
    } else {
      setEntries(entries.filter(e => e.id !== id))
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatMoney = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`
    return `$${value.toFixed(0)}`
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString()
  }

  const typeStyles: Record<string, string> = {
    copytrade: 'bg-blue-600',
    bot: 'bg-purple-600',
    custom: 'bg-gray-600',
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Watchlist</h1>
      <p className="text-gray-400 mb-8">
        Track your favorite traders and get notified of their activity.
      </p>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-gray-800 rounded px-4 py-2 border border-gray-700 focus:border-blue-500 outline-none"
        >
          <option value="all">All Lists</option>
          <option value="copytrade">Copy Trade</option>
          <option value="bot">Bots</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Results count */}
      <div className="text-gray-400 text-sm mb-4">
        {entries.length} traders in watchlist
      </div>

      {loading ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          Loading watchlist...
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400 mb-4">
            Your watchlist is empty. Add traders from the Traders page.
          </p>
          <Link href="/traders" className="text-blue-400 hover:underline">
            Browse Traders
          </Link>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Trader</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">List</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Portfolio</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Win Rate</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">PnL</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Notes</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Added</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const trader = entry.traders
                return (
                  <tr key={entry.id} className="border-t border-gray-700 hover:bg-gray-750">
                    <td className="px-4 py-3">
                      <Link
                        href={`/traders/${entry.address}`}
                        className="text-blue-400 hover:underline"
                      >
                        {trader?.username || formatAddress(entry.address)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`${typeStyles[entry.list_type]} px-2 py-1 rounded text-xs font-medium`}>
                        {entry.list_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {trader ? formatMoney(trader.portfolio_value) : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {trader ? `${trader.win_rate_30d.toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className={`px-4 py-3 text-right ${trader && trader.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {trader ? formatMoney(trader.total_pnl) : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-sm max-w-xs truncate">
                      {entry.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-400">
                      {formatDate(entry.added_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => removeFromWatchlist(entry.id)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
