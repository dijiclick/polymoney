'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Position {
  conditionId: string
  title: string
  outcome: string
  size: number
  avgPrice: number
  currentPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  endDate?: string
  marketSlug?: string
}

interface ClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  size: number
  avgPrice: number
  finalPrice: number
  realizedPnl: number
  resolvedAt?: string
  isWin: boolean
}

interface TraderData {
  address: string
  username?: string
  positions: Position[]
  closedPositions?: ClosedPosition[]
  closedPositionsCount: number
  metrics?: any
}

interface Props {
  address: string
  username?: string
  isOpen: boolean
  onClose: () => void
}

type Timeframe = '7d' | '30d' | 'all'
type ChartMode = 'cumulative' | 'daily'

interface DayData {
  date: Date
  key: string
  dailyPnl: number
  cumPnl: number
}

// ── Shared helpers ──────────────────────────────────────────────────

function formatChartMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

// ── PnL Chart (both modes) ──────────────────────────────────────────

function PnlChart({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all')
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build day-level data once for both chart modes
  const dayData = useMemo((): DayData[] => {
    if (!closedPositions || closedPositions.length === 0) return []

    const withDates = closedPositions
      .filter(p => p.resolvedAt)
      .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

    if (withDates.length === 0) return []

    const now = Date.now()
    const cutoff = timeframe === '7d' ? now - 7 * 86400000
      : timeframe === '30d' ? now - 30 * 86400000
      : 0

    // Group by day
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

    const allDays = Array.from(dayMap.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())

    let startingPnl = 0
    const filtered: DayData[] = []

    for (const [key, day] of allDays) {
      if (cutoff > 0 && day.date.getTime() < cutoff) {
        startingPnl += day.dailyPnl
      } else {
        filtered.push({ ...day, key, cumPnl: 0 })
      }
    }

    if (filtered.length === 0) return []

    // Compute cumulative PnL
    let cum = startingPnl
    for (const d of filtered) {
      cum += d.dailyPnl
      d.cumPnl = Math.round(cum * 100) / 100
    }

    return filtered
  }, [closedPositions, timeframe])

  // Chart dimensions — dynamic width based on number of days
  const MIN_PX_PER_DAY = 12
  const BASE_W = 800
  const H = 260
  const PX = 32  // horizontal padding for date labels
  const PY = 16

  const W = useMemo(() => {
    const needed = dayData.length * MIN_PX_PER_DAY + 2 * PX
    return Math.max(BASE_W, needed)
  }, [dayData.length])

  const isScrollable = W > BASE_W

  // Auto-scroll to right (most recent) when chart overflows
  useEffect(() => {
    if (isScrollable && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isScrollable, dayData, chartMode])

  // ── X-axis date ticks ────────────────────────────────────────────

  const xAxisTicks = useMemo(() => {
    if (dayData.length === 0) return []

    const tMin = dayData[0].date.getTime()
    const tMax = dayData[dayData.length - 1].date.getTime()
    const tRange = tMax - tMin
    if (tRange === 0) {
      return [{ pct: 50, label: dayData[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }]
    }

    // Pick evenly spaced ticks — more ticks if chart is wider
    const count = Math.min(isScrollable ? Math.max(8, Math.floor(W / 100)) : 6, dayData.length)
    const ticks: { pct: number; label: string }[] = []
    for (let i = 0; i < count; i++) {
      const t = tMin + (tRange * i) / (count - 1)
      const pctInner = (t - tMin) / tRange  // 0..1 within chart area
      const pxFromLeft = PX + pctInner * (W - 2 * PX)
      const pct = (pxFromLeft / W) * 100
      const d = new Date(t)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ticks.push({ pct, label })
    }
    return ticks
  }, [dayData, W, isScrollable])

  // ── Cumulative line chart paths ────────────────────────────────────

  const lineChart = useMemo(() => {
    if (dayData.length === 0) return null

    // Prepend a zero/start anchor
    const points = [...dayData]
    const anchor: DayData = {
      date: new Date(points[0].date.getTime() - 86400000),
      key: '',
      dailyPnl: 0,
      cumPnl: dayData[0].cumPnl - dayData[0].dailyPnl, // startingPnl
    }
    points.unshift(anchor)

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
    const zeroY = PY + (1 - (0 - min) / range) * (H - 2 * PY)

    return { points, xs, ys, linePath, areaPath, min, max, zeroY }
  }, [dayData])

  // ── Bar chart data ─────────────────────────────────────────────────

  const barChart = useMemo(() => {
    if (dayData.length === 0) return null

    const values = dayData.map(d => d.dailyPnl)
    const maxVal = Math.max(...values, 0)
    const minVal = Math.min(...values, 0)
    const range = maxVal - minVal || 1

    const tMin = dayData[0].date.getTime()
    const tMax = dayData[dayData.length - 1].date.getTime()
    const tRange = tMax - tMin || 1

    const barW = Math.max(1, Math.min(8, (W - 2 * PX) / dayData.length * 0.7))
    const zeroY = PY + (1 - (0 - minVal) / range) * (H - 2 * PY)

    const bars = dayData.map((d, i) => {
      const x = dayData.length === 1
        ? W / 2
        : PX + ((d.date.getTime() - tMin) / tRange) * (W - 2 * PX)
      const valY = PY + (1 - (d.dailyPnl - minVal) / range) * (H - 2 * PY)
      const isPos = d.dailyPnl >= 0
      return {
        x: x - barW / 2,
        y: isPos ? valY : zeroY,
        w: barW,
        h: Math.max(1, Math.abs(valY - zeroY)),
        isPos,
        centerX: x,
      }
    })

    return { bars, zeroY, minVal, maxVal }
  }, [dayData])

  // ── Hover handler (smooth, no jumping) ─────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = (e.clientX - rect.left) / rect.width * W

    let data: { xs: number[] } | null = null
    if (chartMode === 'cumulative' && lineChart) {
      data = { xs: lineChart.xs }
    } else if (chartMode === 'daily' && barChart) {
      data = { xs: barChart.bars.map(b => b.centerX) }
    }
    if (!data || data.xs.length === 0) return

    // Binary-ish nearest search
    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < data.xs.length; i++) {
      const dist = Math.abs(data.xs[i] - mouseX)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }

    if (hoverIndexRef.current !== nearest) {
      hoverIndexRef.current = nearest
      setHoverIndex(nearest)
    }
  }, [chartMode, lineChart, barChart])

  const handleMouseLeave = useCallback(() => {
    hoverIndexRef.current = null
    setHoverIndex(null)
  }, [])

  // ── Display values ─────────────────────────────────────────────────

  const lastCumPnl = dayData.length > 0 ? dayData[dayData.length - 1].cumPnl : 0

  const displayInfo = useMemo(() => {
    if (chartMode === 'cumulative') {
      if (hoverIndex !== null && lineChart && lineChart.points[hoverIndex]) {
        const pt = lineChart.points[hoverIndex]
        return { value: pt.cumPnl, date: pt.date, label: 'Cumulative PnL' }
      }
      return { value: lastCumPnl, date: null, label: 'Cumulative PnL' }
    } else {
      if (hoverIndex !== null && dayData[hoverIndex]) {
        const d = dayData[hoverIndex]
        return { value: d.dailyPnl, date: d.date, label: 'Daily PnL' }
      }
      return { value: lastCumPnl, date: null, label: 'Daily PnL' }
    }
  }, [chartMode, hoverIndex, lineChart, dayData, lastCumPnl])

  const isPositive = displayInfo.value >= 0
  const strokeColor = '#34d399'
  const strokeColorNeg = '#f87171'

  if (!closedPositions || closedPositions.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-xs text-gray-600">No position history for chart</p>
      </div>
    )
  }

  return (
    <div className="px-6 pt-5 pb-4">
      {/* Header: value + controls */}
      <div className="flex items-start justify-between mb-4">
        {/* Left: PnL display — fixed height to prevent layout jump */}
        <div className="min-h-[56px]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{displayInfo.label}</p>
          <p className={`text-xl font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatChartMoney(displayInfo.value)}
          </p>
          <p className="text-[10px] text-gray-500 tabular-nums mt-0.5 h-[14px]">
            {displayInfo.date
              ? displayInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '\u00A0'}
          </p>
        </div>

        {/* Right: chart mode + timeframe */}
        <div className="flex items-center gap-2">
          {/* Chart mode toggle */}
          <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
            <button
              onClick={() => setChartMode('cumulative')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                chartMode === 'cumulative' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Cumulative PnL"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1,11 4,7 7,9 10,3 13,5" />
              </svg>
            </button>
            <button
              onClick={() => setChartMode('daily')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                chartMode === 'daily' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              title="Daily PnL"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="2" y1="11" x2="2" y2="5" />
                <line x1="5" y1="11" x2="5" y2="3" />
                <line x1="8" y1="11" x2="8" y2="8" />
                <line x1="11" y1="11" x2="11" y2="6" />
              </svg>
            </button>
          </div>

          {/* Timeframe pills */}
          <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
            {(['7d', '30d', 'all'] as Timeframe[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  timeframe === tf ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tf === 'all' ? 'All' : tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart SVG + date axis (scrollable when many days) */}
      {dayData.length > 0 ? (
        <div
          ref={scrollRef}
          className={isScrollable ? 'overflow-x-auto' : ''}
          style={isScrollable ? { scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' } : undefined}
        >
          <div style={isScrollable ? { minWidth: W } : undefined}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="w-full cursor-crosshair"
              style={{ height: 260 }}
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <linearGradient id="cumGradGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="cumGradRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* ── Cumulative line chart ── */}
              {chartMode === 'cumulative' && lineChart && (
                <>
                  {/* Zero line */}
                  {lineChart.min < 0 && lineChart.max > 0 && (
                    <line x1={PX} y1={lineChart.zeroY} x2={W - PX} y2={lineChart.zeroY}
                      stroke="white" strokeOpacity="0.06" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                  )}

                  {/* Area */}
                  <path d={lineChart.areaPath}
                    fill={lastCumPnl >= 0 ? 'url(#cumGradGreen)' : 'url(#cumGradRed)'} />

                  {/* Line */}
                  <path d={lineChart.linePath} fill="none"
                    stroke={lastCumPnl >= 0 ? strokeColor : strokeColorNeg}
                    strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                  {/* Hover crosshair */}
                  {hoverIndex !== null && lineChart.xs[hoverIndex] !== undefined && (
                    <>
                      <line
                        x1={lineChart.xs[hoverIndex]} y1={0}
                        x2={lineChart.xs[hoverIndex]} y2={H}
                        stroke="white" strokeOpacity="0.12" strokeWidth="1"
                        vectorEffect="non-scaling-stroke" />
                      <circle
                        cx={lineChart.xs[hoverIndex]}
                        cy={lineChart.ys[hoverIndex]}
                        r="4"
                        fill={lineChart.points[hoverIndex].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                        stroke="#0d0d12" strokeWidth="2"
                        vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </>
              )}

              {/* ── Bar chart ── */}
              {chartMode === 'daily' && barChart && (
                <>
                  {/* Zero line */}
                  <line x1={PX} y1={barChart.zeroY} x2={W - PX} y2={barChart.zeroY}
                    stroke="white" strokeOpacity="0.08" strokeWidth="1"
                    vectorEffect="non-scaling-stroke" />

                  {/* Bars */}
                  {barChart.bars.map((bar, i) => (
                    <rect
                      key={i}
                      x={bar.x}
                      y={bar.y}
                      width={bar.w}
                      height={bar.h}
                      rx={Math.min(1.5, bar.w / 2)}
                      fill={bar.isPos ? strokeColor : strokeColorNeg}
                      fillOpacity={hoverIndex === i ? 1 : 0.7}
                    />
                  ))}

                  {/* Hover highlight */}
                  {hoverIndex !== null && barChart.bars[hoverIndex] && (
                    <line
                      x1={barChart.bars[hoverIndex].centerX} y1={0}
                      x2={barChart.bars[hoverIndex].centerX} y2={H}
                      stroke="white" strokeOpacity="0.08" strokeWidth="1"
                      vectorEffect="non-scaling-stroke" />
                  )}
                </>
              )}
            </svg>

            {/* Date axis labels */}
            {xAxisTicks.length > 0 && (
              <div className="relative h-5 mt-1">
                {xAxisTicks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute text-[9px] text-gray-600 tabular-nums -translate-x-1/2"
                    style={{ left: `${tick.pct}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center" style={{ height: 260 }}>
          <p className="text-[10px] text-gray-600">Not enough data for selected timeframe</p>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ───────────────────────────────────────────────────────

export default function TraderDetailModal({ address, username, isOpen, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TraderData | null>(null)
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (isOpen && address) {
      fetchTraderData()
    }
  }, [isOpen, address])

  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  const fetchTraderData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/traders/${address}?refresh=true`)
      if (!res.ok) throw new Error('Failed to fetch trader data')
      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const formatMoney = (value: number) => {
    if (value === undefined || value === null) return '-'
    const absValue = Math.abs(value)
    if (absValue >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
    if (absValue >= 1000) return `$${(value / 1000).toFixed(2)}K`
    return `$${value.toFixed(2)}`
  }

  const formatPercent = (value: number) => {
    if (value === undefined || value === null) return '-'
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  }

  const getPnlColor = (value: number) => {
    if (value === 0) return 'text-gray-500'
    return value > 0 ? 'text-emerald-400' : 'text-red-400'
  }

  const displayName = username && !username.startsWith('0x')
    ? username
    : `${address.slice(0, 6)}...${address.slice(-4)}`

  if (!mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal — nearly full size */}
      <div className="relative bg-[#0d0d12] border border-white/10 rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <span className="text-white font-medium text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <h2 className="text-sm font-medium text-white">{displayName}</h2>
              <a
                href={`https://polymarket.com/profile/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-gray-500 hover:text-gray-400 flex items-center gap-1 transition-colors"
              >
                View on Polymarket
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(95vh-56px)]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative w-8 h-8">
                <div className="absolute inset-0 rounded-full border border-white/10"></div>
                <div className="absolute inset-0 rounded-full border border-transparent border-t-white/40 animate-spin"></div>
              </div>
              <p className="text-gray-600 mt-3 text-xs">Loading...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={fetchTraderData}
                className="mt-3 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs text-white transition-colors"
              >
                Retry
              </button>
            </div>
          ) : data ? (
            <>
              {/* PnL Chart */}
              <PnlChart closedPositions={data.closedPositions || []} />

              {/* Divider */}
              <div className="border-t border-white/5" />

              {/* Tabs */}
              <div className="flex gap-1 px-6 pt-3 pb-3 border-b border-white/5">
                <button
                  onClick={() => setActiveTab('open')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'open'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Open ({data.positions?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('closed')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'closed'
                      ? 'bg-white/10 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Closed ({data.closedPositions?.length || data.closedPositionsCount || 0})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-5">
                {activeTab === 'open' && (
                  <div className="space-y-2">
                    {data.positions && data.positions.length > 0 ? (
                      data.positions.map((position, index) => (
                        <div
                          key={`${position.conditionId}-${position.outcome}-${index}`}
                          className="bg-white/[0.02] rounded-lg p-3 hover:bg-white/[0.04] transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-medium text-gray-300 truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  position.outcome === 'Yes'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {position.outcome}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {position.size?.toFixed(2)} @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-300">
                                {formatMoney(position.currentValue || 0)}
                              </p>
                              <p className={`text-[10px] ${getPnlColor(position.cashPnl || 0)}`}>
                                {formatMoney(position.cashPnl || 0)} ({formatPercent(position.percentPnl || 0)})
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-600 text-xs">
                        No open positions
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'closed' && (
                  <div className="space-y-2">
                    {data.closedPositions && data.closedPositions.length > 0 ? (
                      data.closedPositions.map((position, index) => (
                        <div
                          key={`${position.conditionId}-${index}`}
                          className="bg-white/[0.02] rounded-lg p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-medium text-gray-300 truncate">
                                {position.title || 'Unknown Market'}
                              </h4>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  position.isWin
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {position.isWin ? 'WIN' : 'LOSS'}
                                </span>
                                <span className="text-[10px] text-gray-600">
                                  {position.outcome} @ {(position.avgPrice * 100)?.toFixed(1)}¢
                                </span>
                                {position.resolvedAt && (
                                  <span className="text-[10px] text-gray-500">
                                    {new Date(position.resolvedAt).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-xs ${getPnlColor(position.realizedPnl || 0)}`}>
                                {formatMoney(position.realizedPnl || 0)}
                              </p>
                              <p className="text-[10px] text-gray-600">
                                {position.size?.toFixed(2)} shares
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-gray-600 text-xs">
                        No closed positions
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
