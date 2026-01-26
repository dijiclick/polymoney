'use client'

import { TimePeriod } from '@/lib/supabase'

interface Props {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
}

const periods: { value: TimePeriod; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'all', label: 'All' },
]

export default function TimePeriodSelector({ value, onChange }: Props) {
  return (
    <div className="inline-flex bg-white/[0.02] rounded-lg p-0.5 border border-white/5">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
            value === period.value
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  )
}
