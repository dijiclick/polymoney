'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface ClosedPosition {
  conditionId: string
  title?: string
  outcome?: string
  marketSlug?: string
  size: number
  avgPrice: number
  finalPrice: number
  realizedPnl: number
  resolvedAt?: string
  isWin: boolean
  holdDurationMs?: number  // Time from first BUY to resolution (milliseconds)
}

type Timeframe = '1h' | '6h' | '1d' | '7d' | '30d' | 'all'
type ChartMode = 'cumulative' | 'daily'

interface IntervalData {
  date: Date
  key: string
  intervalPnl: number
  cumPnl: number
}

// Get grouping interval in milliseconds based on timeframe
function getIntervalMs(tf: Timeframe): number {
  switch (tf) {
    case '1h': return 5 * 60 * 1000      // 5 min intervals
    case '6h': return 30 * 60 * 1000     // 30 min intervals
    case '1d': return 60 * 60 * 1000     // 1 hour intervals
    default: return 24 * 60 * 60 * 1000  // daily
  }
}

// Get cutoff time based on timeframe
function getCutoffMs(tf: Timeframe): number {
  const now = Date.now()
  switch (tf) {
    case '1h': return now - 60 * 60 * 1000
    case '6h': return now - 6 * 60 * 60 * 1000
    case '1d': return now - 24 * 60 * 60 * 1000
    case '7d': return now - 7 * 24 * 60 * 60 * 1000
    case '30d': return now - 30 * 24 * 60 * 60 * 1000
    default: return 0
  }
}

// Generate interval key for grouping
function getIntervalKey(date: Date, tf: Timeframe): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = date.getMinutes()

  switch (tf) {
    case '1h': {
      const interval = Math.floor(min / 5) * 5
      return `${y}-${m}-${d}T${h}:${String(interval).padStart(2, '0')}`
    }
    case '6h': {
      const interval = Math.floor(min / 30) * 30
      return `${y}-${m}-${d}T${h}:${String(interval).padStart(2, '0')}`
    }
    case '1d':
      return `${y}-${m}-${d}T${h}:00`
    default:
      return `${y}-${m}-${d}`
  }
}

function formatChartMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export default function PnlChart({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('30d')
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const intervalData = useMemo((): IntervalData[] => {
    if (!closedPositions || closedPositions.length === 0) return []

    const withDates = closedPositions
      .filter(p => p.resolvedAt)
      .sort((a, b) => new Date(a.resolvedAt!).getTime() - new Date(b.resolvedAt!).getTime())

    if (withDates.length === 0) return []

    const cutoff = getCutoffMs(timeframe)

    const intervalMap = new Map<string, { date: Date; intervalPnl: number }>()
    for (const p of withDates) {
      const d = new Date(p.resolvedAt!)
      const key = getIntervalKey(d, timeframe)
      const existing = intervalMap.get(key)
      if (existing) {
        existing.intervalPnl += p.realizedPnl
      } else {
        intervalMap.set(key, { date: d, intervalPnl: p.realizedPnl })
      }
    }

    const allIntervals = Array.from(intervalMap.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())

    const filtered: IntervalData[] = []

    for (const [key, interval] of allIntervals) {
      if (cutoff > 0 && interval.date.getTime() < cutoff) {
        // Skip positions before the selected period
      } else {
        filtered.push({ ...interval, key, cumPnl: 0 })
      }
    }

    if (filtered.length === 0) return []

    let cum = 0
    for (const d of filtered) {
      cum += d.intervalPnl
      d.cumPnl = Math.round(cum * 100) / 100
    }

    return filtered
  }, [closedPositions, timeframe])

  const BASE_W = 800
  const H = 220
  const PX = 32
  const PR = 56
  const PY = 16

  const MIN_PX_PER_INTERVAL_LINE = 16
  const MIN_PX_PER_INTERVAL_BAR = 24

  const W = useMemo(() => {
    const minPx = chartMode === 'daily' ? MIN_PX_PER_INTERVAL_BAR : MIN_PX_PER_INTERVAL_LINE
    const needed = intervalData.length * minPx + PX + PR
    return Math.max(BASE_W, needed)
  }, [intervalData.length, chartMode])

  const isScrollable = W > BASE_W

  useEffect(() => {
    if (isScrollable && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isScrollable, intervalData, chartMode])

  // Format x-axis label based on timeframe
  const formatXAxisLabel = useCallback((date: Date) => {
    if (timeframe === '1h' || timeframe === '6h') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    if (timeframe === '1d') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }, [timeframe])

  const xAxisTicks = useMemo(() => {
    if (intervalData.length === 0) return []

    const tMin = intervalData[0].date.getTime()
    const tMax = intervalData[intervalData.length - 1].date.getTime()
    const tRange = tMax - tMin
    if (tRange === 0) {
      return [{ pct: 50, label: formatXAxisLabel(intervalData[0].date) }]
    }

    const count = Math.min(isScrollable ? Math.max(8, Math.floor(W / 100)) : 6, intervalData.length)
    const ticks: { pct: number; label: string }[] = []
    for (let i = 0; i < count; i++) {
      const t = tMin + (tRange * i) / (count - 1)
      const pctInner = (t - tMin) / tRange
      const pxFromLeft = PX + pctInner * (W - PX - PR)
      const pct = (pxFromLeft / W) * 100
      const d = new Date(t)
      ticks.push({ pct, label: formatXAxisLabel(d) })
    }
    return ticks
  }, [intervalData, W, isScrollable, formatXAxisLabel])

  const lineChart = useMemo(() => {
    if (intervalData.length === 0) return null

    const points = [...intervalData]
    const anchorOffset = getIntervalMs(timeframe)
    const anchor: IntervalData = {
      date: new Date(points[0].date.getTime() - anchorOffset),
      key: '',
      intervalPnl: 0,
      cumPnl: intervalData[0].cumPnl - intervalData[0].intervalPnl,
    }
    points.unshift(anchor)

    const values = points.map(p => p.cumPnl)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const tMin = points[0].date.getTime()
    const tMax = points[points.length - 1].date.getTime()
    const tRange = tMax - tMin || 1

    const xs = points.map(p => PX + ((p.date.getTime() - tMin) / tRange) * (W - PX - PR))
    const ys = points.map(p => PY + (1 - (p.cumPnl - min) / range) * (H - 2 * PY))

    const pts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`)
    const linePath = `M${pts.join('L')}`
    const areaPath = `${linePath}L${xs[xs.length - 1].toFixed(1)},${H}L${xs[0].toFixed(1)},${H}Z`
    const zeroY = PY + (1 - (0 - min) / range) * (H - 2 * PY)

    return { points, xs, ys, linePath, areaPath, min, max, zeroY }
  }, [intervalData, timeframe, W])

  const barChart = useMemo(() => {
    if (intervalData.length === 0) return null

    const values = intervalData.map(d => d.intervalPnl)
    const maxVal = Math.max(...values, 0)
    const minVal = Math.min(...values, 0)
    const range = maxVal - minVal || 1

    const tMin = intervalData[0].date.getTime()
    const tMax = intervalData[intervalData.length - 1].date.getTime()
    const tRange = tMax - tMin || 1

    const barW = Math.max(3, Math.min(14, (W - PX - PR) / intervalData.length * 0.6))
    const zeroY = PY + (1 - (0 - minVal) / range) * (H - 2 * PY)

    const bars = intervalData.map((d) => {
      const x = intervalData.length === 1
        ? (PX + W - PR) / 2
        : PX + ((d.date.getTime() - tMin) / tRange) * (W - PX - PR)
      const valY = PY + (1 - (d.intervalPnl - minVal) / range) * (H - 2 * PY)
      const isPos = d.intervalPnl >= 0
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
  }, [intervalData, W])

  const yAxisTicks = useMemo(() => {
    const TICK_COUNT = 5
    let min: number, max: number
    if (chartMode === 'cumulative' && lineChart) {
      min = lineChart.min
      max = lineChart.max
    } else if (chartMode === 'daily' && barChart) {
      min = barChart.minVal
      max = barChart.maxVal
    } else {
      return []
    }
    const range = max - min || 1
    const ticks: { y: number; label: string }[] = []
    for (let i = 0; i < TICK_COUNT; i++) {
      const val = max - (range * i) / (TICK_COUNT - 1)
      const y = PY + (1 - (val - min) / range) * (H - 2 * PY)
      ticks.push({ y, label: formatChartMoney(val) })
    }
    return ticks
  }, [chartMode, lineChart, barChart])

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
  }, [chartMode, lineChart, barChart, W])

  const handleMouseLeave = useCallback(() => {
    hoverIndexRef.current = null
    setHoverIndex(null)
  }, [])

  // Touch support for mobile chart interaction
  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current || e.touches.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const touchX = (e.touches[0].clientX - rect.left) / rect.width * W

    let data: { xs: number[] } | null = null
    if (chartMode === 'cumulative' && lineChart) {
      data = { xs: lineChart.xs }
    } else if (chartMode === 'daily' && barChart) {
      data = { xs: barChart.bars.map(b => b.centerX) }
    }
    if (!data || data.xs.length === 0) return

    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < data.xs.length; i++) {
      const dist = Math.abs(data.xs[i] - touchX)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }

    if (hoverIndexRef.current !== nearest) {
      hoverIndexRef.current = nearest
      setHoverIndex(nearest)
    }
  }, [chartMode, lineChart, barChart, W])

  const handleTouchEnd = useCallback(() => {
    hoverIndexRef.current = null
    setHoverIndex(null)
  }, [])

  const lastCumPnl = intervalData.length > 0 ? intervalData[intervalData.length - 1].cumPnl : 0

  // Get the appropriate label for the current timeframe
  const getIntervalLabel = useCallback(() => {
    if (timeframe === '1h' || timeframe === '6h') return '5min PnL'
    if (timeframe === '1d') return 'Hourly PnL'
    return 'Daily PnL'
  }, [timeframe])

  // Format date/time for display based on timeframe
  const formatDisplayDate = useCallback((date: Date) => {
    if (timeframe === '1h' || timeframe === '6h' || timeframe === '1d') {
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }, [timeframe])

  const displayInfo = useMemo(() => {
    if (chartMode === 'cumulative') {
      if (hoverIndex !== null && lineChart && lineChart.points[hoverIndex]) {
        const pt = lineChart.points[hoverIndex]
        return { value: pt.cumPnl, date: pt.date, label: 'Cumulative PnL' }
      }
      return { value: lastCumPnl, date: null, label: 'Cumulative PnL' }
    } else {
      if (hoverIndex !== null && intervalData[hoverIndex]) {
        const d = intervalData[hoverIndex]
        return { value: d.intervalPnl, date: d.date, label: getIntervalLabel() }
      }
      return { value: lastCumPnl, date: null, label: getIntervalLabel() }
    }
  }, [chartMode, hoverIndex, lineChart, intervalData, lastCumPnl, getIntervalLabel])

  // Fullscreen escape handler
  useEffect(() => {
    if (!isFullscreen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isFullscreen])

  const isPositive = displayInfo.value >= 0
  const strokeColor = '#34d399'
  const strokeColorNeg = '#f87171'

  if (!closedPositions || closedPositions.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-xs text-gray-600">No position history for chart</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-4 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-h-[48px]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{displayInfo.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatChartMoney(displayInfo.value)}
          </p>
          <p className="text-[10px] text-gray-500 tabular-nums mt-0.5 h-[14px]">
            {displayInfo.date
              ? formatDisplayDate(displayInfo.date)
              : '\u00A0'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
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
              title="Interval PnL"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="2" y1="11" x2="2" y2="5" />
                <line x1="5" y1="11" x2="5" y2="3" />
                <line x1="8" y1="11" x2="8" y2="8" />
                <line x1="11" y1="11" x2="11" y2="6" />
              </svg>
            </button>
          </div>

          <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
            {(['1h', '6h', '1d', '7d', '30d', 'all'] as Timeframe[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  timeframe === tf ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tf === 'all' ? 'All' : tf.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsFullscreen(true)}
            className="p-1.5 rounded-md bg-white/[0.03] text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            title="Fullscreen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
            </svg>
          </button>
        </div>
      </div>

      {intervalData.length > 0 ? (
        <div
          ref={scrollRef}
          className={isScrollable ? 'overflow-x-auto' : ''}
          style={isScrollable ? { scrollbarWidth: 'thin', scrollbarColor: 'var(--scrollbar-thumb) transparent', WebkitOverflowScrolling: 'touch' as any } : undefined}
        >
          <div style={isScrollable ? { minWidth: W } : undefined}>
            <div className="relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="w-full"
              style={{ height: 220, touchAction: 'pan-x' }}
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <defs>
                <linearGradient id="panelCumGradGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="panelCumGradRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
                </linearGradient>
              </defs>

              {chartMode === 'cumulative' && lineChart && (
                <>
                  {lineChart.min < 0 && lineChart.max > 0 && (
                    <line x1={PX} y1={lineChart.zeroY} x2={W - PR} y2={lineChart.zeroY}
                      stroke="var(--text-muted)" strokeOpacity="0.15" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                  )}

                  <path d={lineChart.areaPath}
                    fill={lastCumPnl >= 0 ? 'url(#panelCumGradGreen)' : 'url(#panelCumGradRed)'} />

                  <path d={lineChart.linePath} fill="none"
                    stroke={lastCumPnl >= 0 ? strokeColor : strokeColorNeg}
                    strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                  {lineChart.points.length <= 200 && lineChart.xs.map((x, i) => {
                    if (i === 0) return null
                    const isHovered = hoverIndex === i
                    if (isHovered) return null
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={lineChart.ys[i]}
                        r="2"
                        fill={lineChart.points[i].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                        fillOpacity="0.6"
                        stroke="var(--background)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  })}

                  {hoverIndex !== null && lineChart.xs[hoverIndex] !== undefined && (
                    <>
                      <line
                        x1={lineChart.xs[hoverIndex]} y1={0}
                        x2={lineChart.xs[hoverIndex]} y2={H}
                        stroke="var(--text-muted)" strokeOpacity="0.3" strokeWidth="1"
                        vectorEffect="non-scaling-stroke" />
                      <circle
                        cx={lineChart.xs[hoverIndex]}
                        cy={lineChart.ys[hoverIndex]}
                        r="4"
                        fill={lineChart.points[hoverIndex].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                        stroke="var(--background)" strokeWidth="2"
                        vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </>
              )}

              {chartMode === 'daily' && barChart && (
                <>
                  <line x1={PX} y1={barChart.zeroY} x2={W - PR} y2={barChart.zeroY}
                    stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="1"
                    vectorEffect="non-scaling-stroke" />

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

                  {hoverIndex !== null && barChart.bars[hoverIndex] && (
                    <line
                      x1={barChart.bars[hoverIndex].centerX} y1={0}
                      x2={barChart.bars[hoverIndex].centerX} y2={H}
                      stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="1"
                      vectorEffect="non-scaling-stroke" />
                  )}
                </>
              )}

            </svg>
            {yAxisTicks.map((tick, i) => (
              <span
                key={i}
                className="absolute right-1 text-[9px] text-gray-500 tabular-nums font-mono pointer-events-none"
                style={{ top: `${(tick.y / H) * 100}%`, transform: 'translateY(-50%)' }}
              >
                {tick.label}
              </span>
            ))}
            </div>

            {xAxisTicks.length > 0 && (
              <div className="relative h-4 mt-1">
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
        <div className="flex items-center justify-center" style={{ height: 220 }}>
          <p className="text-[10px] text-gray-600">Not enough data for selected timeframe</p>
        </div>
      )}

      {/* Fullscreen overlay */}
      {isFullscreen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: 'var(--background)' }}>
          {/* Fullscreen header */}
          <div className="flex flex-wrap items-start justify-between gap-2 px-4 md:px-6 pt-4 md:pt-5 pb-2">
            <div className="min-h-[48px]">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-0.5">{displayInfo.label}</p>
              <p className={`text-xl md:text-2xl font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatChartMoney(displayInfo.value)}
              </p>
              <p className="text-[11px] text-gray-500 tabular-nums mt-0.5 h-[16px]">
                {displayInfo.date
                  ? formatDisplayDate(displayInfo.date)
                  : '\u00A0'}
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                <button
                  onClick={() => setChartMode('cumulative')}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    chartMode === 'cumulative' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Cumulative PnL"
                >
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,11 4,7 7,9 10,3 13,5" />
                  </svg>
                </button>
                <button
                  onClick={() => setChartMode('daily')}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                    chartMode === 'daily' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                  title="Interval PnL"
                >
                  <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="2" y1="11" x2="2" y2="5" />
                    <line x1="5" y1="11" x2="5" y2="3" />
                    <line x1="8" y1="11" x2="8" y2="8" />
                    <line x1="11" y1="11" x2="11" y2="6" />
                  </svg>
                </button>
              </div>

              <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                {(['1h', '6h', '1d', '7d', '30d', 'all'] as Timeframe[]).map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      timeframe === tf ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {tf === 'all' ? 'All' : tf.toUpperCase()}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setIsFullscreen(false)}
                className="p-1.5 rounded-md bg-white/[0.03] text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                title="Exit fullscreen"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h3a2 2 0 012 2v3m6-18v3a2 2 0 002 2h3M3 10V7a2 2 0 012-2h3m8 16v-3a2 2 0 012-2h3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Fullscreen chart */}
          <div className="flex-1 px-3 md:px-6 pb-4 md:pb-6 min-h-0">
            {intervalData.length > 0 ? (
              <div className="h-full flex flex-col">
                <div className="flex-1 min-h-0 relative">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-full"
                    style={{ touchAction: 'pan-x' }}
                    preserveAspectRatio="none"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  >
                    <defs>
                      <linearGradient id="fsCumGradGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
                        <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                      </linearGradient>
                      <linearGradient id="fsCumGradRed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity="0.10" />
                        <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {chartMode === 'cumulative' && lineChart && (
                      <>
                        {lineChart.min < 0 && lineChart.max > 0 && (
                          <line x1={PX} y1={lineChart.zeroY} x2={W - PR} y2={lineChart.zeroY}
                            stroke="var(--text-muted)" strokeOpacity="0.15" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                        )}
                        <path d={lineChart.areaPath}
                          fill={lastCumPnl >= 0 ? 'url(#fsCumGradGreen)' : 'url(#fsCumGradRed)'} />
                        <path d={lineChart.linePath} fill="none"
                          stroke={lastCumPnl >= 0 ? strokeColor : strokeColorNeg}
                          strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                        {lineChart.points.length <= 200 && lineChart.xs.map((x, i) => {
                          if (i === 0) return null
                          const isHovered = hoverIndex === i
                          if (isHovered) return null
                          return (
                            <circle key={i} cx={x} cy={lineChart.ys[i]} r="2.5"
                              fill={lineChart.points[i].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                              fillOpacity="0.6" stroke="var(--background)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                          )
                        })}
                        {hoverIndex !== null && lineChart.xs[hoverIndex] !== undefined && (
                          <>
                            <line x1={lineChart.xs[hoverIndex]} y1={0} x2={lineChart.xs[hoverIndex]} y2={H}
                              stroke="var(--text-muted)" strokeOpacity="0.3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            <circle cx={lineChart.xs[hoverIndex]} cy={lineChart.ys[hoverIndex]} r="5"
                              fill={lineChart.points[hoverIndex].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                              stroke="var(--background)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          </>
                        )}
                      </>
                    )}

                    {chartMode === 'daily' && barChart && (
                      <>
                        <line x1={PX} y1={barChart.zeroY} x2={W - PR} y2={barChart.zeroY}
                          stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        {barChart.bars.map((bar, i) => (
                          <rect key={i} x={bar.x} y={bar.y} width={bar.w} height={bar.h}
                            rx={Math.min(1.5, bar.w / 2)}
                            fill={bar.isPos ? strokeColor : strokeColorNeg}
                            fillOpacity={hoverIndex === i ? 1 : 0.7} />
                        ))}
                        {hoverIndex !== null && barChart.bars[hoverIndex] && (
                          <line x1={barChart.bars[hoverIndex].centerX} y1={0} x2={barChart.bars[hoverIndex].centerX} y2={H}
                            stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        )}
                      </>
                    )}

                  </svg>
                  {yAxisTicks.map((tick, i) => (
                    <span
                      key={i}
                      className="absolute right-1 text-[10px] text-gray-500 tabular-nums font-mono pointer-events-none"
                      style={{ top: `${(tick.y / H) * 100}%`, transform: 'translateY(-50%)' }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>

                {xAxisTicks.length > 0 && (
                  <div className="relative h-5 mt-1 flex-shrink-0">
                    {xAxisTicks.map((tick, i) => (
                      <span key={i}
                        className="absolute text-[10px] text-gray-600 tabular-nums -translate-x-1/2"
                        style={{ left: `${tick.pct}%` }}>
                        {tick.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-600">Not enough data for selected timeframe</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
