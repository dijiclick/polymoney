'use client'

import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface ClosedPosition {
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

type Timeframe = '7d' | '30d' | 'all'
type ChartMode = 'cumulative' | 'daily'

interface DayData {
  date: Date
  key: string
  dailyPnl: number
  cumPnl: number
}

function formatChartMoney(v: number) {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : v > 0 ? '+' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export default function PnlChart({ closedPositions }: { closedPositions: ClosedPosition[] }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('all')
  const [chartMode, setChartMode] = useState<ChartMode>('cumulative')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

    let cum = startingPnl
    for (const d of filtered) {
      cum += d.dailyPnl
      d.cumPnl = Math.round(cum * 100) / 100
    }

    return filtered
  }, [closedPositions, timeframe])

  const BASE_W = 800
  const H = 220
  const PX = 32
  const PR = 56
  const PY = 16

  const MIN_PX_PER_DAY_LINE = 16
  const MIN_PX_PER_DAY_BAR = 24

  const W = useMemo(() => {
    const minPx = chartMode === 'daily' ? MIN_PX_PER_DAY_BAR : MIN_PX_PER_DAY_LINE
    const needed = dayData.length * minPx + PX + PR
    return Math.max(BASE_W, needed)
  }, [dayData.length, chartMode])

  const isScrollable = W > BASE_W

  useEffect(() => {
    if (isScrollable && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [isScrollable, dayData, chartMode])

  const xAxisTicks = useMemo(() => {
    if (dayData.length === 0) return []

    const tMin = dayData[0].date.getTime()
    const tMax = dayData[dayData.length - 1].date.getTime()
    const tRange = tMax - tMin
    if (tRange === 0) {
      return [{ pct: 50, label: dayData[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }]
    }

    const count = Math.min(isScrollable ? Math.max(8, Math.floor(W / 100)) : 6, dayData.length)
    const ticks: { pct: number; label: string }[] = []
    for (let i = 0; i < count; i++) {
      const t = tMin + (tRange * i) / (count - 1)
      const pctInner = (t - tMin) / tRange
      const pxFromLeft = PX + pctInner * (W - PX - PR)
      const pct = (pxFromLeft / W) * 100
      const d = new Date(t)
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ticks.push({ pct, label })
    }
    return ticks
  }, [dayData, W, isScrollable])

  const lineChart = useMemo(() => {
    if (dayData.length === 0) return null

    const points = [...dayData]
    const anchor: DayData = {
      date: new Date(points[0].date.getTime() - 86400000),
      key: '',
      dailyPnl: 0,
      cumPnl: dayData[0].cumPnl - dayData[0].dailyPnl,
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
  }, [dayData, W])

  const barChart = useMemo(() => {
    if (dayData.length === 0) return null

    const values = dayData.map(d => d.dailyPnl)
    const maxVal = Math.max(...values, 0)
    const minVal = Math.min(...values, 0)
    const range = maxVal - minVal || 1

    const tMin = dayData[0].date.getTime()
    const tMax = dayData[dayData.length - 1].date.getTime()
    const tRange = tMax - tMin || 1

    const barW = Math.max(3, Math.min(14, (W - PX - PR) / dayData.length * 0.6))
    const zeroY = PY + (1 - (0 - minVal) / range) * (H - 2 * PY)

    const bars = dayData.map((d) => {
      const x = dayData.length === 1
        ? (PX + W - PR) / 2
        : PX + ((d.date.getTime() - tMin) / tRange) * (W - PX - PR)
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
  }, [dayData, W])

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
      <div className="flex items-start justify-between mb-3">
        <div className="min-h-[48px]">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">{displayInfo.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatChartMoney(displayInfo.value)}
          </p>
          <p className="text-[10px] text-gray-500 tabular-nums mt-0.5 h-[14px]">
            {displayInfo.date
              ? displayInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '\u00A0'}
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <div className="flex gap-0.5 bg-white/[0.03] rounded-md p-0.5">
            {(['7d', '30d', 'all'] as Timeframe[]).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
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

      {dayData.length > 0 ? (
        <div
          ref={scrollRef}
          className={isScrollable ? 'overflow-x-auto' : ''}
          style={isScrollable ? { scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' } : undefined}
        >
          <div style={isScrollable ? { minWidth: W } : undefined}>
            <div className="relative">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="w-full cursor-crosshair"
              style={{ height: 220 }}
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
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
                      stroke="white" strokeOpacity="0.06" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
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
                        stroke="#0d0d12"
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

              {chartMode === 'daily' && barChart && (
                <>
                  <line x1={PX} y1={barChart.zeroY} x2={W - PR} y2={barChart.zeroY}
                    stroke="white" strokeOpacity="0.08" strokeWidth="1"
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
                      stroke="white" strokeOpacity="0.08" strokeWidth="1"
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
        <div className="fixed inset-0 z-[9999] flex flex-col bg-[#0d0d12]">
          {/* Fullscreen header */}
          <div className="flex items-start justify-between px-6 pt-5 pb-2">
            <div className="min-h-[48px]">
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-0.5">{displayInfo.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatChartMoney(displayInfo.value)}
              </p>
              <p className="text-[11px] text-gray-500 tabular-nums mt-0.5 h-[16px]">
                {displayInfo.date
                  ? displayInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '\u00A0'}
              </p>
            </div>

            <div className="flex items-center gap-2">
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
                  title="Daily PnL"
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
                {(['7d', '30d', 'all'] as Timeframe[]).map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
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
          <div className="flex-1 px-6 pb-6 min-h-0">
            {dayData.length > 0 ? (
              <div className="h-full flex flex-col">
                <div className="flex-1 min-h-0 relative">
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${W} ${H}`}
                    className="w-full h-full cursor-crosshair"
                    preserveAspectRatio="none"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
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
                            stroke="white" strokeOpacity="0.06" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
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
                              fillOpacity="0.6" stroke="#0d0d12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                          )
                        })}
                        {hoverIndex !== null && lineChart.xs[hoverIndex] !== undefined && (
                          <>
                            <line x1={lineChart.xs[hoverIndex]} y1={0} x2={lineChart.xs[hoverIndex]} y2={H}
                              stroke="white" strokeOpacity="0.12" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            <circle cx={lineChart.xs[hoverIndex]} cy={lineChart.ys[hoverIndex]} r="5"
                              fill={lineChart.points[hoverIndex].cumPnl >= 0 ? strokeColor : strokeColorNeg}
                              stroke="#0d0d12" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          </>
                        )}
                      </>
                    )}

                    {chartMode === 'daily' && barChart && (
                      <>
                        <line x1={PX} y1={barChart.zeroY} x2={W - PR} y2={barChart.zeroY}
                          stroke="white" strokeOpacity="0.08" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        {barChart.bars.map((bar, i) => (
                          <rect key={i} x={bar.x} y={bar.y} width={bar.w} height={bar.h}
                            rx={Math.min(1.5, bar.w / 2)}
                            fill={bar.isPos ? strokeColor : strokeColorNeg}
                            fillOpacity={hoverIndex === i ? 1 : 0.7} />
                        ))}
                        {hoverIndex !== null && barChart.bars[hoverIndex] && (
                          <line x1={barChart.bars[hoverIndex].centerX} y1={0} x2={barChart.bars[hoverIndex].centerX} y2={H}
                            stroke="white" strokeOpacity="0.08" strokeWidth="1" vectorEffect="non-scaling-stroke" />
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
