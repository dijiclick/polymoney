'use client'

export type TabId = 'all' | 'whales' | 'insider' | 'watchlist' | 'alerts'

interface TradeFeedTabsProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  alertCount?: number
}

const tabIcons: Record<TabId, JSX.Element> = {
  all: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  whales: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  insider: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  watchlist: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  alerts: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
}

export default function TradeFeedTabs({
  activeTab,
  onTabChange,
  alertCount = 0
}: TradeFeedTabsProps) {
  const tabs: { id: TabId; label: string; shortLabel: string; badge?: number }[] = [
    { id: 'all', label: 'All Trades', shortLabel: 'All' },
    { id: 'whales', label: 'Whales ($10K+)', shortLabel: 'Whales' },
    { id: 'insider', label: 'Insiders', shortLabel: 'Insiders' },
    { id: 'watchlist', label: 'Watchlist', shortLabel: 'Watch' },
    { id: 'alerts', label: 'Alerts', shortLabel: 'Alerts', badge: alertCount }
  ]

  return (
    <div className="bg-gray-900/30 backdrop-blur-sm rounded-xl border border-gray-800/50 p-1.5 inline-flex">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2
              ${isActive
                ? 'bg-gray-800 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }
            `}
          >
            <span className={isActive ? 'text-blue-400' : ''}>{tabIcons[tab.id]}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`
                px-1.5 py-0.5 text-xs rounded-full min-w-[18px] text-center font-medium
                ${isActive ? 'bg-red-500 text-white' : 'bg-red-500/80 text-white'}
              `}>
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
