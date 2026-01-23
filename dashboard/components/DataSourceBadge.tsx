interface DataSourceBadgeProps {
  source: 'database' | 'live' | 'mixed'
  freshness: 'fresh' | 'cached' | 'stale'
  cachedAt?: string
  onRefresh?: () => void
  refreshing?: boolean
}

export default function DataSourceBadge({
  source,
  freshness,
  cachedAt,
  onRefresh,
  refreshing,
}: DataSourceBadgeProps) {
  const getSourceLabel = () => {
    if (freshness === 'fresh' && source === 'live') return 'Live Data'
    if (freshness === 'stale') return 'Stale Cache'
    if (freshness === 'cached') return 'Cached'
    return 'Live + Cached'
  }

  const getSourceColor = () => {
    if (freshness === 'fresh') return 'bg-green-600'
    if (freshness === 'stale') return 'bg-yellow-600'
    return 'bg-blue-600'
  }

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  return (
    <div className="flex items-center gap-3">
      <span className={`${getSourceColor()} px-3 py-1 rounded-full text-sm font-medium`}>
        {getSourceLabel()}
      </span>

      {cachedAt && freshness !== 'fresh' && (
        <span className="text-gray-400 text-sm">
          Updated {formatTimeAgo(cachedAt)}
        </span>
      )}

      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 disabled:opacity-50"
        >
          <svg
            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      )}
    </div>
  )
}
