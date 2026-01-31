'use client'

import { useState } from 'react'
import NewTradeCard from './NewTradeCard'

interface Trade {
  id: number
  condition_id: string
  market_title: string | null
  market_slug: string | null
  primary_outcome: string | null
  closed: boolean
  open_timestamp: string
  close_timestamp: string | null
  number_of_buys: number
  number_of_sells: number
  total_volume_bought: number
  total_volume_sold: number
  roi: number
  pnl: number
}

interface Props {
  trades: Trade[]
  loading: boolean
}

export default function NewTradeList({ trades, loading }: Props) {
  const [tab, setTab] = useState<'open' | 'closed'>('open')

  const openTrades = trades.filter(t => !t.closed)
  const closedTrades = trades.filter(t => t.closed)
  const displayTrades = tab === 'open' ? openTrades : closedTrades

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5">
        <button
          onClick={() => setTab('open')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'open'
              ? 'bg-blue-500/10 text-blue-400'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Open ({openTrades.length})
        </button>
        <button
          onClick={() => setTab('closed')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'closed'
              ? 'bg-blue-500/10 text-blue-400'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          Closed ({closedTrades.length})
        </button>
      </div>

      {/* Trade list */}
      {loading ? (
        <div className="px-4 py-12 text-center text-gray-500">Loading trades...</div>
      ) : displayTrades.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-500">
          No {tab} trades found.
        </div>
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          {displayTrades.map(trade => (
            <NewTradeCard key={trade.id} trade={trade} />
          ))}
        </div>
      )}
    </div>
  )
}
