'use client'

import { useState } from 'react'
import InsiderDetails from './InsiderDetails'

interface ContextSidebarProps {
  selectedAddress: string | null
  onSelectTrader: (address: string | null) => void
  activeAddresses?: Set<string>
  showCompactSuspectList?: boolean
}

export default function ContextSidebar({
  selectedAddress,
  onSelectTrader,
}: ContextSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  if (isCollapsed) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 p-2">
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full text-center text-gray-400 hover:text-white py-2 transition-colors"
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
    <div className="bg-gray-900/50 backdrop-blur-sm rounded-2xl border border-gray-800/50 h-full flex flex-col overflow-hidden">
      {/* Collapse button */}
      <div className="flex justify-end px-3 py-2 border-b border-gray-800/50">
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-gray-800/50 transition-all"
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
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-800/50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <p className="text-gray-400 font-medium mb-1">No trader selected</p>
            <p className="text-gray-600 text-sm">
              Click on a trade to view trader details
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
