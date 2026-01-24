'use client'

import Link from 'next/link'

interface InsiderDetailsProps {
  address: string | null
  onClose?: () => void
}

export default function InsiderDetails({ address, onClose }: InsiderDetailsProps) {
  const formatAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`

  if (!address) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 h-full flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">Select a trader</div>
          <div className="text-sm">Click on a trade to see trader details</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="truncate">
            <div className="font-semibold font-mono">
              {formatAddress(address)}
            </div>
            <div className="text-xs text-gray-500 font-mono break-all">
              {address}
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="text-center py-8">
          <p className="text-gray-400 mb-4">
            View full trader profile with positions, trades, and metrics.
          </p>
          <Link
            href={`/traders/${address}`}
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium"
          >
            View Full Profile
          </Link>
        </div>

        {/* Quick Links */}
        <div className="space-y-2">
          <a
            href={`https://polymarket.com/profile/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-sm"
          >
            View on Polymarket ↗
          </a>
          <a
            href={`https://polygonscan.com/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-sm"
          >
            View on PolygonScan ↗
          </a>
        </div>
      </div>
    </div>
  )
}
