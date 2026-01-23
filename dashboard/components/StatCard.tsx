'use client'

interface StatCardProps {
  title: string
  value: number | string
  color?: 'gray' | 'green' | 'blue' | 'purple' | 'red'
  icon?: string
}

export default function StatCard({ title, value, color = 'gray', icon }: StatCardProps) {
  const colorClasses = {
    gray: 'bg-gray-800',
    green: 'bg-green-900/50 border border-green-500/30',
    blue: 'bg-blue-900/50 border border-blue-500/30',
    purple: 'bg-purple-900/50 border border-purple-500/30',
    red: 'bg-red-900/50 border border-red-500/30',
  }

  const formattedValue = typeof value === 'number' ? value.toLocaleString() : value

  return (
    <div className={`${colorClasses[color]} rounded-lg p-4`}>
      <div className="text-gray-400 text-sm flex items-center gap-2">
        {icon && <span>{icon}</span>}
        {title}
      </div>
      <div className="text-3xl font-bold mt-1">{formattedValue}</div>
    </div>
  )
}
