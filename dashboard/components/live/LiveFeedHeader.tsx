'use client'

interface LiveFeedHeaderProps {
  isConnected: boolean
  tradeCount: number
  totalSeen: number
  isPaused: boolean
  onTogglePause: () => void
  onClear: () => void
}

export default function LiveFeedHeader({
  isConnected,
  tradeCount,
  totalSeen,
  isPaused,
  onTogglePause,
  onClear,
}: LiveFeedHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-white">Live Feed</h1>
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${
          isConnected ? 'bg-emerald-500/5' : 'bg-red-500/5'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
          }`} />
          <span className={`text-[10px] font-medium ${
            isConnected ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <span className="text-[11px] text-gray-600 tabular-nums">
          {tradeCount} trades{totalSeen > tradeCount ? ` (${totalSeen.toLocaleString()} seen)` : ''}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onClear}
          className="px-2.5 py-1 rounded-md text-[11px] text-gray-500 hover:text-white hover:bg-white/5 transition-all"
        >
          Clear
        </button>
        <button
          onClick={onTogglePause}
          className={`px-2.5 py-1 rounded-md text-[11px] transition-all flex items-center gap-1.5 ${
            isPaused
              ? 'bg-amber-500/10 text-amber-400'
              : 'text-gray-500 hover:text-white hover:bg-white/5'
          }`}
        >
          {isPaused ? (
            <>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Resume
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
              Pause
            </>
          )}
        </button>
      </div>
    </div>
  )
}
