'use client'

import { useState } from 'react'
import InsiderDetails from './InsiderDetails'
import SuspectList from './SuspectList'

interface ContextSidebarProps {
  selectedAddress: string | null
  onSelectTrader: (address: string | null) => void
  activeAddresses?: Set<string>
  showCompactSuspectList?: boolean
}

export default function ContextSidebar({
  selectedAddress,
  onSelectTrader,
  activeAddresses = new Set(),
  showCompactSuspectList = true
}: ContextSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (isCollapsed) {
    return (
      <div className="bg-gray-800 rounded-lg p-2">
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full text-center text-gray-400 hover:text-white py-2"
          title="Expand sidebar"
        >
          <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col">
      {/* Collapse button */}
      <div className="flex justify-end p-2 border-b border-gray-700">
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-gray-400 hover:text-white p-1"
          title="Collapse sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {selectedAddress ? (
          <InsiderDetails
            address={selectedAddress}
            onClose={() => onSelectTrader(null)}
          />
        ) : showCompactSuspectList ? (
          <SuspectList
            onSelectTrader={onSelectTrader}
            selectedAddress={selectedAddress}
            activeAddresses={activeAddresses}
            compact={true}
          />
        ) : (
          <div className="p-6 text-center text-gray-500">
            <div className="text-4xl mb-3">Select a trader</div>
            <div className="text-sm">
              Click on a trade or suspect to view details
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
