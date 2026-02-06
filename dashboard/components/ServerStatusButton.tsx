'use client'

import { useState, useRef, useEffect } from 'react'
import { useServerHealth } from '@/hooks/useServerHealth'
import ServerStatusPanel from './ServerStatusPanel'

const dotColor: Record<string, string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
}

export default function ServerStatusButton() {
  const [open, setOpen] = useState(false)
  const [isTogglingDiscovery, setIsTogglingDiscovery] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { health, isLoading, error, refetch, setPollInterval } = useServerHealth(60000)

  const handleToggleWalletDiscovery = async () => {
    if (!health || isTogglingDiscovery) return
    const currentlyEnabled = health.services.vps_service.wallet_discovery_enabled !== false

    setIsTogglingDiscovery(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'wallet_discovery_enabled',
          value: !currentlyEnabled,
        }),
      })
      if (res.ok) {
        await refetch()
      }
    } catch (err) {
      console.error('Failed to toggle wallet discovery:', err)
    } finally {
      setIsTogglingDiscovery(false)
    }
  }

  // Faster polling when panel is open
  useEffect(() => {
    setPollInterval(open ? 15000 : 60000)
  }, [open, setPollInterval])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const overall = health?.overall || (isLoading ? undefined : 'down')
  const dot = overall ? dotColor[overall] : 'bg-gray-500'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative p-2 rounded-lg hover:bg-white/5 transition-all text-gray-400 hover:text-white"
        title="System Status"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
        {/* Status dot overlay */}
        <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${dot} ring-2`} style={{ ['--tw-ring-color' as any]: 'var(--background)' }} />
      </button>

      {open && (
        <div className="absolute right-0 md:right-0 top-full mt-2 rounded-xl shadow-2xl overflow-hidden z-50">
          <ServerStatusPanel
            health={health}
            isLoading={isLoading}
            error={error}
            onRefresh={refetch}
            onToggleWalletDiscovery={handleToggleWalletDiscovery}
            isTogglingDiscovery={isTogglingDiscovery}
          />
        </div>
      )}
    </div>
  )
}
