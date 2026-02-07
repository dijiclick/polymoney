'use client'

import { useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { InsiderFilter } from '@/lib/supabase'
import { useInsiderAlerts } from '@/hooks/useInsiderAlerts'
import InsiderFeedHeader from '@/components/live/InsiderFeedHeader'
import InsiderFilterBar from '@/components/live/InsiderFilterBar'
import InsiderAlertCard from '@/components/live/InsiderAlertCard'
import TraderDetailPanel from '@/components/live/TraderDetailPanel'

function InsiderFeedContent() {
  const [filter, setFilter] = useState<InsiderFilter>({ minScore: 50 })

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
    alerts,
    isConnected,
    alertCount,
    clearAlerts,
  } = useInsiderAlerts({ filter, maxAlerts: 100 })

  // Track new alert IDs for animation
  const seenIds = useRef(new Set<number>())
  const newIds = new Set<number>()

  for (const alert of alerts) {
    if (!seenIds.current.has(alert.id)) {
      newIds.add(alert.id)
    }
  }

  // Update seen IDs after render
  setTimeout(() => {
    for (const alert of alerts) {
      seenIds.current.add(alert.id)
    }
  }, 1000)

  return (
    <div className="h-[calc(100dvh-120px)] flex flex-col">
      {/* Header */}
      <InsiderFeedHeader
        isConnected={isConnected}
        alertCount={alertCount}
        onClear={clearAlerts}
      />

      {/* Filter Bar */}
      <InsiderFilterBar filter={filter} onChange={setFilter} />

      {/* Split Panel Layout */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Left: Alert Feed */}
        <div className={`transition-all duration-200 ${
          selectedAddress
            ? 'hidden md:block md:w-[60%]'
            : 'w-full md:w-[60%] xl:w-[60%]'
        }`}>
          <div className="h-full overflow-y-auto space-y-1.5 pr-1">
            {alerts.length > 0 ? (
              alerts.map((alert) => (
                <InsiderAlertCard
                  key={alert.id}
                  alert={alert}
                  isSelected={selectedAddress === alert.trader_address}
                  isNew={newIds.has(alert.id)}
                  onSelect={() => setSelectedTrader(alert.trader_address)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500">Monitoring for insider activity</p>
                <p className="text-xs text-gray-600 mt-1">Alerts appear when suspicious trade patterns are detected</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Trader Detail Panel */}
        <div className={`transition-all duration-200 ${
          selectedAddress
            ? 'w-full md:w-[40%] min-w-0 md:min-w-[340px]'
            : 'hidden xl:block w-[40%] min-w-[340px]'
        }`}>
          {selectedAddress ? (
            <TraderDetailPanel
              address={selectedAddress}
              trades={[]}
              onClose={() => setSelectedTrader(null)}
            />
          ) : (
            <div className="glass rounded-xl h-full flex flex-col items-center justify-center text-center p-6">
              <div className="w-10 h-10 rounded-lg bg-white/[0.03] flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <p className="text-xs text-gray-600">Click an alert to view trader details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LiveTradePage() {
  return (
    <Suspense fallback={
      <div className="h-[calc(100dvh-120px)] flex items-center justify-center">
        <div className="relative w-8 h-8">
          <div className="absolute inset-0 rounded-full border border-white/10"></div>
          <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
        </div>
      </div>
    }>
      <InsiderFeedContent />
    </Suspense>
  )
}
