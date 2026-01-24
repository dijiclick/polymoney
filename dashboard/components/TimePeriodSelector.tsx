'use client'

import { TimePeriod } from '@/lib/supabase'

interface Props {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
}

const periods: { value: TimePeriod; label: string }[] = [
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: 'all', label: 'All Time' },
]

export default function TimePeriodSelector({ value, onChange }: Props) {
  return (
    <div className="flex gap-2 mb-6">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            value === period.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {period.label}
        </button>
      ))}
    </div>
  )
}
