'use client'

interface InsiderFeedHeaderProps {
  isConnected: boolean
  alertCount: number
  onClear: () => void
}

export default function InsiderFeedHeader({ isConnected, alertCount, onClear }: InsiderFeedHeaderProps) {
  return (
    <div className="flex items-center justify-between px-1 py-2">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-[11px] text-gray-500">
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <span className="text-[11px] text-gray-600">
          {alertCount} alert{alertCount !== 1 ? 's' : ''}
        </span>
      </div>
      {alertCount > 0 && (
        <button
          onClick={onClear}
          className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors px-2 py-1 rounded hover:bg-white/5"
        >
          Clear
        </button>
      )}
    </div>
  )
}
