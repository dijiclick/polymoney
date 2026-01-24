'use client'

import { TimePeriod } from '@/lib/supabase'

interface Props {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
}

const periods: { value: TimePeriod; label: string; shortLabel: string }[] = [
  { value: '7d', label: '7 Days', shortLabel: '7D' },
  { value: '30d', label: '30 Days', shortLabel: '30D' },
]

export default function TimePeriodSelector({ value, onChange }: Props) {
  return (
    <div className="inline-flex bg-gray-800/50 rounded-xl p-1 border border-gray-700/50">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`relative px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            value === period.value
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
              : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
          }`}
        >
          <span className="hidden sm:inline">{period.label}</span>
          <span className="sm:hidden">{period.shortLabel}</span>
        </button>
      ))}
    </div>
  )
}
