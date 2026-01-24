'use client'

export type TabId = 'all' | 'whales' | 'insider' | 'watchlist' | 'alerts'

interface TradeFeedTabsProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  alertCount?: number
}

export default function TradeFeedTabs({
  activeTab,
  onTabChange,
  alertCount = 0
}: TradeFeedTabsProps) {
  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'all', label: 'All Trades' },
    { id: 'whales', label: 'Whales ($10K+)' },
    { id: 'insider', label: 'Insiders' },
    { id: 'watchlist', label: 'Watchlist' },
    { id: 'alerts', label: 'Alerts', badge: alertCount }
  ]

  return (
    <div className="flex border-b border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            relative px-6 py-3 text-sm font-medium transition-colors
            ${activeTab === tab.id
              ? 'text-white border-b-2 border-blue-500 bg-gray-800/50'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/30'
            }
          `}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-red-500 text-white min-w-[20px] text-center">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  )
}
