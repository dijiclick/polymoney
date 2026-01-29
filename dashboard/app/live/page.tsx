'use client'

import { useState, useCallback, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TradeFilter } from '@/lib/supabase'
import { useLiveTrades } from '@/hooks/useLiveTrades'
import LiveFeedHeader from '@/components/live/LiveFeedHeader'
import LiveFilterBar from '@/components/live/LiveFilterBar'
import TradeTable from '@/components/live/TradeTable'
import TraderDetailPanel from '@/components/live/TraderDetailPanel'
import TraderDetailEmpty from '@/components/live/TraderDetailEmpty'

function LiveFeedContent() {
  const [filter, setFilter] = useState<TradeFilter>({})

  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedAddress = searchParams.get('trader') || null

  const setSelectedTrader = useCallback((address: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (address) {
      params.set('trader', address)
    } else {
      params.delete('trader')
    }
    router.replace(`/live?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const {
    trades,
    isConnected,
    isPaused,
    tradeCount,
    totalSeen,
    setIsPaused,
    clearTrades,
  } = useLiveTrades({ filter, maxTrades: 200 })

  // Auto-refresh stale wallets seen in the live feed (>1 day old metrics)
  const checkedAddresses = useRef(new Set<string>())
  const pendingAddresses = useRef(new Set<string>())
  const refreshQueue = useRef<string[]>([])
  const isProcessing = useRef(false)

  // Collect new addresses from incoming trades
  useEffect(() => {
    for (const trade of trades) {
      const addr = trade.trader_address
      if (!checkedAddresses.current.has(addr)) {
        checkedAddresses.current.add(addr)
        pendingAddresses.current.add(addr)
      }
    }
  }, [trades])

  // Batch check pending addresses every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (pendingAddresses.current.size === 0) return

      const batch = Array.from(pendingAddresses.current)
      pendingAddresses.current.clear()

      try {
        const res = await fetch('/api/wallets/check-stale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: batch }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.stale && data.stale.length > 0) {
          refreshQueue.current.push(...data.stale)
          processRefreshQueue()
        }
      } catch {
        // Silently ignore
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  // Process refresh queue sequentially
  const processRefreshQueue = useCallback(async () => {
    if (isProcessing.current) return
    isProcessing.current = true

    while (refreshQueue.current.length > 0) {
      const addr = refreshQueue.current.shift()!
      try {
        await fetch(`/api/admin/refresh-metrics?address=${addr}`, { method: 'POST' })
      } catch {
        // Continue with next
      }
    }

    isProcessing.current = false
  }, [])

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Minimal Header */}
      <LiveFeedHeader
        isConnected={isConnected}
        tradeCount={tradeCount}
        totalSeen={totalSeen}
        isPaused={isPaused}
        onTogglePause={() => setIsPaused(!isPaused)}
        onClear={clearTrades}
      />

      {/* Filter Bar */}
      <LiveFilterBar filter={filter} onChange={setFilter} />

      {/* Split Panel Layout */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Trade Feed */}
        <div className={`transition-all duration-200 ${
          selectedAddress
            ? 'hidden md:block md:w-[60%]'
            : 'w-full md:w-[60%] xl:w-[60%]'
        }`}>
          <TradeTable
            trades={trades}
            selectedAddress={selectedAddress}
            onSelectTrader={(addr) => setSelectedTrader(addr)}
          />
        </div>

        {/* Right: Trader Detail or Empty State */}
        <div className={`transition-all duration-200 ${
          selectedAddress
            ? 'w-full md:w-[40%] min-w-0 md:min-w-[340px]'
            : 'hidden xl:block w-[40%] min-w-[340px]'
        }`}>
          {selectedAddress ? (
            <TraderDetailPanel
              address={selectedAddress}
              trades={trades}
              onClose={() => setSelectedTrader(null)}
            />
          ) : (
            <TraderDetailEmpty />
          )}
        </div>
      </div>
    </div>
  )
}

export default function LiveTradePage() {
  return (
    <Suspense fallback={
      <div className="h-[calc(100vh-120px)] flex items-center justify-center">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 rounded-full border border-white/10"></div>
          <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
        </div>
      </div>
    }>
      <LiveFeedContent />
    </Suspense>
  )
}
