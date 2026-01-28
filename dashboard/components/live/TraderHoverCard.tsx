'use client'

import { useState, useRef, useEffect, useCallback, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ClosedPosition } from './PnlChart'

interface DayData {
  date: Date
  dailyPnl: number
  cumPnl: number
}

// Module-level cache for fetched trader data
const traderCache = new Map<string, { closedPositions: ClosedPosition[]; totalPnl: number; winRate: number; posCount: number }>()

function formatChartMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function buildDayData(closedPositions: ClosedPosition[]): DayData[] {
  const withDates = closedPositions
    .filter(p => p.resolvedAt)
    .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

  if (withDates.length === 0) return []

  const dayMap = new Map<string, { date: Date; dailyPnl: number }>()
  for (const p of withDates) {
    const d = new Date(p.resolvedAt!)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const existing = dayMap.get(key)
    if (existing) {
      existing.dailyPnl += p.realizedPnl
    } else {
      dayMap.set(key, { date: d, dailyPnl: p.realizedPnl })
    }
  }

  const allDays = Array.from(dayMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime())

  let cum = 0
  return allDays.map(day => {
    cum += day.dailyPnl
    return { date: day.date, dailyPnl: day.dailyPnl, cumPnl: Math.round(cum * 100) / 100 }
  })
}

function MiniPnlChart({ dayData }: { dayData: DayData[] }) {
  const W = 260
  const H = 80
  const PX = 4
  const PY = 6

  if (dayData.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ width: W, height: H }}>
        <p className="text-[9px] text-gray-600">Not enough data</p>
      </div>
    )
  }

  const anchor: DayData = {
    date: new Date(dayData[0].date.getTime() - 86400000),
    dailyPnl: 0,
    cumPnl: dayData[0].cumPnl - dayData[0].dailyPnl,
  }
  const points = [anchor, ...dayData]

  const values = points.map(p => p.cumPnl)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const tMin = points[0].date.getTime()
  const tMax = points[points.length - 1].date.getTime()
  const tRange = tMax - tMin || 1

  const xs = points.map(p => PX + ((p.date.getTime() - tMin) / tRange) * (W - 2 * PX))
  const ys = points.map(p => PY + (1 - (p.cumPnl - min) / range) * (H - 2 * PY))

  const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`)
  const linePath = `M${pts.join('L')}`
  const areaPath = `${linePath}L${xs[xs.length - 1].toFixed(1)},${H}L${xs[0].toFixed(1)},${H}Z`

  const lastPnl = dayData[dayData.length - 1].cumPnl
  const isPositive = lastPnl >= 0
  const strokeColor = isPositive ? '#34d399' : '#f87171'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <defs>
        <linearGradient id="hoverGradGreen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hoverGradRed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f87171" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={isPositive ? 'url(#hoverGradGreen)' : 'url(#hoverGradRed)'} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

interface TraderHoverCardProps {
  address: string
  children: ReactNode
}

export default function TraderHoverCard({ address, children }: TraderHoverCardProps) {
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ dayData: DayData[]; totalPnl: number; winRate: number; posCount: number } | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    const cached = traderCache.get(address)
    if (cached) {
      const dayData = buildDayData(cached.closedPositions)
      setData({ dayData, totalPnl: cached.totalPnl, winRate: cached.winRate, posCount: cached.posCount })
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/traders/${address}?refresh=false`)
      if (!res.ok) throw new Error('Failed')
      const result = await res.json()
      const closedPositions: ClosedPosition[] = result.closedPositions || []
      const totalPnl = result.metrics?.totalPnl || 0
      const winRate = result.metrics?.winRateAllTime || 0
      const posCount = closedPositions.length

      traderCache.set(address, { closedPositions, totalPnl, winRate, posCount })

      const dayData = buildDayData(closedPositions)
      setData({ dayData, totalPnl, winRate, posCount })
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [address])

  const handleMouseEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
    enterTimer.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setPos({ x: rect.left, y: rect.bottom + 6 })
      }
      setShow(true)
      fetchData()
    }, 350)
  }, [fetchData])

  const handleMouseLeave = useCallback(() => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current)
      enterTimer.current = null
    }
    leaveTimer.current = setTimeout(() => {
      setShow(false)
    }, 200)
  }, [])

  const handleCardEnter = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current)
      leaveTimer.current = null
    }
  }, [])

  const handleCardLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      setShow(false)
    }, 150)
  }, [])

  useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
  }, [])

  // Adjust position if card goes off-screen
  const adjustedPos = { ...pos }
  if (typeof window !== 'undefined' && show) {
    const cardW = 268
    const cardH = 92
    if (adjustedPos.x + cardW > window.innerWidth - 8) {
      adjustedPos.x = window.innerWidth - cardW - 8
    }
    if (adjustedPos.x < 8) adjustedPos.x = 8
    if (adjustedPos.y + cardH > window.innerHeight - 8) {
      // Show above instead
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        adjustedPos.y = rect.top - cardH - 6
      }
    }
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline"
      >
        {children}
      </span>
      {show && typeof document !== 'undefined' && createPortal(
        <div
          ref={cardRef}
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleCardLeave}
          className="fixed z-[9998] bg-[#12121a] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
          style={{ left: adjustedPos.x, top: adjustedPos.y, width: 268 }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="relative w-5 h-5">
                <div className="absolute inset-0 rounded-full border border-white/10"></div>
                <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
              </div>
            </div>
          ) : data ? (
            <div className="p-1.5">
              <MiniPnlChart dayData={data.dayData} />
            </div>
          ) : (
            <div className="flex items-center justify-center py-5">
              <p className="text-[10px] text-gray-600">No data available</p>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
