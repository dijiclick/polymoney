'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase, PipelineRun, StepProgress, LogEntry } from '@/lib/supabase'
import StatCard from '@/components/StatCard'
import StepProgressBar from '@/components/StepProgress'
import LiveLog from '@/components/LiveLog'
import StatusBadge from '@/components/StatusBadge'

export default function PipelineDetailPage() {
  const params = useParams()
  const runId = params.id as string

  const [run, setRun] = useState<PipelineRun | null>(null)
  const [steps, setSteps] = useState<StepProgress[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (runId) {
      fetchRun()
      fetchSteps()
      fetchLogs()
    }
  }, [runId])

  async function fetchRun() {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .eq('id', runId)
      .single()

    if (error) {
      console.error('Error fetching run:', error)
    }

    setRun(data)
    setLoading(false)
  }

  async function fetchSteps() {
    const { data, error } = await supabase
      .from('pipeline_progress')
      .select('*')
      .eq('run_id', runId)
      .order('step_number')

    if (error) {
      console.error('Error fetching steps:', error)
    }

    setSteps(data || [])
  }

  async function fetchLogs() {
    const { data, error } = await supabase
      .from('pipeline_logs')
      .select('*')
      .eq('run_id', runId)
      .order('timestamp', { ascending: false })
      .limit(500)

    if (error) {
      console.error('Error fetching logs:', error)
    }

    setLogs(data || [])
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString()
  }

  const formatDuration = (start: string, end?: string) => {
    const endTime = end ? new Date(end).getTime() : Date.now()
    const ms = endTime - new Date(start).getTime()
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-400">
        Loading pipeline run...
      </div>
    )
  }

  if (!run) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-bold text-red-400 mb-4">Pipeline Run Not Found</h2>
        <p className="text-gray-400 mb-4">
          The pipeline run with this ID was not found.
        </p>
        <Link href="/pipeline" className="text-blue-400 hover:underline">
          Back to Pipeline History
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <h1 className="text-3xl font-bold">Pipeline Run Details</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-gray-400 font-mono text-sm">{run.id}</p>
        </div>
        <Link href="/pipeline" className="text-blue-400 hover:underline">
          Back to History
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Addresses Found"
          value={run.total_addresses_found}
        />
        <StatCard
          title="Qualified"
          value={run.final_qualified}
          color="green"
        />
        <StatCard
          title="Copy Trade"
          value={run.copytrade_found}
          color="blue"
        />
        <StatCard
          title="Bots"
          value={run.bot_found}
          color="purple"
        />
      </div>

      {/* Run Info */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Run Information</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <dt className="text-gray-400 text-sm">Started</dt>
            <dd className="font-medium">{formatDate(run.started_at)}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">Duration</dt>
            <dd className="font-medium">{formatDuration(run.started_at, run.completed_at)}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">Days Scanned</dt>
            <dd className="font-medium">{run.days_to_scan}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">API Calls</dt>
            <dd className="font-medium">{run.api_calls_made.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">Progress</dt>
            <dd className="font-medium">{run.progress_percent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">Errors</dt>
            <dd className={`font-medium ${run.errors_count > 0 ? 'text-red-400' : ''}`}>
              {run.errors_count}
            </dd>
          </div>
          <div>
            <dt className="text-gray-400 text-sm">Current Step</dt>
            <dd className="font-medium">{run.current_step_name}</dd>
          </div>
          {run.last_error && (
            <div className="col-span-2">
              <dt className="text-gray-400 text-sm">Last Error</dt>
              <dd className="font-medium text-red-400">{run.last_error}</dd>
            </div>
          )}
        </div>
      </div>

      {/* Step Progress */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Step Progress</h2>
        <div className="space-y-2">
          {steps.map((step) => (
            <StepProgressBar key={step.step_number} step={step} />
          ))}
        </div>
      </div>

      {/* Step Stats Table */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Step Statistics</h2>
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-sm">
              <th className="text-left pb-3">Step</th>
              <th className="text-right pb-3">Total</th>
              <th className="text-right pb-3">Processed</th>
              <th className="text-right pb-3">Passed</th>
              <th className="text-right pb-3">Failed</th>
              <th className="text-right pb-3">Pass Rate</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => {
              const passRate = step.processed_items > 0
                ? ((step.passed_items / step.processed_items) * 100).toFixed(1)
                : '0.0'
              return (
                <tr key={step.step_number} className="border-t border-gray-700">
                  <td className="py-3">
                    <span className="text-gray-400">Step {step.step_number}:</span>{' '}
                    {step.step_name}
                  </td>
                  <td className="py-3 text-right">{step.total_items.toLocaleString()}</td>
                  <td className="py-3 text-right">{step.processed_items.toLocaleString()}</td>
                  <td className="py-3 text-right text-green-400">
                    {step.passed_items.toLocaleString()}
                  </td>
                  <td className="py-3 text-right text-red-400">
                    {step.failed_items.toLocaleString()}
                  </td>
                  <td className="py-3 text-right">{passRate}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Logs */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Activity Log ({logs.length} entries)</h2>
        <LiveLog logs={logs} maxHeight="600px" />
      </div>
    </div>
  )
}
