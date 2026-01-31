'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, TimePeriod } from '@/lib/supabase'
import TimePeriodSelector from '@/components/TimePeriodSelector'
import WalletTable, { ColumnKey, DEFAULT_VISIBLE } from '@/components/WalletTable'

interface TrackedWalletMeta {
  last_refreshed_at: string | null
  added_at: string
}

const INTERVAL_OPTIONS = [
  { label: '5m', value: 5 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '3h', value: 180 },
  { label: '12h', value: 720 },
  { label: '24h', value: 1440 },
  { label: '48h', value: 2880 },
  { label: '72h', value: 4320 },
]

function getStoredInterval(): number {
  if (typeof window === 'undefined') return 60
  const stored = localStorage.getItem('track-refresh-interval')
  if (stored) {
    const val = parseInt(stored)
    if (INTERVAL_OPTIONS.some(o => o.value === val)) return val
  }
  return 60
}

export default function TrackPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [trackedMeta, setTrackedMeta] = useState<Map<string, TrackedWalletMeta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('30d')
  const [sortBy, setSortBy] = useState('pnl_30d')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [refreshingAddresses, setRefreshingAddresses] = useState<Set<string>>(new Set())
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE)
  const [refreshInterval, setRefreshInterval] = useState<number>(getStoredInterval)
  const autoRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const isRefreshingAll = useRef(false)

  const fetchTrackedWallets = useCallback(async () => {
    try {
      const res = await fetch('/api/tracked-wallets')
      if (!res.ok) {
        setWallets([])
        setTrackedMeta(new Map())
        return
      }
      const data = await res.json()

      const walletsData: Wallet[] = data.wallets || []
      setWallets(walletsData)

      const meta = new Map<string, TrackedWalletMeta>()
      for (const t of data.tracked || []) {
        meta.set(t.address, {
          last_refreshed_at: t.last_refreshed_at,
          added_at: t.added_at,
        })
      }
      setTrackedMeta(meta)
    } catch (error) {
      console.error('Error fetching tracked wallets:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrackedWallets()
  }, [fetchTrackedWallets])

  // Client-side sorting
  const sortedWallets = [...wallets].sort((a, b) => {
    const aVal = (a as any)[sortBy] ?? 0
    const bVal = (b as any)[sortBy] ?? 0
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal
  })

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  const handleTimePeriodChange = (period: TimePeriod) => {
    const getSuffix = (p: TimePeriod) => p === 'all' ? '_all' : p === '30d' ? '_30d' : '_7d'
    const newSuffix = getSuffix(period)
    const oldSuffix = getSuffix(timePeriod)
    if (sortBy.endsWith(oldSuffix)) {
      setSortBy(sortBy.replace(oldSuffix, newSuffix))
    }
    setTimePeriod(period)
  }

  const handleRemoveTracked = useCallback(async (address: string) => {
    setWallets(prev => prev.filter(w => w.address !== address))
    setTrackedMeta(prev => {
      const next = new Map(prev)
      next.delete(address)
      return next
    })

    try {
      await fetch('/api/tracked-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', address })
      })
    } catch (error) {
      console.error('Error removing tracked wallet:', error)
      fetchTrackedWallets()
    }
  }, [fetchTrackedWallets])

  const refreshWallet = useCallback(async (address: string) => {
    setRefreshingAddresses(prev => new Set(prev).add(address))
    try {
      let refreshRes: Response

      refreshRes = await fetch(`/api/admin/refresh-metrics?address=${address}`, { method: 'POST' })

      if (refreshRes.ok) {
        await fetch('/api/tracked-wallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark_refreshed', address })
        })
      }
    } catch (error) {
      console.error(`Error refreshing ${address}:`, error)
    } finally {
      setRefreshingAddresses(prev => {
        const next = new Set(prev)
        next.delete(address)
        return next
      })
    }
  }, [])

  const refreshAll = useCallback(async () => {
    if (isRefreshingAll.current) return
    isRefreshingAll.current = true

    const addresses = Array.from(trackedMeta.keys())
    if (addresses.length === 0) {
      isRefreshingAll.current = false
      return
    }

    setRefreshStatus(`Refreshing ${addresses.length} wallet${addresses.length > 1 ? 's' : ''}...`)

    for (const address of addresses) {
      await refreshWallet(address)
    }

    await fetchTrackedWallets()
    setRefreshStatus(`Refreshed ${addresses.length} wallet${addresses.length > 1 ? 's' : ''}`)
    setTimeout(() => setRefreshStatus(null), 3000)
    isRefreshingAll.current = false
  }, [trackedMeta, refreshWallet, fetchTrackedWallets])

  // Auto-refresh: DISABLED
  // useEffect(() => {
  //   if (autoRefreshTimer.current) {
  //     clearInterval(autoRefreshTimer.current)
  //   }

  //   const intervalMs = refreshInterval * 60 * 1000
  //   autoRefreshTimer.current = setInterval(() => {
  //     refreshAll()
  //   }, intervalMs)

  //   return () => {
  //     if (autoRefreshTimer.current) {
  //       clearInterval(autoRefreshTimer.current)
  //     }
  //   }
  // }, [refreshInterval, refreshAll])

  const handleIntervalChange = (value: number) => {
    setRefreshInterval(value)
    localStorage.setItem('track-refresh-interval', String(value))
  }

  const intervalLabel = INTERVAL_OPTIONS.find(o => o.value === refreshInterval)?.label || '1h'

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 md:gap-3 flex-wrap">
          <TimePeriodSelector value={timePeriod} onChange={handleTimePeriodChange} />

          <div className="text-xs text-gray-600">
            <span className="text-gray-400">{wallets.length}</span>
            {' '}tracked wallet{wallets.length !== 1 ? 's' : ''}
          </div>

          {refreshStatus && (
            <span className="text-[10px] text-gray-500 px-2 py-1 rounded-md bg-white/[0.02] border border-white/5">
              {refreshStatus}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Global refresh interval selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500">Auto-refresh:</span>
            <select
              value={refreshInterval}
              onChange={(e) => handleIntervalChange(parseInt(e.target.value))}
              className="bg-white/[0.03] border border-white/5 rounded-md px-1.5 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-white/20 cursor-pointer"
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {wallets.length > 0 && (
            <button
              onClick={refreshAll}
              disabled={refreshingAddresses.size > 0}
              className="px-2.5 py-1.5 bg-white/[0.02] border border-white/5 rounded-lg text-[10px] text-gray-400 hover:text-white hover:border-white/10 hover:bg-white/[0.04] transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${refreshingAddresses.size > 0 ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Now
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="glass rounded-xl p-10">
          <div className="flex flex-col items-center justify-center">
            <div className="relative w-8 h-8">
              <div className="absolute inset-0 rounded-full border border-white/10"></div>
              <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
            </div>
            <p className="text-gray-600 mt-3 text-xs">Loading tracked wallets...</p>
          </div>
        </div>
      ) : wallets.length === 0 ? (
        <div className="glass rounded-xl p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.02] mb-3">
            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm">No tracked wallets</p>
          <p className="text-gray-600 text-xs mt-1">
            Go to the{' '}
            <a href="/wallets" className="text-blue-400 hover:text-blue-300 transition-colors">
              Wallets
            </a>{' '}
            page and click the bookmark icon to start tracking
          </p>
        </div>
      ) : (
        <WalletTable
          wallets={sortedWallets}
          loading={false}
          timePeriod={timePeriod}
          onSort={handleSort}
          sortBy={sortBy}
          sortDir={sortDir}
          visibleColumns={visibleColumns}
          trackMode
          trackedWalletMeta={trackedMeta}
          onRemoveTracked={handleRemoveTracked}
          refreshingAddresses={refreshingAddresses}
        />
      )}
    </div>
  )
}
