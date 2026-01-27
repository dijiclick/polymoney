'use client'

import { useState, useCallback, Suspense } from 'react'
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
        <div className={`transition-all duration-200 ${selectedAddress ? 'w-[60%]' : 'w-full xl:w-[60%]'}`}>
          <TradeTable
            trades={trades}
            selectedAddress={selectedAddress}
            onSelectTrader={(addr) => setSelectedTrader(addr)}
          />
        </div>

        {/* Right: Trader Detail or Empty State */}
        <div className={`min-w-[340px] transition-all duration-200 ${
          selectedAddress ? 'w-[40%]' : 'hidden xl:block w-[40%]'
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
