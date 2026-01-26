'use client'

export type TabId = 'all' | 'insider' | 'whales'

interface TradeFeedTabsProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const tabIcons: Record<TabId, JSX.Element> = {
  all: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  insider: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  whales: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
}

export default function TradeFeedTabs({
  activeTab,
  onTabChange,
}: TradeFeedTabsProps) {
  const tabs: { id: TabId; label: string; shortLabel: string }[] = [
    { id: 'all', label: 'All Trades', shortLabel: 'All' },
    { id: 'insider', label: 'Insiders', shortLabel: 'Insiders' },
    { id: 'whales', label: 'Whales ($10K+)', shortLabel: 'Whales' },
  ]

  return (
    <div className="inline-flex bg-white/[0.02] rounded-lg p-0.5 border border-white/5">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              relative px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 flex items-center gap-1.5
              ${isActive
                ? 'bg-white/10 text-white'
                : 'text-gray-500 hover:text-gray-300'
              }
            `}
          >
            <span className={isActive ? 'text-white' : 'text-gray-600'}>{tabIcons[tab.id]}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
