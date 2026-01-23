'use client'

import { useEffect, useState } from 'react'
import { supabase, PipelineRun, StepProgress, LogEntry } from '@/lib/supabase'
import StatCard from '@/components/StatCard'
import StepProgressBar from '@/components/StepProgress'
import LiveLog from '@/components/LiveLog'
import StatusBadge from '@/components/StatusBadge'

export default function Dashboard() {
  const [currentRun, setCurrentRun] = useState<PipelineRun | null>(null)
  const [steps, setSteps] = useState<StepProgress[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Fetch initial data
    fetchCurrentRun()

    // Subscribe to real-time updates
    const runSubscription = supabase
      .channel('pipeline_runs_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_runs' },
        (payload) => {
          console.log('Run updated:', payload)
          if (payload.new) {
            setCurrentRun(payload.new as PipelineRun)
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    const progressSubscription = supabase
      .channel('pipeline_progress_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'pipeline_progress' },
        (payload) => {
          console.log('Progress updated:', payload)
          if (payload.new) {
            const newStep = payload.new as StepProgress
            setSteps(prev =>
              prev.map(s =>
                s.step_number === newStep.step_number ? newStep : s
              )
            )
          }
        }
      )
      .subscribe()

    const logSubscription = supabase
      .channel('pipeline_logs_changes')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pipeline_logs' },
        (payload) => {
          console.log('New log:', payload)
          if (payload.new) {
            setLogs(prev => [payload.new as LogEntry, ...prev.slice(0, 99)])
          }
        }
      )
      .subscribe()

    return () => {
      runSubscription.unsubscribe()
      progressSubscription.unsubscribe()
      logSubscription.unsubscribe()
    }
  }, [])

  async function fetchCurrentRun() {
    const { data } = await supabase
      .from('pipeline_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (data) {
      setCurrentRun(data)
      fetchSteps(data.id)
      fetchLogs(data.id)
    }
  }

  async function fetchSteps(runId: string) {
    const { data } = await supabase
      .from('pipeline_progress')
      .select('*')
      .eq('run_id', runId)
      .order('step_number')

    setSteps(data || [])
  }

  async function fetchLogs(runId: string) {
    const { data } = await supabase
      .from('pipeline_logs')
      .select('*')
      .eq('run_id', runId)
      .order('timestamp', { ascending: false })
      .limit(100)

    setLogs(data || [])
  }

  const formatElapsedTime = (startedAt: string) => {
    const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
    const hours = Math.floor(elapsed / 3600)
    const minutes = Math.floor((elapsed % 3600) / 60)
    const seconds = elapsed % 60

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Pipeline Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-400">
            {isConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Addresses Found"
          value={currentRun?.total_addresses_found || 0}
          icon="Search"
        />
        <StatCard
          title="Qualified"
          value={currentRun?.final_qualified || 0}
          color="green"
          icon="Check"
        />
        <StatCard
          title="Copy Trade"
          value={currentRun?.copytrade_found || 0}
          color="blue"
          icon="Target"
        />
        <StatCard
          title="Bots"
          value={currentRun?.bot_found || 0}
          color="purple"
          icon="Bot"
        />
      </div>

      {/* Pipeline Status */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Pipeline Status</h2>
            {currentRun && <StatusBadge status={currentRun.status} />}
          </div>
          {currentRun && currentRun.status === 'running' && (
            <div className="text-gray-400 text-sm">
              Elapsed: {formatElapsedTime(currentRun.started_at)}
            </div>
          )}
        </div>

        {/* Overall Progress */}
        {currentRun && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Overall Progress</span>
              <span className="font-medium">{currentRun.progress_percent.toFixed(1)}%</span>
            </div>
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  currentRun.status === 'completed' ? 'bg-green-500' :
                  currentRun.status === 'running' ? 'bg-blue-500' :
                  currentRun.status === 'failed' ? 'bg-red-500' : 'bg-gray-600'
                }`}
                style={{ width: `${currentRun.progress_percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Steps Progress */}
        <div className="space-y-2">
          {steps.length > 0 ? (
            steps.map((step) => (
              <StepProgressBar key={step.step_number} step={step} />
            ))
          ) : (
            <div className="text-gray-500 text-center py-4">
              No pipeline run found. Start a pipeline to see progress.
            </div>
          )}
        </div>
      </div>

      {/* Additional Stats Row */}
      {currentRun && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="API Calls"
            value={currentRun.api_calls_made}
          />
          <StatCard
            title="Errors"
            value={currentRun.errors_count}
            color={currentRun.errors_count > 0 ? 'red' : 'gray'}
          />
          <StatCard
            title="Days Scanned"
            value={currentRun.days_to_scan}
          />
          <StatCard
            title="Current Step"
            value={currentRun.current_step_name || 'N/A'}
          />
        </div>
      )}

      {/* Live Log */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Live Activity Log</h2>
        <LiveLog logs={logs} maxHeight="400px" />
      </div>
    </div>
  )
}
