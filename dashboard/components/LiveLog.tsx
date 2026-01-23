'use client'

import { LogEntry } from '@/lib/supabase'

interface LiveLogProps {
  logs: LogEntry[]
  maxHeight?: string
}

export default function LiveLog({ logs, maxHeight = '320px' }: LiveLogProps) {
  const levelColors: Record<string, string> = {
    debug: 'text-gray-500',
    info: 'text-gray-300',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  }

  const levelIcons: Record<string, string> = {
    debug: '',
    info: '',
    success: '',
    warning: '',
    error: '',
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  return (
    <div
      className="font-mono text-sm space-y-1 overflow-y-auto"
      style={{ maxHeight }}
    >
      {logs.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          No logs yet. Start the pipeline to see activity.
        </div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className={`${levelColors[log.level]} flex gap-2`}>
            <span className="text-gray-500 flex-shrink-0">
              {formatTime(log.timestamp)}
            </span>
            <span className="flex-shrink-0">{levelIcons[log.level]}</span>
            <span className="break-all">{log.message}</span>
          </div>
        ))
      )}
    </div>
  )
}
