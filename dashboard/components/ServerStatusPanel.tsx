'use client'

import { HealthData } from '@/hooks/useServerHealth'

type Status = 'healthy' | 'degraded' | 'down'

const statusConfig: Record<Status, { color: string; dot: string; label: string }> = {
  healthy: { color: 'text-emerald-400', dot: 'bg-emerald-500', label: 'Healthy' },
  degraded: { color: 'text-amber-400', dot: 'bg-amber-500', label: 'Degraded' },
  down: { color: 'text-red-400', dot: 'bg-red-500', label: 'Down' },
}

const overallConfig: Record<Status, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'All Systems Operational' },
  degraded: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Partial Degradation' },
  down: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'System Issues' },
}

function timeAgo(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

interface ServiceRowProps {
  icon: React.ReactNode
  name: string
  status: Status
  detail?: string
  extra?: string
}

function ServiceRow({ icon, name, status, detail, extra }: ServiceRowProps) {
  const cfg = statusConfig[status]
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">{name}</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
          </div>
        </div>
        {detail && <p className="text-[10px] text-gray-500 mt-0.5">{detail}</p>}
        {extra && <p className="text-[10px] text-gray-600 mt-0.5">{extra}</p>}
      </div>
    </div>
  )
}

interface ServerStatusPanelProps {
  health: HealthData | null
  isLoading: boolean
  error: string | null
  onRefresh: () => void
}

export default function ServerStatusPanel({ health, isLoading, error, onRefresh }: ServerStatusPanelProps) {
  const overall = health?.overall || 'down'
  const oCfg = overallConfig[isLoading ? 'healthy' : (error ? 'down' : overall)]

  return (
    <div className="w-72" style={{ background: 'var(--popover-bg)', border: '1px solid var(--popover-border)' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs font-semibold text-gray-300">System Status</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${oCfg.bg} ${oCfg.text}`}>
          {isLoading ? 'Checking...' : error ? 'Check Failed' : oCfg.label}
        </span>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5 mx-3" />

      {/* Services */}
      <div className="px-4 py-1">
        {isLoading && !health ? (
          <div className="py-6 text-center">
            <div className="w-5 h-5 mx-auto border border-white/10 border-t-white/40 rounded-full animate-spin" />
            <p className="text-[10px] text-gray-600 mt-2">Checking services...</p>
          </div>
        ) : error && !health ? (
          <div className="py-6 text-center">
            <p className="text-[10px] text-red-400">{error}</p>
          </div>
        ) : health ? (
          <>
            <ServiceRow
              icon={
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              }
              name="VPS Trade Monitor"
              status={health.services.vps_service.status}
              detail={health.services.vps_service.detail}
              extra={health.services.vps_service.last_wallet_update
                ? `Wallet updated ${timeAgo(health.services.vps_service.last_wallet_update)}`
                : undefined}
            />

            <div className="h-px bg-white/[0.03]" />

            <ServiceRow
              icon={
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
              name="Polymarket API"
              status={health.services.polymarket_api.status}
              detail={`Latency: ${health.services.polymarket_api.detail}`}
            />

            <div className="h-px bg-white/[0.03]" />

            <ServiceRow
              icon={
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              }
              name="Database"
              status={health.services.supabase.status}
              detail={health.services.supabase.wallet_count !== undefined
                ? `${health.services.supabase.wallet_count.toLocaleString()} wallets`
                : undefined}
              extra={`Latency: ${health.services.supabase.detail}`}
            />
          </>
        ) : null}
      </div>

      {/* Footer */}
      <div className="h-px bg-white/5 mx-3" />
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-[10px] text-gray-600">
          {health?.checked_at ? `Checked ${timeAgo(health.checked_at)}` : 'Not checked yet'}
        </span>
        <button
          onClick={onRefresh}
          className="text-[10px] text-gray-500 hover:text-white transition-colors flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>
  )
}
