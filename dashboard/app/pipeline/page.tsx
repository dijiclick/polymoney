'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, PipelineRun } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'

export default function PipelineHistoryPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRuns()
  }, [])

  async function fetchRuns() {
    const { data, error } = await supabase
      .from('pipeline_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error fetching runs:', error)
    }

    setRuns(data || [])
    setLoading(false)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString()
  }

  const formatDuration = (start: string, end?: string) => {
    if (!end) return 'In progress...'
    const ms = new Date(end).getTime() - new Date(start).getTime()
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Pipeline History</h1>

      {loading ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          Loading pipeline runs...
        </div>
      ) : runs.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          No pipeline runs found. Start your first pipeline to see history.
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Started</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Duration</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Days</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Found</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Qualified</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Copy</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Bots</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-300">Progress</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-gray-700 hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {formatDate(run.started_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {formatDuration(run.started_at, run.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {run.days_to_scan}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {run.total_addresses_found.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-green-400">
                    {run.final_qualified.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-400">
                    {run.copytrade_found}
                  </td>
                  <td className="px-4 py-3 text-right text-purple-400">
                    {run.bot_found}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            run.status === 'completed' ? 'bg-green-500' :
                            run.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${run.progress_percent}%` }}
                        />
                      </div>
                      <span className="text-sm">{run.progress_percent.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      href={`/pipeline/${run.id}`}
                      className="text-blue-400 hover:underline text-sm"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
