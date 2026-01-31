'use client'

import { useState, useEffect } from 'react'
import NewMetricsGrid from './NewMetricsGrid'
import NewTradeList from './NewTradeList'

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

interface Wallet {
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
  last_synced_at: string | null
}

interface Props {
  address: string
  onClose: () => void
  onSync: (address: string) => void
  syncing: boolean
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function NewTraderModal({ address, onClose, onSync, syncing }: Props) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/new/wallets/${address}`)
        if (res.ok) {
          const data = await res.json()
          setWallet(data.wallet)
          setTrades(data.trades || [])
        }
      } catch (err) {
        console.error('Failed to load wallet detail:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [address])

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[5vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl border border-white/10 shadow-2xl"
        style={{ background: 'var(--bg-secondary, #1a1a2e)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">
                {wallet?.username || formatAddress(address)}
              </h2>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 font-mono">{formatAddress(address)}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(address)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy address"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <a
                  href={`https://polymarket.com/profile/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  Polymarket →
                </a>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSync(address)}
              disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                syncing
                  ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
              }`}
            >
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-60px)]">
          {loading ? (
            <div className="py-16 text-center text-gray-500">Loading wallet data...</div>
          ) : wallet ? (
            <>
              <NewMetricsGrid wallet={wallet} />
              <NewTradeList trades={trades} loading={false} />
            </>
          ) : (
            <div className="py-16 text-center text-gray-500">Wallet not found</div>
          )}
        </div>
      </div>
    </div>
  )
}
