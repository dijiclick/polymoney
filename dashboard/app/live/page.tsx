'use client'

import { useState, useCallback } from 'react'
import SuspectList from '@/components/SuspectList'
import InsiderFeed from '@/components/InsiderFeed'
import InsiderDetails from '@/components/InsiderDetails'
import InsiderAlerts from '@/components/InsiderAlerts'

export default function InsiderCommandCenter() {
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [activeAddresses, setActiveAddresses] = useState<Set<string>>(new Set())
  const [showAlerts, setShowAlerts] = useState(false)

  // Track which traders are actively trading
  const handleTradeReceived = useCallback((address: string) => {
    setActiveAddresses(prev => {
      const next = new Set(prev)
      next.add(address)
      // Remove after 30 seconds
      setTimeout(() => {
        setActiveAddresses(current => {
          const updated = new Set(current)
          updated.delete(address)
          return updated
        })
      }, 30000)
      return next
    })
  }, [])

  return (
    <div className="h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insider Command Center</h1>
          <p className="text-gray-400 text-sm">
            Real-time monitoring of suspected insider trading activity
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Connected
          </div>
          <button
            onClick={() => setShowAlerts(!showAlerts)}
            className={`px-3 py-1.5 rounded text-sm ${
              showAlerts ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {showAlerts ? 'Show Details' : 'Show Alerts'}
          </button>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid grid-cols-12 gap-4 h-[calc(100%-60px)]">
        {/* Left Panel: Suspect List */}
        <div className="col-span-3 min-h-0">
          <SuspectList
            onSelectTrader={setSelectedAddress}
            selectedAddress={selectedAddress}
            activeAddresses={activeAddresses}
          />
        </div>

        {/* Center Panel: Live Feed */}
        <div className="col-span-6 min-h-0">
          <InsiderFeed
            selectedAddresses={selectedAddress ? [selectedAddress] : []}
            onTradeReceived={handleTradeReceived}
          />
        </div>

        {/* Right Panel: Details or Alerts */}
        <div className="col-span-3 min-h-0">
          {showAlerts ? (
            <InsiderAlerts />
          ) : (
            <InsiderDetails
              address={selectedAddress}
              onClose={() => setSelectedAddress(null)}
            />
          )}
        </div>
      </div>

      {/* Legend / Help */}
      <div className="mt-4 flex items-center justify-between text-xs text-gray-500 border-t border-gray-700 pt-4">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-500/30" /> Score 85+
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-orange-500/30" /> Score 70-84
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-yellow-500/30" /> Score 60-69
          </span>
          <span className="flex items-center gap-1">
            <span className="text-green-400">Active</span> = traded in last 30s
          </span>
        </div>
        <div>
          Run <code className="bg-gray-700 px-1 rounded">py -m src.realtime.service</code> to start monitoring
        </div>
      </div>
    </div>
  )
}
