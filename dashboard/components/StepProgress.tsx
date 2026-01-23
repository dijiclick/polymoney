'use client'

import { StepProgress as StepProgressType } from '@/lib/supabase'

interface StepProgressBarProps {
  step: StepProgressType
}

export default function StepProgressBar({ step }: StepProgressBarProps) {
  const progress = step.total_items > 0
    ? (step.processed_items / step.total_items) * 100
    : 0

  const statusIcon: Record<string, string> = {
    pending: 'Waiting',
    running: 'Running',
    completed: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  }

  const statusColor: Record<string, string> = {
    pending: 'bg-gray-600',
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    skipped: 'bg-yellow-500',
  }

  const formatEta = (seconds?: number) => {
    if (!seconds) return ''
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  }

  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-1">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor[step.status]}`} />
          <span className="font-medium">Step {step.step_number}:</span>
          <span className="text-gray-400">{step.step_name}</span>
          <span className="text-xs text-gray-500">({statusIcon[step.status]})</span>
        </span>
        <span className="text-gray-400">
          {step.processed_items.toLocaleString()} / {step.total_items.toLocaleString()}
          {step.passed_items > 0 && (
            <span className="text-green-400 ml-2">
              ({step.passed_items.toLocaleString()} passed)
            </span>
          )}
          {step.estimated_remaining_seconds && step.status === 'running' && (
            <span className="text-blue-400 ml-2">
              ETA: {formatEta(step.estimated_remaining_seconds)}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            step.status === 'completed' ? 'bg-green-500' :
            step.status === 'running' ? 'bg-blue-500 animate-pulse' :
            step.status === 'failed' ? 'bg-red-500' : 'bg-gray-600'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {step.items_per_second > 0 && step.status === 'running' && (
        <div className="text-xs text-gray-500 mt-1">
          {step.items_per_second.toFixed(1)} items/sec
        </div>
      )}
    </div>
  )
}
