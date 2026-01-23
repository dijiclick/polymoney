'use client'

interface StatusBadgeProps {
  status: string
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-600 text-gray-200',
    running: 'bg-blue-600 text-white animate-pulse',
    completed: 'bg-green-600 text-white',
    failed: 'bg-red-600 text-white',
    cancelled: 'bg-yellow-600 text-white',
  }

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
