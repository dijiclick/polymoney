'use client'

export default function TraderDetailEmpty() {
  return (
    <div className="glass rounded-xl h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-gray-400 mb-1">Select a trader</h3>
      <p className="text-xs text-gray-600 max-w-[200px]">
        Click any trade in the feed to view trader details, PnL chart, and positions
      </p>
    </div>
  )
}
